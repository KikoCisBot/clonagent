// Provision Postgres databases for ClonAgent-managed projects via the local
// `postgres-keycloak` container (which runs a normal PostgreSQL — Keycloak
// just happens to share it). We create one DB + user per project.
const { spawn } = require('child_process');
const settings  = require('../routes/settings');

function cfg() {
  const s = settings.read().integrations || {};
  return {
    container:  s.pgContainer  || process.env.PG_CONTAINER  || 'postgres-keycloak',
    superUser:  s.pgSuperUser  || process.env.PG_SUPER_USER || 'keycloak',
    superDb:    s.pgSuperDb    || process.env.PG_SUPER_DB   || 'keycloak',
    hostForApps: s.pgHostForApps || process.env.PG_HOST_FOR_APPS || 'host.docker.internal',
    portForApps: s.pgPortForApps || 5432,
  };
}

function dockerExec(args, sql) {
  return new Promise((resolve, reject) => {
    const c = cfg();
    const proc = spawn('docker', ['exec', '-i', c.container, ...args]);
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    if (sql) proc.stdin.end(sql); else proc.stdin.end();
    proc.on('close', code => code === 0 ? resolve(out) : reject(new Error(`pg ${code}: ${err.trim()}`)));
  });
}

async function status() {
  try {
    const c = cfg();
    const out = await dockerExec(['psql', '-U', c.superUser, '-d', c.superDb, '-tAc', 'SELECT version()']);
    return { available: true, container: c.container, version: out.trim().slice(0, 60) };
  } catch (e) { return { available: false, error: e.message }; }
}

async function provisionDatabase({ db, user, password }) {
  const c = cfg();
  if (!/^[a-z0-9_]+$/.test(db || ''))   throw new Error('db must be lowercase_snake');
  if (!/^[a-z0-9_]+$/.test(user || '')) throw new Error('user must be lowercase_snake');
  if (!password || password.length < 12) throw new Error('password must be ≥12 chars');

  const sql = [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${user}') THEN
         CREATE ROLE "${user}" WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}';
       END IF;
     END $$;`,
    `SELECT 'create' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db}')\\gexec`,
    `CREATE DATABASE "${db}" OWNER "${user}";`,
    `GRANT ALL PRIVILEGES ON DATABASE "${db}" TO "${user}";`,
  ].join('\n');

  // Run twice — first time creates the role; second creates the db (CREATE DATABASE
  // can't run inside a transaction, so we split). Trick: use psql with -c per statement.
  await dockerExec(['psql', '-U', c.superUser, '-d', c.superDb, '-c',
    `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${user}') THEN CREATE ROLE "${user}" WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}'; END IF; END $$;`,
  ]);
  try {
    await dockerExec(['psql', '-U', c.superUser, '-d', c.superDb, '-c',
      `CREATE DATABASE "${db}" OWNER "${user}";`,
    ]);
  } catch (e) {
    if (!/already exists/i.test(e.message)) throw e;
  }
  await dockerExec(['psql', '-U', c.superUser, '-d', c.superDb, '-c',
    `GRANT ALL PRIVILEGES ON DATABASE "${db}" TO "${user}";`,
  ]);

  return {
    db,
    user,
    host: c.hostForApps,
    port: c.portForApps,
    connectionString: `postgresql://${user}:${password}@${c.hostForApps}:${c.portForApps}/${db}`,
  };
}

module.exports = { cfg, status, provisionDatabase };

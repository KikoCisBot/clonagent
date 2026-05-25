// Wrapper around docker-mailserver's `setup` CLI (run inside the mailserver
// container) so the ClonAgent UI can provision per-agent mailboxes.
//
// Requires:
//   - docker-mailserver running with container name "mailserver"
//   - The current process having permissions to `docker exec` it (the
//     systemd unit runs as the ubuntu user which is in the docker group).
const { spawn } = require('child_process');

const CONTAINER = process.env.MAIL_CONTAINER || 'mailserver';
const DOMAIN    = process.env.MAIL_DOMAIN    || 'bot.utopiaia.com';

function run(args, input = null) {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', ['exec', '-i', CONTAINER, 'setup', ...args]);
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    if (input) proc.stdin.end(input); else proc.stdin.end();
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`mailserver exit ${code}: ${err.trim() || out.trim()}`));
      resolve(out.trim());
    });
  });
}

async function isAvailable() {
  try { await run(['email', 'list']); return true; }
  catch { return false; }
}

async function listMailboxes() {
  const out = await run(['email', 'list']);
  // setup email list output: "* user@domain  ( quota / used )"
  return out.split('\n').filter(Boolean).map(line => {
    const m = line.match(/^\*\s+(\S+@\S+)/);
    return m ? { email: m[1], raw: line.trim() } : null;
  }).filter(Boolean);
}

async function addMailbox(email, password) {
  return run(['email', 'add', email, password]);
}

async function deleteMailbox(email) {
  return run(['email', 'del', '-y', email]);
}

async function changePassword(email, password) {
  return run(['email', 'update', email, password]);
}

function suggestEmailFor(agentId) {
  return `${agentId.replace(/[^a-z0-9-]/g, '')}@${DOMAIN}`;
}

module.exports = {
  CONTAINER, DOMAIN,
  isAvailable, listMailboxes, addMailbox, deleteMailbox, changePassword,
  suggestEmailFor,
};

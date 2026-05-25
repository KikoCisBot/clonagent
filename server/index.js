const express = require('express');
const cors = require('cors');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const FileStore = require('session-file-store')(session);
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { startPoller } = require('./lib/gmail-poller');
const { requireAuth } = require('./lib/auth');

const PORT = parseInt(process.env.PORT || '3300', 10);

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(cookieParser());
// Stripe webhook needs raw body — mount before global express.json()
app.post('/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  require('./routes/billing').webhookHandler);

app.use(express.json({ limit: '2mb' }));
// Persist a stable secret so cookies survive restarts; generate once if missing.
const SECRET_FILE = path.join(__dirname, 'data', '.session-secret');
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  sessionSecret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
}

const SESSIONS_DIR = path.join(__dirname, 'data', 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,                                      // refresh expiry on each request
  store: new FileStore({
    path: SESSIONS_DIR,
    ttl:  60 * 60 * 24 * 30,                          // 30 days
    retries: 1,
    logFn: () => {},
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure:   true,                                   // we are always behind HTTPS
    maxAge:   1000 * 60 * 60 * 24 * 30,              // 30 days
  },
}));

// Public auth endpoints (no requireAuth)
app.use('/api/auth',     require('./routes/auth'));

// Health is public
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'clonagent', port: PORT }));

// Everything below requires auth (depending on settings.auth.mode)
app.use(requireAuth);

app.use('/api/agents',   require('./routes/agents'));
app.use('/api/agents/:id/queue', require('./routes/agent-tasks'));
app.use('/api/chat',     require('./routes/chat'));
app.use('/api/runs',     require('./routes/runs'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/threads',      require('./routes/threads'));   // legacy alias
app.use('/api/tasks',        require('./routes/tasks'));
app.use('/api/mcp',          require('./routes/mcp'));
app.use('/api/mail',         require('./routes/mail'));
app.use('/api/integrations', require('./routes/integrations'));
app.use('/api/settings',     require('./routes/settings').router);
app.use('/api/billing',      require('./routes/billing'));

// Static client
const clientDist = path.resolve(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('client not built — run `npm run build` in client/');
  });
});

// Migrate any legacy users defined inside settings.json to data/users.json,
// and rebuild the agents registry from skills on disk.
(async () => {
  try {
    const settings = require('./routes/settings');
    const users    = require('./lib/users');
    const skillFs  = require('./lib/skill-fs');

    const legacy = settings.read().auth?.basic?.users || [];
    const n = await users.migrateFromLegacy(legacy);
    if (n) console.log(`[clonagent] migrated ${n} legacy user(s) → users.json`);

    if (users.userCount() === 0) {
      const cur = settings.read();
      settings.write({ auth: { ...cur.auth, allowRegistration: true } });
      console.log('[clonagent] no users yet — enabled open registration');
    }

    const fixed = skillFs.repairConfigs();
    if (fixed.length) console.log(`[clonagent] repaired ${fixed.length} skill config(s): ${fixed.join(', ')}`);
    const recovered = skillFs.discoverAgents();
    if (recovered.length) console.log(`[clonagent] discovered ${recovered.length} skill(s) on disk: ${recovered.join(', ')}`);
  } catch (e) { console.warn('[clonagent] startup migration error:', e.message); }
})();

app.listen(PORT, () => {
  console.log(`[clonagent] listening on http://localhost:${PORT}`);
  startPoller();
});

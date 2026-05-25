// Pluggable authentication for ClonAgent.
// Modes (configurable from /api/settings → Settings UI):
//   - 'none'  : open (dev / local)
//   - 'basic' : username + password against the multi-user store (data/users.json)
//   - 'oidc'  : OpenID Connect (Keycloak, Google, Auth0, etc.)
const { Issuer, generators } = require('openid-client');
const crypto   = require('crypto');
const settings = require('../routes/settings');
const users    = require('./users');
const mailer   = require('./mailer');

let oidcClient;
let oidcReady = false;

async function getOidcClient() {
  const s = settings.read().auth?.oidc;
  if (!s?.issuerUrl || !s?.clientId) throw new Error('OIDC not configured');
  if (oidcClient && oidcReady && oidcClient.metadata.client_id === s.clientId) return oidcClient;
  const issuer = await Issuer.discover(s.issuerUrl);
  oidcClient = new issuer.Client({
    client_id:     s.clientId,
    client_secret: s.clientSecret,
    redirect_uris: [s.redirectUri],
    response_types: ['code'],
  });
  oidcReady = true;
  return oidcClient;
}

function resetOidc() { oidcReady = false; oidcClient = undefined; }

const PUBLIC_PATHS = [
  /^\/api\/health$/,
  /^\/api\/auth\/(login|logout|whoami|register|oidc\/(start|callback)|forgot-password|reset-password)$/,
  /^\/api\/billing\/(plans|webhook)$/,
  /^\/api\/activity\/sessions(\/.*)?$/,
  /^\/api\/threads\/[^/]+\/events$/,
  /^\/api\/tasks\/[^/]+\/events$/,
];

function requireAuth(req, res, next) {
  const mode = settings.read().auth?.mode || 'none';
  if (mode === 'none') return next();
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_PATHS.some(re => re.test(req.path))) return next();
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'authentication required', mode });
}

async function loginBasic(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const u = await users.verifyPassword(username, password);
  if (!u) return res.status(401).json({ error: 'invalid credentials' });
  req.session.user = { sub: u.username, name: u.name, email: u.email, mode: 'basic', isAdmin: u.isAdmin };
  res.json({ ok: true, user: req.session.user });
}

async function register(req, res) {
  const auth = settings.read().auth || {};
  if (!auth.allowRegistration) return res.status(403).json({ error: 'registration is disabled' });
  const { username, password, name, email } = req.body || {};
  try {
    const isAdmin = users.userCount() === 0;
    const created = await users.createUser({ username, password, name, email, isAdmin });
    req.session.user = { sub: created.username, name: created.name, email: created.email, mode: 'basic', isAdmin: created.isAdmin };
    if (email) mailer.sendWelcome({ to: email, name: name || username }).catch(() => {});
    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

async function forgotPassword(req, res) {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const all = require('./users').findUserByEmail(email);
  if (!all) return res.json({ ok: true }); // don't reveal if email exists
  const token = crypto.randomBytes(32).toString('hex');
  require('./users').setResetToken(all.username, token);
  await mailer.sendPasswordReset({ to: email, name: all.name, token }).catch(() => {});
  res.json({ ok: true });
}

async function resetPassword(req, res) {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'token and password required' });
  const u = require('./users').findUserByResetToken(token);
  if (!u) return res.status(400).json({ error: 'invalid or expired token' });
  await require('./users').changePassword(u.username, password);
  require('./users').clearResetToken(u.username);
  res.json({ ok: true });
}

async function oidcStart(req, res) {
  try {
    const client = await getOidcClient();
    const codeVerifier = generators.codeVerifier();
    const state = generators.state();
    req.session.oidc = { codeVerifier, state };
    const url = client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: generators.codeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
    });
    res.redirect(url);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function oidcCallback(req, res) {
  try {
    const client = await getOidcClient();
    const params = client.callbackParams(req);
    const { codeVerifier, state } = req.session.oidc || {};
    const tokenSet = await client.callback(
      settings.read().auth.oidc.redirectUri,
      params,
      { code_verifier: codeVerifier, state },
    );
    const claims = tokenSet.claims();
    req.session.user = {
      sub: claims.sub,
      name: claims.name || claims.preferred_username || claims.email,
      email: claims.email,
      mode: 'oidc',
      isAdmin: false,
    };
    delete req.session.oidc;
    res.redirect('/');
  } catch (e) {
    res.status(500).send(`OIDC callback error: ${e.message}`);
  }
}

function logout(req, res) {
  req.session.destroy(() => res.json({ ok: true }));
}

function whoami(req, res) {
  const s = settings.read().auth || {};
  const mode = s.mode || 'none';
  res.json({
    mode,
    allowRegistration: !!s.allowRegistration || users.userCount() === 0,
    user: req.session?.user || null,
  });
}

module.exports = {
  requireAuth, loginBasic, register, forgotPassword, resetPassword,
  oidcStart, oidcCallback, logout, whoami, resetOidc,
};

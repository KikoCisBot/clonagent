const express = require('express');
const auth    = require('../lib/auth');
const users   = require('../lib/users');
const settings = require('./settings');

const router = express.Router();

router.post('/login',           auth.loginBasic);
router.post('/register',        auth.register);
router.post('/forgot-password', auth.forgotPassword);
router.post('/reset-password',  auth.resetPassword);
router.get ('/oidc/start',      auth.oidcStart);
router.get ('/oidc/callback',   auth.oidcCallback);
router.post('/logout',          auth.logout);
router.get ('/whoami',          auth.whoami);

// ── User self-service ─────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'auth required' });
  const u = users.findUser(req.session.user.sub);
  if (!u) return res.status(404).json({ error: 'user not found' });
  res.json(users.safeView(u));
});

router.patch('/me', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'auth required' });
  const { password, settings: patchSettings } = req.body || {};
  try {
    if (password) await users.changePassword(req.session.user.sub, password);
    if (patchSettings) {
      const sanitized = { ...patchSettings };
      // never trust masked values from the UI
      if (sanitized.anthropicApiKey && sanitized.anthropicApiKey.includes('…')) delete sanitized.anthropicApiKey;
      if (sanitized.relayKey && sanitized.relayKey.includes('…'))             delete sanitized.relayKey;
      users.updateUserSettings(req.session.user.sub, sanitized);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/me/settings', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'auth required' });
  const s = users.getUserSettings(req.session.user.sub);
  res.json({
    ...s,
    anthropicApiKey: s.anthropicApiKey ? maskKey(s.anthropicApiKey) : '',
    relayKey:        s.relayKey        ? maskKey(s.relayKey)        : '',
  });
});

// ── Admin: users ─────────────────────────────────────────────────────────
router.get('/users', requireAdmin, (req, res) => res.json(users.listUsers()));

router.post('/users', requireAdmin, async (req, res) => {
  try {
    const created = await users.createUser(req.body || {});
    res.json(created);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/users/:username', requireAdmin, (req, res) => {
  if (req.session.user.sub === req.params.username)
    return res.status(400).json({ error: 'cannot delete yourself' });
  users.deleteUser(req.params.username);
  res.json({ ok: true });
});

router.patch('/users/:username/admin', requireAdmin, (req, res) => {
  try { res.json(users.setAdmin(req.params.username, !!req.body?.isAdmin)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

function requireAdmin(req, res, next) {
  if (!req.session?.user?.isAdmin) return res.status(403).json({ error: 'admin only' });
  next();
}

function maskKey(s) {
  if (!s) return s;
  if (s.length < 8) return '…';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

module.exports = router;

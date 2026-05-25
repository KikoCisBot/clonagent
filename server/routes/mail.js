const express = require('express');
const crypto = require('crypto');
const mail = require('../lib/mail-server');

const router = express.Router();

router.get('/status', async (req, res) => {
  const ok = await mail.isAvailable();
  res.json({ available: ok, domain: mail.DOMAIN, container: mail.CONTAINER });
});

router.get('/mailboxes', async (req, res) => {
  try { res.json(await mail.listMailboxes()); }
  catch (e) { res.status(500).json({ error: e.message, hint: 'is docker-mailserver running? (scripts/setup-mailserver.sh)' }); }
});

router.post('/mailboxes', async (req, res) => {
  let { email, password, localPart, agentId } = req.body || {};
  try {
    if (!email && agentId) email = mail.suggestEmailFor(agentId);
    if (!email && localPart) email = `${localPart}@${mail.DOMAIN}`;
    if (!email) return res.status(400).json({ error: 'email or agentId or localPart required' });
    if (!password) password = crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '');
    await mail.addMailbox(email, password);
    res.json({ ok: true, email, password });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/mailboxes/:email', async (req, res) => {
  try { await mail.deleteMailbox(req.params.email); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/mailboxes/:email/password', async (req, res) => {
  const password = req.body?.password || crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '');
  try { await mail.changePassword(req.params.email, password); res.json({ ok: true, password }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

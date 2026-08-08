const fs   = require('fs');
const path = require('path');
const os   = require('os');

// POST /api/mail/incoming
// Called by mail-watcher.service on the host when a new message lands in a maildir.
// Body: { email: "user@bot.utopiaia.com" }
// Header: X-Webhook-Secret matching MAIL_WEBHOOK_SECRET env var.
module.exports = async function mailIncoming(req, res) {
  const secret = process.env.MAIL_WEBHOOK_SECRET;
  if (secret && req.headers['x-webhook-secret'] !== secret) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  const { listAgents } = require('../lib/skill-fs');
  const { checkAgent } = require('../lib/gmail-poller');

  const agents = listAgents().filter(a => a.enabled && a.ready);
  const agent = agents.find(a => {
    try {
      const creds = JSON.parse(fs.readFileSync(
        path.join(os.homedir(), '.claude', 'skills', a.id, 'imap-credentials.json'), 'utf8'));
      return (creds.email || '').toLowerCase() === email.toLowerCase();
    } catch {
      return false;
    }
  });

  if (!agent) {
    console.log(`[mail-webhook] no active agent for ${email}`);
    return res.json({ ok: true, skipped: true, reason: 'no active agent' });
  }

  console.log(`[mail-webhook] push for ${agent.id} (${email})`);
  checkAgent(agent).catch(e => console.error(`[mail-webhook] ${agent.id}: ${e.message}`));
  res.json({ ok: true, agentId: agent.id });
};

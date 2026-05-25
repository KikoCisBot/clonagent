// Tasks = the public name for the email threads each agent processes.
// Creating a task injects a synthetic email into the agent's IMAP inbox so
// the poller picks it up as if it had arrived from outside.
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { listAgents, getAgent, SKILLS_ROOT } = require('../lib/skill-fs');
const { injectEmail } = require('../lib/task-injector');
const { checkAgent } = require('../lib/gmail-poller');

const router = express.Router();

// File-level access to the threads store so we can upsert directly.
const THREADS_FILE = path.resolve(__dirname, '..', 'data', 'threads.json');
function readThreads() {
  try { return JSON.parse(fs.readFileSync(THREADS_FILE, 'utf8')); }
  catch { return []; }
}
function writeThreads(list) {
  fs.mkdirSync(path.dirname(THREADS_FILE), { recursive: true });
  fs.writeFileSync(THREADS_FILE, JSON.stringify(list.slice(0, 500), null, 2));
}

// GET /api/tasks → reuse the threads store (already keyed per agent)
const threadsRouter = require('./threads');
router.use('/', threadsRouter);            // delegate /, /:id, /stream, etc.

// Override creation: a task = an email injected into an agent's INBOX.
router.post('/create', async (req, res) => {
  const { agentId, fromEmail, fromName, subject, body } = req.body || {};
  if (!agentId || !subject) return res.status(400).json({ error: 'agentId and subject required' });
  const agent = getAgent(agentId);
  if (!agent) return res.status(404).json({ error: 'agent not found' });

  // The from address must be in the agent's authorized senders (any role) —
  // otherwise the agent would skip it on next poll anyway.
  const senders = (agent.authorizedSenders || []).map(s => (s.email || s).toLowerCase());
  let from = (fromEmail || '').toLowerCase();
  if (!from) {
    // Default to the calling user's email if it's authorized
    const me = req.session?.user?.email?.toLowerCase();
    if (me && senders.includes(me)) from = me;
    else if (senders.length === 1) from = senders[0];
    else return res.status(400).json({ error: 'fromEmail required (authorized sender)' });
  }
  if (!senders.includes(from))
    return res.status(403).json({ error: `from ${from} is not in authorizedSenders` });

  if (agent.mailProvider !== 'imap')
    return res.status(400).json({ error: 'task creation only supported on IMAP agents' });

  try {
    const result = await injectEmail({
      agentId,
      fromEmail: from,
      fromName:  fromName || req.session?.user?.name || '',
      subject,
      body: body || '',
    });
    // Eagerly register a thread entry so the UI shows it immediately, even
    // before the agent has processed the email.
    const all = readThreads();
    const now = new Date().toISOString();
    const thread = {
      id: result.message_id,
      agentId,
      from,
      subject,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      events: [{
        kind: 'email',
        role: 'user',
        from,
        to:   result.to,
        subject,
        body: body || '',
        at:   now,
      }],
    };
    all.unshift(thread);
    writeThreads(all);
    // Kick the poller right away so the user sees movement
    checkAgent(agent).catch(() => {});
    res.json({ ok: true, threadId: thread.id, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

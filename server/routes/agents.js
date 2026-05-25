const express = require('express');
const fs = require('fs');
const path = require('path');
const { listAgents, getAgent, createAgent, updateAgent, deleteAgent,
        readSkillFile, writeSkillFile,
        listVersions, rollbackVersion,
        discoverAgents } = require('../lib/skill-fs');
const { checkAgent } = require('../lib/gmail-poller');
const users = require('../lib/users');
const { getPlan } = require('../lib/plans');

const SESSIONS_FILE = path.resolve(__dirname, '..', 'data', 'activity-sessions.json');
const SPEND_CACHE_TTL = 60_000;
const _spendCache = new Map(); // agentId -> { data, expiresAt }

const router = express.Router();

router.get('/', (req, res) => {
  // Auto-discover any new skills present on disk so the UI is never out-of-sync
  // with `~/.claude/skills/` (e.g. after a fresh deploy that wiped the registry).
  try { discoverAgents(); } catch {}
  res.json(listAgents());
});

router.post('/discover', (req, res) => {
  try { res.json({ added: discoverAgents() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', (req, res) => {
  const a = getAgent(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  res.json(a);
});

router.post('/', async (req, res) => {
  // Enforce per-plan agent limit
  if (req.session?.user?.sub) {
    const u    = users.findUser(req.session.user.sub);
    const plan = getPlan(u?.plan || 'free');
    const all  = listAgents();
    const mine = u ? all.filter(a => !a.ownerId || a.ownerId === u.username) : all;
    if (mine.length >= plan.maxAgents) {
      return res.status(403).json({
        error: `Your ${plan.name} plan allows ${plan.maxAgents} agent(s). Upgrade to create more.`,
        limitReached: true,
        plan: plan.id,
      });
    }
  }
  try {
    const body = { ...req.body };
    if (req.session?.user?.sub) body.ownerId = req.session.user.sub;
    res.status(201).json(await createAgent(body));
  }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/:id', (req, res) => {
  try { res.json(updateAgent(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    // By default a delete now wipes everything (skill folder + mailbox).
    // Pass ?keep=1 to only remove the registry entry.
    const keep = req.query.keep === '1';
    await deleteAgent(req.params.id, { removeSkill: !keep, removeMailbox: !keep });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Read skill files (SKILL.md, config.json, etc.)
router.get('/:id/files/:file', (req, res) => {
  const file = req.params.file;
  if (!/^[\w.-]+$/.test(file)) return res.status(400).json({ error: 'bad filename' });
  const content = readSkillFile(req.params.id, file);
  if (content == null) return res.status(404).json({ error: 'file not found' });
  res.type('text/plain').send(content);
});

router.put('/:id/files/:file', (req, res) => {
  const file = req.params.file;
  if (!/^[\w.-]+$/.test(file)) return res.status(400).json({ error: 'bad filename' });
  // Forbid writing token/credentials via this endpoint
  if (file === 'token.json' || file === 'credentials.json')
    return res.status(403).json({ error: 'use the upload endpoint for credentials' });
  try {
    writeSkillFile(req.params.id, file, req.body.content || '');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Versioning
router.get('/:id/versions', (req, res) => {
  if (!getAgent(req.params.id)) return res.status(404).json({ error: 'agent not found' });
  res.json(listVersions(req.params.id));
});

router.post('/:id/versions/:n/rollback', (req, res) => {
  try { res.json(rollbackVersion(req.params.id, parseInt(req.params.n, 10))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Manual trigger
router.post('/:id/run', async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'not found' });
  try { res.json(await checkAgent(agent)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Spending summary for an agent (from activity sessions) — cached 60s
router.get('/:id/spending', async (req, res) => {
  if (!getAgent(req.params.id)) return res.status(404).json({ error: 'not found' });

  const agentId = req.params.id;
  const now = Date.now();
  const hit = _spendCache.get(agentId);
  if (hit && hit.expiresAt > now) return res.json(hit.data);

  let sessions = [];
  try { sessions = JSON.parse(await fs.promises.readFile(SESSIONS_FILE, 'utf8')); } catch {}

  const nowDate    = new Date();
  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).toISOString();
  const dayStart   = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).toISOString();

  const mine    = sessions.filter(s => (s.agentId || s.agent_id) === agentId && s.cost_usd > 0);
  const monthly = mine.filter(s => s.created_at >= monthStart);
  const daily   = mine.filter(s => s.created_at >= dayStart);
  const sum     = arr => parseFloat(arr.reduce((t, s) => t + (s.cost_usd || 0), 0).toFixed(4));

  const data = {
    today:       sum(daily),
    this_month:  sum(monthly),
    all_time:    sum(mine),
    runs_month:  monthly.length,
    runs_today:  daily.length,
  };
  _spendCache.set(agentId, { data, expiresAt: now + SPEND_CACHE_TTL });
  res.json(data);
});

module.exports = router;

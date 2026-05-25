const express = require('express');
const { listRegistry, getEntry } = require('../lib/mcp-registry');
const { readMcp, addServer, removeServer } = require('../lib/mcp-fs');
const { getAgent } = require('../lib/skill-fs');
const { snapshotVersion } = require('../lib/skill-fs');

const router = express.Router();

// ── Registry ────────────────────────────────────────────────────────────
router.get('/registry', (req, res) => res.json(listRegistry()));

router.get('/registry/:name', (req, res) => {
  const e = getEntry(req.params.name);
  if (!e) return res.status(404).json({ error: 'not in registry' });
  res.json(e);
});

// ── Per-agent ──────────────────────────────────────────────────────────
router.get('/:agentId', (req, res) => {
  if (!getAgent(req.params.agentId)) return res.status(404).json({ error: 'agent not found' });
  res.json(readMcp(req.params.agentId));
});

router.post('/:agentId/servers', (req, res) => {
  if (!getAgent(req.params.agentId)) return res.status(404).json({ error: 'agent not found' });
  const { name, values } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const built = addServer(req.params.agentId, name, values || {});
    snapshotVersion(req.params.agentId, `mcp:add ${name}`);
    res.json({ ok: true, server: built });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:agentId/servers/:name', (req, res) => {
  if (!getAgent(req.params.agentId)) return res.status(404).json({ error: 'agent not found' });
  removeServer(req.params.agentId, req.params.name);
  snapshotVersion(req.params.agentId, `mcp:remove ${req.params.name}`);
  res.json({ ok: true });
});

module.exports = router;

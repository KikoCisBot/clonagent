// Status + actions for built-in resources ClonAgent can offer to agents:
// Gitea (git), Postgres (DB), and the future "create-project" flow.
const express = require('express');
const gitea   = require('../lib/gitea-client');
const pg      = require('../lib/postgres-client');

const router = express.Router();

router.get('/status', async (req, res) => {
  const [g, p] = await Promise.all([gitea.status(), pg.status()]);
  res.json({ gitea: g, postgres: p });
});

// ── Gitea ────────────────────────────────────────────────────────────────
router.get('/gitea/repos', async (req, res) => {
  try { res.json(await gitea.listRepos()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/gitea/repos', async (req, res) => {
  try { res.json(await gitea.createRepo(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/gitea/repos/:owner/:name', async (req, res) => {
  try { res.json({ exists: await gitea.repoExists(`${req.params.owner}/${req.params.name}`) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Postgres ─────────────────────────────────────────────────────────────
router.post('/postgres/databases', async (req, res) => {
  try { res.json(await pg.provisionDatabase(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

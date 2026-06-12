// audit.js — Public, inbound store-audit endpoint.
//
// The visitor submits the URL of their own store and gets a live health report.
// No auth required (this is a top-of-funnel lead magnet), so it is rate-limited
// per IP and the heavy lifting (incl. SSRF protection) lives in lib/wp-audit.js.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { auditStore, AuditError } = require('../lib/wp-audit');
const { verifyUnsub, suppress } = require('../lib/audit-nurture');

const router = express.Router();

// ── Per-IP rate limit (in-memory sliding window) ──────────────────────────────
const WINDOW_MS = 10 * 60 * 1000;   // 10 minutes
const MAX_HITS  = 8;                // audits per window per IP
const hits = new Map();             // ip -> number[] (timestamps)

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_HITS) {
    return res.status(429).json({ error: 'Too many audits from your network. Try again in a few minutes.' });
  }
  recent.push(now);
  hits.set(ip, recent);
  next();
}

// Opportunistic cleanup so the Map cannot grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of hits) {
    const recent = ts.filter(t => now - t < WINDOW_MS);
    if (recent.length) hits.set(ip, recent); else hits.delete(ip);
  }
}, WINDOW_MS).unref();

// ── Audit ─────────────────────────────────────────────────────────────────────
router.post('/', rateLimit, async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Send a { url } to audit.' });
  }
  try {
    const report = await auditStore(url);
    res.json(report);
  } catch (e) {
    if (e instanceof AuditError) return res.status(400).json({ error: e.message, code: e.code });
    console.warn('[audit] unexpected error:', e.message);
    res.status(500).json({ error: 'Audit failed unexpectedly.' });
  }
});

// ── Consented lead capture ─────────────────────────────────────────────────────
// Only stored when the visitor explicitly asks us to send them the report / get
// started. This is opt-in inbound — the opposite of scraping.
const LEADS_FILE = path.join(__dirname, '..', 'data', 'audit-leads.jsonl');

router.post('/lead', rateLimit, (req, res) => {
  const { email, url, score } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  const lead = {
    email: email.trim().toLowerCase().slice(0, 200),
    url: typeof url === 'string' ? url.slice(0, 500) : null,
    score: typeof score === 'number' ? score : null,
    ip: req.ip,
    at: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(LEADS_FILE), { recursive: true });
    fs.appendFileSync(LEADS_FILE, JSON.stringify(lead) + '\n');
  } catch (e) {
    console.warn('[audit] could not store lead:', e.message);
  }
  res.json({ ok: true });
});

// ── One-click unsubscribe (RGPD) ────────────────────────────────────────────────
// Token-verified so nobody can unsubscribe someone else, and no login required.
router.get('/unsubscribe', (req, res) => {
  const { e: email, t: token } = req.query;
  if (!verifyUnsub(email, token)) {
    return res.status(400).send('Enlace de baja no válido.');
  }
  suppress(String(email));
  res.set('Content-Type', 'text/html; charset=utf-8').send(
    `<div style="font-family:sans-serif;max-width:420px;margin:60px auto;text-align:center;color:#334155">
       <h2 style="color:#0f172a">Te has dado de baja</h2>
       <p>No volverás a recibir avisos sobre tu tienda. Gracias.</p>
     </div>`);
});

module.exports = router;

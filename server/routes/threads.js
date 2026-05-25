// Per-thread tracking page + ingest API.
// The agent posts updates to /api/threads/:id/events from inside its session,
// and external viewers can read /api/threads/:id to see what's happening.
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'threads.json');

const subscribers = new Map(); // threadId|"*" -> Set<res>

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return []; }
}
function writeAll(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list.slice(0, 500), null, 2));
}
function broadcast(threadId, payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const key of [threadId, '*']) {
    for (const res of (subscribers.get(key) || [])) { try { res.write(data); } catch {} }
  }
}
function upsertThread(t) {
  const all = readAll();
  const i = all.findIndex(x => x.id === t.id);
  const merged = i >= 0 ? { ...all[i], ...t, updatedAt: new Date().toISOString() }
                        : { events: [], status: 'open', createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(), ...t };
  if (i >= 0) all[i] = merged; else all.unshift(merged);
  writeAll(all);
  return merged;
}

router.get('/', (req, res) => {
  const all = readAll().map(t => ({
    id: t.id, agentId: t.agentId, subject: t.subject, from: t.from,
    status: t.status, version: t.version,
    eventCount: (t.events || []).length,
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  }));
  res.json(all);
});

router.get('/:id', (req, res) => {
  const t = readAll().find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'thread not found' });
  res.json(t);
});

router.post('/', (req, res) => res.json(upsertThread(req.body)));

router.post('/:id/events', (req, res) => {
  const all = readAll();
  const i = all.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'thread not found' });
  const ev = { ...req.body, at: new Date().toISOString() };
  all[i].events = [...(all[i].events || []), ev].slice(-500);
  all[i].updatedAt = ev.at;
  writeAll(all);
  broadcast(req.params.id, { type: 'event', threadId: req.params.id, event: ev });
  broadcast('*',           { type: 'event', threadId: req.params.id, event: ev });
  res.json({ ok: true });
});

router.patch('/:id', (req, res) => {
  const all = readAll();
  const i = all.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'thread not found' });
  all[i] = { ...all[i], ...req.body, updatedAt: new Date().toISOString() };
  writeAll(all);
  broadcast(req.params.id, { type: 'thread:update', thread: all[i] });
  res.json(all[i]);
});

router.get('/stream/:id', sse);
router.get('/stream',     sse);

function sse(req, res) {
  const key = req.params.id || '*';
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key).add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 30000);
  req.on('close', () => { clearInterval(ping); subscribers.get(key)?.delete(res); });
}

module.exports = router;

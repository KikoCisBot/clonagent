// Receives live events from host-relay and broadcasts to clients via SSE.
// To wire this up, run host-relay with CONSOLE_URL=http://localhost:3300
// (or run a second relay just for ClonAgent on a different port).
const express = require('express');
const fs = require('fs');
const path = require('path');
const threadStore   = require('../lib/email-thread-store');
const agentSessions = require('../lib/agent-sessions');
// Lazy-require to avoid circular deps — poller requires relay-client which requires this
let poller = null;
function getPoller() { if (!poller) poller = require('../lib/gmail-poller'); return poller; }

const router = express.Router();
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'activity-sessions.json');
const MAX_SESSIONS = 100;
const MAX_EVENTS_PER_SESSION = 500;

const subscribers = new Map(); // sessionId|"*" -> Set<res>

function readSessions() {
  try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); }
  catch { return []; }
}
function writeSessions(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s.slice(0, MAX_SESSIONS), null, 2));
}
function upsertSession(session) {
  const all = readSessions();
  const i = all.findIndex(s => s.id === session.id);
  const now = new Date().toISOString();
  const merged = {
    status: 'running', events: [],
    ...(i >= 0 ? all[i] : {}),
    ...session,
    created_at: (i >= 0 ? all[i].created_at : null) || session.created_at || now,
    updated_at: now,
  };
  if (i >= 0) all[i] = merged; else all.unshift(merged);
  writeSessions(all);
  return merged;
}
function appendEvent(sessionId, event) {
  const all = readSessions();
  const i = all.findIndex(s => s.id === sessionId);
  if (i < 0) return null;
  const ev = { ...event, received_at: new Date().toISOString() };
  all[i].events = [...(all[i].events || []), ev].slice(-MAX_EVENTS_PER_SESSION);
  all[i].updated_at = ev.received_at;
  writeSessions(all);
  return ev;
}
function broadcast(sessionId, payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const key of [sessionId, '*']) {
    const subs = subscribers.get(key);
    if (!subs) continue;
    for (const res of subs) { try { res.write(data); } catch {} }
  }
}

// ─── List sessions / get one ───────────────────────────────────────────────
router.get('/', (req, res) => {
  const all = readSessions();
  const summary = all.map(s => ({
    id: s.id,
    agentId: s.agentId || s.agent_id,
    status: s.status,
    description: s.description || s.task?.slice(0, 100) || '',
    created_at: s.created_at,
    updated_at: s.updated_at,
    eventCount: (s.events || []).length,
  }));
  res.json(summary);
});

router.get('/:id', (req, res) => {
  const s = readSessions().find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s);
});

// ─── Ingest endpoints (called by host-relay) ───────────────────────────────
router.post('/sessions', (req, res) => {
  const session = upsertSession(req.body);
  broadcast('*', { type: 'session:upsert', session: { id: session.id, status: session.status } });
  res.json({ ok: true, session });
});

router.post('/sessions/:id/events', (req, res) => {
  const event = appendEvent(req.params.id, req.body);
  if (!event) return res.status(404).json({ error: 'session not found' });

  const body = req.body || {};
  const relayId = req.params.id;

  // Capture real Claude session UUID from init event → enables proper --resume
  if (body.type === 'system' && body.subtype === 'init' && body.session_id) {
    threadStore.updateClaudeSessionId(relayId, body.session_id);
    // Also store on the scheduler/executor session record
    const sessData = require('../lib/agent-sessions');
    // Find which agent owns this relay session and which role
    try {
      const all = JSON.parse(require('fs').readFileSync(
        require('path').resolve(__dirname, '..', 'data', 'agent-sessions.json'), 'utf8'));
      for (const [agentId, sess] of Object.entries(all)) {
        if (sess.schedulerRelayId === relayId)
          agentSessions.set(agentId, { schedulerClaudeId: body.session_id });
        if (sess.executorRelayId === relayId)
          agentSessions.set(agentId, { executorClaudeId: body.session_id });
      }
    } catch { /* no sessions file yet */ }
  }

  // Extract cost from Claude CLI result event
  if (body.type === 'result' && body.cost_usd != null) {
    const all = readSessions();
    const i = all.findIndex(s => s.id === relayId);
    if (i >= 0) {
      all[i].cost_usd = parseFloat(((all[i].cost_usd || 0) + Number(body.cost_usd)).toFixed(6));
      all[i].status = body.subtype === 'error' ? 'error' : 'done';
      all[i].updated_at = new Date().toISOString();
      writeSessions(all);
    }
  }

  // When session ends, mark the role as idle so the next email/task can launch
  if (body.type === 'session_end' || body.type === 'session_error') {
    getPoller().onSessionEnd(relayId);
  }

  broadcast(req.params.id, { type: 'event', sessionId: req.params.id, event });
  broadcast('*',           { type: 'event', sessionId: req.params.id, event });
  res.json({ ok: true });
});

router.post('/sessions/:id/status', (req, res) => {
  const all = readSessions();
  const i = all.findIndex(s => s.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  all[i].status     = req.body.status || all[i].status;
  all[i].updated_at = new Date().toISOString();
  writeSessions(all);
  broadcast('*',  { type: 'session:status', sessionId: req.params.id, status: all[i].status });
  res.json({ ok: true });
});

// ─── SSE stream ────────────────────────────────────────────────────────────
router.get('/stream/:id', sse);
router.get('/stream',     sse);

function sse(req, res) {
  const key = req.params.id || '*';
  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection:      'keep-alive',
  });
  res.write(': connected\n\n');
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key).add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 30000);
  req.on('close', () => { clearInterval(ping); subscribers.get(key)?.delete(res); });
}

module.exports = router;

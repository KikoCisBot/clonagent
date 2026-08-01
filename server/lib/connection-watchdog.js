// Connection watchdog — alerts the owner by email when ClonAgent loses its
// connection to the execution engine (the host-relay) for more than a grace
// window, and again when the connection comes back.
//
// Behaviour (per the owner's spec):
//   - If disconnected for MORE than 5 minutes → send ONE "down" email.
//   - When the connection returns → send ONE "recovered" email.
//   - Never spam: exactly one email per transition, persisted across restarts.
const fs   = require('fs');
const path = require('path');
const mailer = require('./mailer');

const RELAY_URL   = process.env.AGENT_RELAY_URL || process.env.LITELLM_URL || 'http://localhost:3202';
const ALERT_EMAIL = process.env.WATCHDOG_ALERT_EMAIL || 'kikocisneros@gmail.com';
const GRACE_MS    = parseInt(process.env.WATCHDOG_GRACE_MS || String(5 * 60 * 1000), 10); // 5 min
const CHECK_MS    = parseInt(process.env.WATCHDOG_CHECK_MS || String(60 * 1000), 10);     // 1 min
const STATE_FILE  = process.env.WATCHDOG_STATE_FILE || path.resolve(__dirname, '..', 'data', 'watchdog-state.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { connected: true, downSince: null, downAlertSent: false, lastHealthyAt: new Date().toISOString() }; }
}
function saveState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch (e) { console.warn('[watchdog] could not persist state:', e.message); }
}

// A probe is "healthy" when the relay answers its health endpoint with ok:true.
// That is ClonAgent's lifeline: no relay → no agent can run.
async function probe() {
  try {
    const r = await fetch(`${RELAY_URL}/health`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    const d = await r.json().catch(() => ({}));
    return d.ok !== false;
  } catch { return false; }
}

function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h} h ${mm} min`;
}

async function alertDown(downSince) {
  const since = new Date(downSince);
  await mailer.send({
    to: ALERT_EMAIL,
    subject: '⚠️ ClonAgent sin conexión',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;color:#e2e8f0;background:#0f1117;padding:28px;border-radius:12px">
        <h1 style="color:#f87171;margin:0 0 8px;font-size:20px">⚠️ ClonAgent perdió la conexión</h1>
        <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 16px">
          ClonAgent lleva <strong style="color:#e2e8f0">más de ${fmtDuration(GRACE_MS)}</strong> sin poder
          conectar con su motor de ejecución (relay <code>${RELAY_URL}</code>). Mientras dure,
          los agentes no pueden ejecutarse.
        </p>
        <p style="color:#64748b;font-size:13px;margin:0">Sin conexión desde: ${since.toISOString()}</p>
        <p style="color:#475569;font-size:12px;margin-top:20px">Te enviaré otro correo cuando vuelva. — ClonAgent watchdog</p>
      </div>`,
  });
}

async function alertRecovered(downSince) {
  const downMs = downSince ? (Date.now() - new Date(downSince).getTime()) : 0;
  await mailer.send({
    to: ALERT_EMAIL,
    subject: '✅ ClonAgent ha recuperado la conexión',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;color:#e2e8f0;background:#0f1117;padding:28px;border-radius:12px">
        <h1 style="color:#34d399;margin:0 0 8px;font-size:20px">✅ ClonAgent vuelve a estar online</h1>
        <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 8px">
          La conexión con el motor de ejecución se ha restablecido. Los agentes vuelven a operar con normalidad.
        </p>
        ${downSince ? `<p style="color:#64748b;font-size:13px;margin:0">Duración del corte: ~${fmtDuration(downMs)}</p>` : ''}
        <p style="color:#475569;font-size:12px;margin-top:20px">— ClonAgent watchdog</p>
      </div>`,
  });
}

async function tick() {
  const healthy = await probe();
  const s = loadState();
  const now = Date.now();

  if (healthy) {
    // Recovered? Only notify if we had previously sent a down alert.
    if (!s.connected && s.downAlertSent) {
      try { await alertRecovered(s.downSince); console.log('[watchdog] connection recovered — owner notified'); }
      catch (e) { console.warn('[watchdog] recovery email failed:', e.message); }
    }
    saveState({ connected: true, downSince: null, downAlertSent: false, lastHealthyAt: new Date().toISOString() });
    return;
  }

  // Unhealthy
  const downSince = s.downSince || new Date().toISOString();
  const downForMs = now - new Date(downSince).getTime();
  let downAlertSent = s.downAlertSent;

  if (!downAlertSent && downForMs >= GRACE_MS) {
    try { await alertDown(downSince); downAlertSent = true; console.log(`[watchdog] DOWN >${fmtDuration(GRACE_MS)} — owner notified`); }
    catch (e) { console.warn('[watchdog] down email failed (will retry next tick):', e.message); }
  }
  saveState({ connected: false, downSince, downAlertSent, lastHealthyAt: s.lastHealthyAt || null });
}

function startWatchdog() {
  console.log(`[watchdog] started — relay=${RELAY_URL} grace=${fmtDuration(GRACE_MS)} alert=${ALERT_EMAIL}`);
  setInterval(() => { tick().catch(e => console.warn('[watchdog] tick error:', e.message)); }, CHECK_MS);
  // First check shortly after boot (give the relay a moment).
  setTimeout(() => { tick().catch(() => {}); }, 15000);
}

module.exports = { startWatchdog, tick, probe };

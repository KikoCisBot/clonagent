// audit-nurture.js — Background inbound-lead worker.
//
// Works ONLY the consented inbound funnel — never cold outreach, never scraping:
//   1. First report — when a visitor submits their store URL + email on the
//      landing, we audit it and email them the full report with our offer.
//   2. Monitoring — we re-audit each opted-in store on a cadence and, if its
//      health regresses (score drops, a new high-severity issue appears, it goes
//      down), we send a heads-up. This is the "help them improve" value.
//   3. Operator digest — an optional daily summary of new leads to OPERATOR_EMAIL.
//
// Every recipient explicitly asked for this by giving their email. All mail
// carries sender identity + a one-click unsubscribe, and is frequency-capped.

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const { auditStore } = require('./wp-audit');
const mailer = require('./mailer');

const DATA_DIR     = path.join(__dirname, '..', 'data');
const LEADS_FILE   = path.join(DATA_DIR, 'audit-leads.jsonl');
const STATE_FILE   = path.join(DATA_DIR, 'audit-nurture-state.json');
const SUPPRESS_FILE = path.join(DATA_DIR, 'audit-unsubscribed.json');
const SECRET_FILE  = path.join(DATA_DIR, '.session-secret');

const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com').replace(/\/$/, '');
const ENABLED    = process.env.AUDIT_NURTURE !== '0';        // on by default
const DRY_RUN    = process.env.AUDIT_NURTURE_DRYRUN === '1'; // log instead of send
const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL || '';

const MONITOR_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;  // re-audit a store weekly
const MAX_MONITOR_EMAILS  = 4;                         // stop nagging after 4
const SCORE_DROP_ALERT    = 6;                         // points drop that triggers a heads-up

// ── State / suppression ─────────────────────────────────────────────────────────
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
const loadState = () => readJson(STATE_FILE, {});
const saveState = (s) => writeJson(STATE_FILE, s);
const loadSuppression = () => new Set(readJson(SUPPRESS_FILE, []));
function suppress(email) {
  const set = loadSuppression();
  set.add(email.toLowerCase());
  writeJson(SUPPRESS_FILE, [...set]);
}

function loadLeads() {
  let raw;
  try { raw = fs.readFileSync(LEADS_FILE, 'utf8'); } catch { return []; }
  return raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function secret() {
  try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); }
  catch { return process.env.SESSION_SECRET || 'clonagent-nurture'; }
}
// Stateless unsubscribe token — verifiable without a DB lookup.
function unsubToken(email) {
  return crypto.createHmac('sha256', secret()).update(email.toLowerCase()).digest('hex').slice(0, 20);
}
function verifyUnsub(email, token) {
  if (!email || !token) return false;
  const expected = unsubToken(email);
  const a = Buffer.from(token), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function unsubUrl(email) {
  return `${PUBLIC_URL}/api/audit-store/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;
}

const key = (email, url) => `${email.toLowerCase()}|${url}`;

// ── Email rendering ─────────────────────────────────────────────────────────────
const SEV_COLOR = { high: '#fb7185', medium: '#fbbf24', low: '#94a3b8' };
const SEV_LABEL = { high: 'Urgente', medium: 'Importante', low: 'Menor' };

function findingsHtml(findings) {
  if (!findings.length)
    return `<p style="color:#34d399;font-size:14px">No hemos encontrado problemas graves. ¡Buen trabajo!</p>`;
  return findings.map(f => `
    <div style="background:#171b22;border-left:3px solid ${SEV_COLOR[f.severity]};border-radius:6px;padding:12px 14px;margin-bottom:10px">
      <div style="font-weight:600;color:#e2e8f0;font-size:14px">${escapeHtml(f.title)}
        <span style="color:${SEV_COLOR[f.severity]};font-size:11px;text-transform:uppercase;margin-left:6px">${SEV_LABEL[f.severity]}</span></div>
      <div style="color:#94a3b8;font-size:13px;margin-top:4px">${escapeHtml(f.detail)}</div>
      <div style="color:#6ee7b7;font-size:13px;margin-top:6px">→ ${escapeHtml(f.fix)}</div>
    </div>`).join('');
}

function shell(inner, email) {
  return `
  <div style="font-family:sans-serif;max-width:560px;margin:auto;color:#e2e8f0;background:#0f1117;padding:32px;border-radius:12px">
    ${inner}
    <div style="margin-top:28px;padding-top:18px;border-top:1px solid #1f2330">
      <p style="color:#475569;font-size:11px;margin:0">
        Recibes este correo porque pediste una auditoría de tu tienda en
        <a href="${PUBLIC_URL}" style="color:#7c5cff">ClonAgent</a> · Utopia IA (Kiko Cisneros).<br>
        ¿No quieres más avisos? <a href="${unsubUrl(email)}" style="color:#64748b">Darse de baja</a>.
      </p>
    </div>
  </div>`;
}

function reportEmailHtml(report, email) {
  const inner = `
    <h1 style="color:#a78bfa;margin:0 0 4px;font-size:22px">Tu informe de tienda 🛒</h1>
    <p style="color:#94a3b8;margin:0 0 20px;font-size:15px">
      Auditamos <strong style="color:#e2e8f0">${escapeHtml(report.finalUrl)}</strong>.
      Puntuación de salud: <strong style="color:${scoreColor(report.score)}">${report.score}/100 · ${report.scoreLabel}</strong>.
    </p>
    <p style="font-weight:600;color:#e2e8f0;margin:0 0 12px">
      ${report.findings.length} ${report.findings.length === 1 ? 'punto a mejorar' : 'puntos a mejorar'}:
    </p>
    ${findingsHtml(report.findings)}
    <div style="background:#1a1530;border:1px solid #7c5cff55;border-radius:10px;padding:18px;margin-top:20px">
      <p style="font-weight:600;color:#e2e8f0;margin:0 0 6px">${escapeHtml(report.pitch.headline)}</p>
      <p style="color:#94a3b8;font-size:14px;margin:0 0 14px">${escapeHtml(report.pitch.body)}</p>
      <a href="mailto:hola@utopiaia.com?subject=Quiero%20el%20mantenimiento%20de%20mi%20tienda"
         style="display:inline-block;background:#7c5cff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
        Quiero arreglarlo por ${report.pitch.tier}€/año →
      </a>
      <p style="color:#64748b;font-size:12px;margin:12px 0 0">O simplemente responde a este correo y te ayudamos.</p>
    </div>`;
  return shell(inner, email);
}

function monitorEmailHtml(report, prev, changes, email) {
  const inner = `
    <h1 style="color:#fbbf24;margin:0 0 4px;font-size:21px">Hemos detectado cambios en tu tienda</h1>
    <p style="color:#94a3b8;margin:0 0 18px;font-size:15px">
      En nuestra revisión de <strong style="color:#e2e8f0">${escapeHtml(report.finalUrl)}</strong>
      la salud pasó de <strong>${prev.lastScore}</strong> a
      <strong style="color:${scoreColor(report.score)}">${report.score}/100</strong>.
    </p>
    <p style="font-weight:600;color:#e2e8f0;margin:0 0 10px">Lo nuevo o más urgente:</p>
    ${findingsHtml(changes.length ? changes : report.findings.slice(0, 4))}
    <div style="background:#1a1530;border:1px solid #7c5cff55;border-radius:10px;padding:16px;margin-top:18px">
      <p style="color:#94a3b8;font-size:14px;margin:0 0 12px">
        Lo mantenemos vigilado y arreglado por ${report.pitch.tier}€/año, sin que tengas que estar pendiente.
      </p>
      <a href="mailto:hola@utopiaia.com?subject=Mantenimiento%20de%20mi%20tienda"
         style="display:inline-block;background:#7c5cff;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600">
        Que se encarguen por mí →
      </a>
    </div>`;
  return shell(inner, email);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function scoreColor(s) { return s >= 90 ? '#34d399' : s >= 75 ? '#fbbf24' : s >= 50 ? '#fb923c' : '#fb7185'; }

async function deliver({ to, subject, html }) {
  if (DRY_RUN) { console.log(`[nurture] (dry-run) would email ${to} — "${subject}"`); return; }
  await mailer.send({ to, subject, html });
  console.log(`[nurture] sent "${subject}" → ${to}`);
}

// ── Cycle 1: first report for brand-new leads ────────────────────────────────────
async function processNewLeads() {
  const state = loadState();
  const suppressed = loadSuppression();
  let changed = false;

  for (const lead of loadLeads()) {
    if (!lead.email || !lead.url) continue;
    const email = lead.email.toLowerCase();
    if (suppressed.has(email)) continue;
    const k = key(email, lead.url);
    if (state[k]?.firstReportAt) continue;  // already sent their report

    try {
      const report = await auditStore(lead.url);
      await deliver({
        to: email,
        subject: `Tu auditoría: ${report.score}/100 · ${report.findings.length} ${report.findings.length === 1 ? 'punto' : 'puntos'} a mejorar`,
        html: reportEmailHtml(report, email),
      });
      state[k] = {
        url: report.finalUrl,
        firstReportAt: new Date().toISOString(),
        lastAuditAt: new Date().toISOString(),
        lastScore: report.score,
        lastFindings: report.findings.map(f => f.title),
        monitorEmails: 0,
      };
      changed = true;
    } catch (e) {
      console.warn(`[nurture] could not audit ${lead.url} for ${email}: ${e.message}`);
      // Mark as attempted so a permanently-bad URL doesn't retry forever.
      state[k] = { url: lead.url, firstReportAt: new Date().toISOString(), error: e.code || 'audit_failed', monitorEmails: MAX_MONITOR_EMAILS };
      changed = true;
    }
  }
  if (changed) saveState(state);
}

// ── Cycle 2: weekly monitoring of opted-in stores ────────────────────────────────
async function runMonitoring() {
  const state = loadState();
  const suppressed = loadSuppression();
  let changed = false;

  for (const [k, st] of Object.entries(state)) {
    const email = k.split('|')[0];
    if (suppressed.has(email)) continue;
    if (st.error) continue;
    if ((st.monitorEmails || 0) >= MAX_MONITOR_EMAILS) continue;
    if (Date.now() - new Date(st.lastAuditAt || st.firstReportAt).getTime() < MONITOR_INTERVAL_MS) continue;

    try {
      const report = await auditStore(st.url);
      const prevTitles = new Set(st.lastFindings || []);
      const newHigh = report.findings.filter(f => f.severity === 'high' && !prevTitles.has(f.title));
      const dropped = report.score <= (st.lastScore ?? 100) - SCORE_DROP_ALERT;

      if (newHigh.length || dropped) {
        await deliver({
          to: email,
          subject: `⚠️ Cambios en tu tienda — ahora ${report.score}/100`,
          html: monitorEmailHtml(report, st, newHigh, email),
        });
        st.monitorEmails = (st.monitorEmails || 0) + 1;
      }
      st.lastAuditAt = new Date().toISOString();
      st.lastScore = report.score;
      st.lastFindings = report.findings.map(f => f.title);
      changed = true;
    } catch (e) {
      console.warn(`[nurture] monitor re-audit failed for ${st.url}: ${e.message}`);
      st.lastAuditAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) saveState(state);
}

// ── Cycle 3: optional daily operator digest ──────────────────────────────────────
async function operatorDigest() {
  if (!OPERATOR_EMAIL) return;
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const fresh = loadLeads().filter(l => new Date(l.at).getTime() >= dayAgo);
  if (!fresh.length) return;
  const rows = fresh.map(l => `<li style="margin:4px 0">${escapeHtml(l.email)} — ${escapeHtml(l.url || '')} (${l.score ?? '–'}/100)</li>`).join('');
  await deliver({
    to: OPERATOR_EMAIL,
    subject: `ClonAgent · ${fresh.length} ${fresh.length === 1 ? 'lead nuevo' : 'leads nuevos'} hoy`,
    html: `<div style="font-family:sans-serif;color:#e2e8f0;background:#0f1117;padding:24px;border-radius:12px;max-width:520px">
      <h2 style="color:#a78bfa;margin:0 0 12px">${fresh.length} ${fresh.length === 1 ? 'lead' : 'leads'} en las últimas 24h</h2>
      <ul style="color:#94a3b8;font-size:14px;padding-left:18px">${rows}</ul></div>`,
  });
}

// ── Scheduling ───────────────────────────────────────────────────────────────────
let firstReportRunning = false, monitorRunning = false;

async function tickFirstReports() {
  if (firstReportRunning) return;
  firstReportRunning = true;
  try { await processNewLeads(); }
  catch (e) { console.error('[nurture] first-report cycle error:', e.message); }
  finally { firstReportRunning = false; }
}

async function tickMonitor() {
  if (monitorRunning) return;
  monitorRunning = true;
  try { await runMonitoring(); await operatorDigest(); }
  catch (e) { console.error('[nurture] monitor cycle error:', e.message); }
  finally { monitorRunning = false; }
}

function startNurture() {
  if (!ENABLED) { console.log('[nurture] disabled (AUDIT_NURTURE=0)'); return; }
  cron.schedule('*/5 * * * *', tickFirstReports);   // new leads: every 5 min
  cron.schedule('0 9 * * *',   tickMonitor);        // monitoring + digest: daily 09:00
  console.log(`[nurture] started (new leads: 5min, monitor: daily 09:00${DRY_RUN ? ', DRY-RUN' : ''})`);
}

module.exports = { startNurture, processNewLeads, runMonitoring, operatorDigest, verifyUnsub, suppress, unsubToken };

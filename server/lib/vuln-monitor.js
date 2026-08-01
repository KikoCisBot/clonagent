// vuln-monitor.js — CVE watch layer on the CONSENTED inbound funnel.
//
// This is the "monitorización continua" promised on the Pro tier — NOT cold outreach.
//
// For every domain whose owner OPTED IN (they submitted it themselves on the landing →
// server/data/audit-leads.jsonl), we:
//   1. Fingerprint its WordPress/plugin versions with the same audit engine the owner
//      already asked us to run (lib/wp-audit.js — external only, no server access).
//   2. Match those versions against WPScan's public CVE database.
//   3. If a domain they asked us to watch is running a plugin/core version with a *known
//      public CVE*, email the owner — at the address THEY gave us — a heads-up with the
//      finding and free fix steps, plus the optional paid maintenance offer.
//
// Hard rules (same as audit-nurture.js and the store-audit skill):
//   • Only ever emails opted-in leads. Never scrapes for addresses, never emails a domain
//     nobody asked us about, never buys/guesses lists.
//   • Every message carries the same one-click RGPD unsubscribe as the rest of the funnel
//     and is de-duplicated so we never re-nag about the same CVE.
//   • Findings come only from public HTTP responses. No access is ever attempted.

const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const cron   = require('node-cron');
const mailer = require('./mailer');
const { auditStore } = require('./wp-audit');
// Reuse the consented funnel's helpers so there is ONE source of truth for who opted in
// and who unsubscribed — the CVE monitor must never diverge from the nurture worker.
const { loadLeads, loadSuppression, unsubUrl } = require('./audit-nurture');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'vuln-monitor-state.json');

const WPSCAN_API_KEY = process.env.WPSCAN_API_KEY || '';
const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL || '';
const DRY_RUN        = process.env.VULN_MONITOR_DRYRUN === '1';
const ENABLED        = process.env.VULN_MONITOR !== '0';

// ── State helpers ─────────────────────────────────────────────────────────────
// State is keyed by the opted-in URL and records which CVEs we've already flagged,
// so a genuinely NEW vulnerability can trigger a fresh alert but the same set never
// re-sends. { lastCheck, notified: { [url]: { email, cves: [id], at } } }

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastCheck: null, notified: {} }; }
}

function saveState(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ── Opted-in domains ────────────────────────────────────────────────────────────
// The consented set: everyone who submitted their own store on the landing. Deduped
// to the most recent { email, url } per URL, minus anyone who has unsubscribed.

function optedInDomains() {
  const suppressed = loadSuppression();
  const byUrl = new Map(); // url -> { email, url }
  for (const lead of loadLeads()) {
    if (!lead.email || !lead.url) continue;
    const email = lead.email.toLowerCase();
    if (suppressed.has(email)) continue;
    byUrl.set(lead.url, { email, url: lead.url }); // later entries win (most recent consent)
  }
  return [...byUrl.values()];
}

// ── WPScan CVE fetcher ────────────────────────────────────────────────────────

function wpScanFetch(endpoint) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'wpscan.com',
      path: `/api/v3/${endpoint}`,
      headers: { Authorization: `Token token=${WPSCAN_API_KEY}`, 'User-Agent': 'ClonAgent/1.0' },
    };
    https.get(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('WPScan parse error: ' + body.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

// WPScan v3 returns the vuln list nested under the slug/version key
// (e.g. { "woocommerce": { vulnerabilities: [...] } }); tolerate both shapes.
function extractVulns(data, key) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.vulnerabilities)) return data.vulnerabilities;
  if (key && Array.isArray(data[key]?.vulnerabilities)) return data[key].vulnerabilities;
  for (const v of Object.values(data)) {
    if (Array.isArray(v?.vulnerabilities)) return v.vulnerabilities;
  }
  return [];
}

async function fetchPluginCves(slug) {
  if (!WPSCAN_API_KEY) return [];
  try { return extractVulns(await wpScanFetch(`plugins/${slug}`), slug); }
  catch { return []; }
}

async function fetchWordPressCves(version) {
  if (!WPSCAN_API_KEY) return [];
  try { return extractVulns(await wpScanFetch(`wordpresses/${version.replace(/\./g, '')}`), version); }
  catch { return []; }
}

// A stable id for a vuln so we can de-dupe across runs: prefer its CVE, fall back to title.
function vulnId(v) {
  const cve = v.references?.cve?.[0];
  return cve ? `CVE-${cve}` : (v.title || 'unknown').slice(0, 120);
}

function describeVuln(v) {
  const title = v.title || 'Vulnerabilidad desconocida';
  const cvss  = v.cvss?.score ? ` (CVSS ${v.cvss.score})` : '';
  const fixed = v.fixed_in ? ` — corregido en v${v.fixed_in}` : '';
  const where = v._component ? `[${v._component}] ` : '';
  return `${where}${title}${cvss}${fixed}`;
}

// ── Version comparator (semver-lite) ─────────────────────────────────────────
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── Find the CVEs affecting one opted-in domain ───────────────────────────────
// We fingerprint the domain with the same audit engine the owner asked us to run,
// then match detected versions against WPScan. Only versions strictly older than a
// vuln's fixed_in count as affected.

async function findVulnsForDomain(url) {
  const report = await auditStore(url); // external-only fingerprint the owner consented to
  if (!report?.platform?.isWordPress) return { report, vulns: [] };

  const vulns = [];

  for (const { slug, version } of report.plugins || []) {
    if (!slug || !version) continue;
    const affected = (await fetchPluginCves(slug)).filter(v =>
      v.fixed_in && compareVersions(version, v.fixed_in) < 0);
    vulns.push(...affected.map(v => ({ ...v, _component: slug })));
    await sleep(1500); // be gentle with the WPScan rate limit
  }

  const wpVersion = report.platform.wpVersion || report.probes?.wpVersionFromReadme;
  if (wpVersion) {
    const wpVulns = (await fetchWordPressCves(wpVersion)).filter(v =>
      !v.fixed_in || compareVersions(wpVersion, v.fixed_in) < 0);
    vulns.push(...wpVulns.map(v => ({ ...v, _component: 'WordPress core' })));
  }

  return { report, vulns };
}

// ── Email builder (inbound framing) ───────────────────────────────────────────

function buildDisclosureEmail({ email, url, report, vulns }) {
  const domain   = (() => { try { return new URL(report.finalUrl || url).host; } catch { return url; } })();
  const vulnList = vulns.map((v, i) => `${i + 1}. ${describeVuln(v)}`).join('\n');

  const subject = vulns.length === 1
    ? `Aviso de seguridad para ${domain} — 1 vulnerabilidad conocida`
    : `Aviso de seguridad para ${domain} — ${vulns.length} vulnerabilidades conocidas`;

  const text = `Hola,

Pediste el análisis de seguridad de ${domain} en nuestra web, y lo tenemos en
seguimiento. En la última revisión he detectado que usa versiones de software con
vulnerabilidades de seguridad conocidas públicamente:

${vulnList}

Esto es información pública (bases de datos de CVEs); cualquiera puede encontrarla
buscando tu dominio + versión. No he accedido a nada de tu web: solo he mirado lo
que es visible desde fuera, igual que cualquier visitante.

¿Qué puedes hacer?

1. Actualizar desde el panel de WordPress → Actualizaciones. Es gratis y lo puedes
   hacer tú mismo en un par de minutos.

2. Si prefieres que lo llevemos nosotros, ofrecemos mantenimiento por 30€/año:
   actualizaciones, backups y monitorización de seguridad como esta, sin permanencia.
   Responde a este correo y lo arrancamos.

Un saludo,
Kiko — Utopia IA

---
Recibes este aviso porque pediste el análisis de ${domain}.
Para no recibir más avisos de seguridad: ${unsubUrl(email)}
`;

  return { subject, text };
}

// ── Main scan ─────────────────────────────────────────────────────────────────

async function scanOptedIn() {
  const domains = optedInDomains();
  if (!domains.length) {
    console.log('[vuln-monitor] no opted-in domains yet — nothing to check');
    return;
  }
  if (!WPSCAN_API_KEY) {
    console.log('[vuln-monitor] no WPSCAN_API_KEY — skipping CVE match');
    return;
  }

  const state = loadState();
  let notifiedCount = 0;

  for (const { email, url } of domains) {
    let found;
    try {
      found = await findVulnsForDomain(url);
    } catch (e) {
      console.warn(`[vuln-monitor] could not fingerprint ${url}: ${e.message}`);
      continue;
    }
    const { report, vulns } = found;
    if (!vulns.length) continue;

    // Only alert about CVEs we haven't already told THIS domain about.
    const prev = state.notified[url]?.cves || [];
    const seen = new Set(prev);
    const fresh = vulns.filter(v => !seen.has(vulnId(v)));
    if (!fresh.length) continue;

    const { subject, text } = buildDisclosureEmail({ email, url, report, vulns: fresh });

    if (DRY_RUN) {
      console.log(`[vuln-monitor][DRY] would email ${email} about ${url}: ${fresh.length} new CVE(s)`);
    } else {
      try {
        await mailer.send({ to: email, subject, text });
        console.log(`[vuln-monitor] alerted ${email} about ${fresh.length} new CVE(s) on ${url}`);
        notifiedCount++;
      } catch (e) {
        console.warn(`[vuln-monitor] failed to email ${email}: ${e.message}`);
        continue; // don't record as notified if the send failed
      }
    }

    state.notified[url] = {
      email,
      cves: [...seen, ...fresh.map(vulnId)],
      at: new Date().toISOString(),
    };
    await sleep(2000); // throttle between recipients
  }

  state.lastCheck = new Date().toISOString();
  saveState(state);

  if (OPERATOR_EMAIL && notifiedCount > 0 && !DRY_RUN) {
    await mailer.send({
      to: OPERATOR_EMAIL,
      subject: `[vuln-monitor] ${notifiedCount} avisos de seguridad enviados`,
      text: `Se han enviado ${notifiedCount} avisos de CVEs a dominios opted-in.\n\nEstado: ${STATE_FILE}`,
    }).catch(() => {});
  }

  console.log(`[vuln-monitor] done — ${notifiedCount} notified`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startVulnMonitor() {
  if (!ENABLED) { console.log('[vuln-monitor] disabled via VULN_MONITOR=0'); return; }
  if (!WPSCAN_API_KEY) {
    console.log('[vuln-monitor] no WPSCAN_API_KEY — set it to enable CVE matching');
    return;
  }

  console.log('[vuln-monitor] started — daily CVE scan of opted-in domains at 10:00');

  // Run once shortly after startup, then daily at 10:00.
  setTimeout(() => { scanOptedIn().catch(e => console.warn('[vuln-monitor] scan error:', e.message)); }, 60_000);
  cron.schedule('0 10 * * *', () => scanOptedIn().catch(e => console.warn('[vuln-monitor] scan error:', e.message)));
}

module.exports = {
  startVulnMonitor, scanOptedIn,
  _internal: { optedInDomains, buildDisclosureEmail, vulnId, compareVersions, extractVulns },
};

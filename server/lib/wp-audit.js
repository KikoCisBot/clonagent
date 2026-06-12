// wp-audit.js — Live, inbound WooCommerce/WordPress audit engine.
//
// The visitor pastes the URL of THEIR OWN store on our landing page; we fetch it
// a handful of times and report real, verifiable findings (speed, outdated
// plugins, security hygiene, SEO, ecommerce specifics). No data is harvested and
// nothing is sent anywhere — this is a consented, one-shot diagnostic.
//
// SECURITY: this runs behind a PUBLIC endpoint that fetches arbitrary URLs, so it
// is an SSRF vector by nature. Every outbound request is funneled through
// safeFetch(), which validates scheme, port and — critically — that the resolved
// IP is publicly routable, re-checking on every redirect hop.

const dns = require('dns').promises;
const net = require('net');

const UA = 'ClonAgentAuditBot/1.0 (+https://utopiaia.com; store health check)';
const HOP_TIMEOUT_MS   = 6000;   // per request
const TOTAL_BUDGET_MS  = 15000;  // whole audit
const MAX_REDIRECTS    = 5;
const MAX_HTML_BYTES   = 3_000_000;

// Heuristic "latest" reference points (knowledge cutoff). Used only to flag
// clearly-behind installs — kept coarse on purpose to avoid false precision.
const WP_LATEST_MAJOR  = 6;
const WOO_LATEST_MAJOR = 9;

// ── SSRF guard ────────────────────────────────────────────────────────────────

function ipv4IsPublic(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = p;
  if (a === 0)   return false;                          // 0.0.0.0/8
  if (a === 10)  return false;                          // private
  if (a === 127) return false;                          // loopback
  if (a === 169 && b === 254) return false;             // link-local + cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return false;    // private
  if (a === 192 && b === 168) return false;             // private
  if (a === 100 && b >= 64 && b <= 127) return false;   // CGNAT 100.64/10
  // Reserved /24s only — NOT the whole /16. 192.0.66/78 (Automattic) etc. are public.
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // 192.0.0/24 + TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false;// benchmarking 198.18/15
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2 198.51.100/24
  if (a === 203 && b === 0 && c === 113) return false;  // TEST-NET-3 203.0.113/24
  if (a >= 224) return false;                           // multicast 224/4 + reserved 240/4 + broadcast
  return true;
}

function ipv6IsPublic(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return false;            // loopback / unspecified
  if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb')) return false; // link-local fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return false;   // unique-local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4 address.
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4IsPublic(mapped[1]);
  return true;
}

function ipIsPublic(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return ipv4IsPublic(ip);
  if (kind === 6) return ipv6IsPublic(ip);
  return false;
}

// Resolve a hostname and require EVERY answer to be publicly routable. Throwing
// here is what blocks SSRF to internal services and cloud metadata endpoints.
async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (!ipIsPublic(hostname)) throw new AuditError('blocked_target', 'That address is not publicly reachable.');
    return;
  }
  let addrs;
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    throw new AuditError('dns_failed', `Could not resolve ${hostname}.`);
  }
  if (!addrs.length) throw new AuditError('dns_failed', `Could not resolve ${hostname}.`);
  for (const { address } of addrs) {
    if (!ipIsPublic(address)) throw new AuditError('blocked_target', 'That host resolves to a private address.');
  }
}

function parseAndValidateUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new AuditError('bad_url', 'That does not look like a valid URL.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new AuditError('bad_scheme', 'Only http:// and https:// URLs are supported.');
  if (u.port && !['80', '443'].includes(u.port))
    throw new AuditError('bad_port', 'Only standard web ports (80/443) are supported.');
  return u;
}

// Fetch with manual redirect handling so we can re-validate the destination host
// on every hop (a redirect to http://169.254.169.254 must not slip through).
// NOTE: there is a small DNS-rebinding TOCTOU window between the public-IP check
// and the actual connect; acceptable for auditing a visitor's own public store.
async function safeFetch(rawUrl, { method = 'GET', deadline } = {}) {
  let url = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = parseAndValidateUrl(url);
    await assertPublicHost(u.hostname);

    const budgetLeft = deadline ? deadline - Date.now() : HOP_TIMEOUT_MS;
    if (budgetLeft <= 0) throw new AuditError('timeout', 'The site took too long to respond.');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.min(HOP_TIMEOUT_MS, budgetLeft));
    const startedAt = Date.now();
    let res;
    try {
      res = await fetch(u.href, {
        method,
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
      });
    } catch (e) {
      if (e.name === 'AbortError') throw new AuditError('timeout', 'The site took too long to respond.');
      throw new AuditError('unreachable', 'Could not connect to the site.');
    } finally {
      clearTimeout(t);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), u.href).href;
      continue;
    }
    return { res, finalUrl: u.href, ttfbMs: Date.now() - startedAt };
  }
  throw new AuditError('too_many_redirects', 'The site redirected too many times.');
}

class AuditError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ── Heuristics ────────────────────────────────────────────────────────────────

function detectPlatform(html, headers, finalUrl) {
  const isHttps = finalUrl.startsWith('https://');
  const hasWpPaths = /\/wp-(content|includes|json)\//i.test(html);
  const generator = (html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
  const isWordPress = hasWpPaths || /wordpress/i.test(generator) || /\/wp-json/i.test(html);

  const isWooCommerce =
    /\/wp-content\/plugins\/woocommerce\//i.test(html) ||
    /\bwoocommerce(-page|-cart|-js|-no-js)?\b/i.test(html) ||
    /wc-block|wc_add_to_cart|woocommerce-cart-fragments/i.test(html) ||
    /woocommerce/i.test(generator);

  let wpVersion = (generator.match(/wordpress\s+([\d.]+)/i) || [])[1] || null;
  let wooVersion =
    (generator.match(/woocommerce\s+([\d.]+)/i) || [])[1] ||
    (html.match(/\/plugins\/woocommerce\/[^"']*?\?ver=([\d.]+)/i) || [])[1] || null;

  const theme = (html.match(/\/wp-content\/themes\/([a-z0-9_-]+)\//i) || [])[1] || null;

  return { isHttps, isWordPress, isWooCommerce, wpVersion, wooVersion, theme, generator: generator || null };
}

// Pull plugin slugs + versions from asset URLs (…/plugins/<slug>/…?ver=<v>).
function detectPlugins(html) {
  const re = /\/wp-content\/plugins\/([a-z0-9_-]+)\/[^"']*?(?:\?ver=([\d.]+))?["']/gi;
  const map = new Map();
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1];
    const ver = m[2] || null;
    if (!map.has(slug) || (ver && !map.get(slug))) map.set(slug, ver);
  }
  return [...map.entries()].map(([slug, version]) => ({ slug, version }));
}

function countAssets(html) {
  const scripts = (html.match(/<script\b/gi) || []).length;
  const styles  = (html.match(/<link[^>]+rel=["']stylesheet["']/gi) || []).length;
  const images  = (html.match(/<img\b/gi) || []).length;
  return { scripts, styles, images };
}

function majorOf(v) { return v ? parseInt(String(v).split('.')[0], 10) : null; }

// Probe a few well-known paths on the already-validated origin. Each is a real,
// commonly-misconfigured exposure; we only flag what we can actually observe.
async function runProbes(origin, deadline) {
  const out = { readmeExposed: false, wpVersionFromReadme: null, userEnumeration: false, xmlrpcEnabled: false };
  const tryGet = async (path, fn) => {
    try {
      const { res } = await safeFetch(origin + path, { deadline });
      await fn(res);
    } catch { /* probe failures are non-fatal */ }
  };

  await Promise.all([
    tryGet('/readme.html', async (res) => {
      if (res.ok) {
        out.readmeExposed = true;
        const body = (await res.text()).slice(0, 4000);
        out.wpVersionFromReadme = (body.match(/version\s+([\d.]+)/i) || [])[1] || null;
      }
    }),
    tryGet('/wp-json/wp/v2/users', async (res) => {
      if (res.ok) {
        const body = (await res.text()).slice(0, 4000);
        try { out.userEnumeration = Array.isArray(JSON.parse(body)) && JSON.parse(body).length > 0; } catch {}
      }
    }),
  ]);

  // XML-RPC: a POST that the server "understands" (405/200/!404) means it is live.
  try {
    const { res } = await safeFetch(origin + '/xmlrpc.php', { method: 'POST', deadline });
    out.xmlrpcEnabled = res.status !== 404;
  } catch { /* ignore */ }

  return out;
}

// ── Scoring + findings ────────────────────────────────────────────────────────

const SEVERITY_WEIGHT = { high: 18, medium: 9, low: 4 };

function buildFindings({ platform, perf, plugins, probes, headers, seo }) {
  const f = [];
  const add = (severity, area, title, detail, fix) => f.push({ severity, area, title, detail, fix });

  // — Speed —
  if (perf.ttfbMs > 800)
    add('high', 'speed', 'Servidor lento al responder',
      `El servidor tarda ${perf.ttfbMs} ms en empezar a responder (TTFB). Por encima de 800 ms se nota en cada visita y penaliza en Google.`,
      'Activar caché de página, PHP actualizado y un hosting o CDN más rápido.');
  if (perf.totalMs > 3000)
    add('high', 'speed', 'La página tarda en cargar',
      `La home tardó ${(perf.totalMs / 1000).toFixed(1)} s en descargarse. En ecommerce, cada segundo extra reduce la conversión.`,
      'Optimizar imágenes, minificar CSS/JS y cachear.');
  else if (perf.totalMs > 1500)
    add('medium', 'speed', 'Carga mejorable',
      `La home tardó ${(perf.totalMs / 1000).toFixed(1)} s. Hay margen para bajar de 1,5 s.`,
      'Lazy-load de imágenes y limpieza de scripts.');
  if (perf.assets.scripts > 25)
    add('low', 'speed', 'Muchos scripts en la home',
      `Se cargan ${perf.assets.scripts} scripts. Suele indicar plugins de más ralentizando el sitio.`,
      'Revisar y desactivar plugins innecesarios; combinar/aplazar JS.');

  // — Security / hygiene —
  if (!platform.isHttps)
    add('high', 'security', 'La tienda no usa HTTPS',
      'El sitio no carga por HTTPS. En una tienda es crítico: los navegadores marcan el checkout como "no seguro".',
      'Instalar un certificado SSL (gratis con Let\'s Encrypt) y forzar HTTPS.');
  if (probes.readmeExposed)
    add('medium', 'security', 'readme.html accesible',
      `El fichero /readme.html está público${probes.wpVersionFromReadme ? ` y revela WordPress ${probes.wpVersionFromReadme}` : ''}. Facilita a los bots saber qué exploits probar.`,
      'Bloquear /readme.html y ocultar la versión de WordPress.');
  if (probes.userEnumeration)
    add('medium', 'security', 'Usuarios enumerables vía API',
      'El endpoint /wp-json/wp/v2/users lista los nombres de usuario. Es el primer paso para un ataque de fuerza bruta al login.',
      'Restringir la REST API y proteger wp-login con límite de intentos.');
  if (probes.xmlrpcEnabled)
    add('low', 'security', 'XML-RPC activo',
      'xmlrpc.php está habilitado. Es una vía habitual de ataques de fuerza bruta y amplificación.',
      'Desactivar XML-RPC si no usas la app móvil ni Jetpack.');
  if (!headers.get('strict-transport-security') && platform.isHttps)
    add('low', 'security', 'Falta cabecera HSTS',
      'No se envía Strict-Transport-Security. Sin ella, hay una ventana para ataques de degradación a HTTP.',
      'Añadir la cabecera HSTS en el servidor.');
  if (!headers.get('x-frame-options') && !headers.get('content-security-policy'))
    add('low', 'security', 'Sin protección anti-clickjacking',
      'Faltan X-Frame-Options y Content-Security-Policy. Tu tienda puede embeberse en un iframe para suplantarla.',
      'Añadir X-Frame-Options: SAMEORIGIN o una CSP.');

  // — Maintenance / versions —
  const wpMajor = majorOf(platform.wpVersion || probes.wpVersionFromReadme);
  if (platform.isWordPress && wpMajor && wpMajor < WP_LATEST_MAJOR)
    add('high', 'maintenance', 'WordPress desactualizado',
      `Detectada una versión antigua de WordPress (${platform.wpVersion || probes.wpVersionFromReadme}). Las versiones viejas acumulan vulnerabilidades conocidas.`,
      'Actualizar el núcleo de WordPress y mantenerlo al día.');
  const wooMajor = majorOf(platform.wooVersion);
  if (platform.isWooCommerce && wooMajor && wooMajor < WOO_LATEST_MAJOR)
    add('high', 'ecommerce', 'WooCommerce desactualizado',
      `WooCommerce ${platform.wooVersion} está varias versiones por detrás. En una tienda esto afecta a la seguridad de los pagos y a la compatibilidad de plugins.`,
      'Actualizar WooCommerce y sus extensiones de pago tras una copia de seguridad.');
  if (plugins.length >= 15)
    add('medium', 'maintenance', 'Muchos plugins instalados',
      `Se detectan al menos ${plugins.length} plugins. Cada uno es superficie de ataque y peso extra; los abandonados son el mayor riesgo.`,
      'Auditar plugins, eliminar los que no se usen y vigilar los sin actualizar.');

  // — SEO —
  if (!seo.title)
    add('medium', 'seo', 'Falta la etiqueta <title>',
      'La home no tiene un título claro. Es lo primero que muestra Google en los resultados.',
      'Definir títulos únicos por página (con un plugin SEO).');
  if (!seo.metaDescription)
    add('low', 'seo', 'Sin meta description',
      'No hay descripción para los resultados de búsqueda. Google inventará una, normalmente peor.',
      'Escribir meta descriptions orientadas a venta.');
  if (!seo.hasViewport)
    add('medium', 'seo', 'Sin viewport móvil',
      'Falta la etiqueta viewport: la tienda puede verse mal en móvil, donde está la mayoría de las compras.',
      'Añadir el meta viewport y revisar el diseño responsive.');
  if (platform.isWooCommerce && !seo.hasProductSchema)
    add('low', 'ecommerce', 'Sin datos estructurados de producto',
      'No se detecta schema.org de producto. Pierdes las estrellas y el precio en los resultados de Google.',
      'Añadir datos estructurados de producto (rich snippets).');

  return f;
}

function scoreFromFindings(findings) {
  let score = 100;
  for (const f of findings) score -= (SEVERITY_WEIGHT[f.severity] || 0);
  score = Math.max(5, Math.min(100, score));
  let label;
  if (score >= 90) label = 'Excelente';
  else if (score >= 75) label = 'Bien, con mejoras';
  else if (score >= 50) label = 'Necesita atención';
  else label = 'Crítico';
  return { score, label };
}

function buildPitch({ platform, findings, score }) {
  const high = findings.filter(f => f.severity === 'high').length;
  const total = findings.length;
  const isShop = platform.isWooCommerce;
  const tier = isShop || platform.isWordPress ? 30 : 5;

  let headline, body;
  if (total === 0) {
    headline = '¡Tu tienda está muy bien cuidada!';
    body = 'No hemos encontrado problemas graves. Aun así, mantenerla actualizada cada mes evita sustos. Lo hacemos por ti desde 30€/año.';
  } else if (isShop) {
    headline = `Tu tienda WooCommerce tiene ${total} ${total === 1 ? 'punto' : 'puntos'} a mejorar${high ? `, ${high} ${high === 1 ? 'urgente' : 'urgentes'}` : ''}`;
    body = 'Te lo arreglamos y mantenemos tu tienda actualizada, segura y rápida todo el año. Por 30€/año, gestionado por email — sin que toques nada.';
  } else if (platform.isWordPress) {
    headline = `Tu WordPress tiene ${total} ${total === 1 ? 'mejora' : 'mejoras'} pendientes`;
    body = 'Lo dejamos fino y lo mantenemos al día por 30€/año. Para webs sencillas, el plan básico es de 5€/año.';
  } else {
    headline = `Encontramos ${total} ${total === 1 ? 'mejora' : 'mejoras'} en tu web`;
    body = 'Mantenimiento y mejoras continuas desde 5€/año para webs básicas, 30€/año con tienda online.';
  }
  return { headline, body, tier };
}

function extractSeo(html) {
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || null;
  const metaDescription = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1]?.trim() || null;
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const hasOg = /<meta[^>]+property=["']og:/i.test(html);
  const hasProductSchema = /"@type"\s*:\s*"Product"|itemtype=["'][^"']*schema.org\/Product/i.test(html);
  return { title, metaDescription, hasViewport, h1Count, hasOg, hasProductSchema };
}

// ── Public entrypoint ─────────────────────────────────────────────────────────

async function auditStore(rawInput) {
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  // Be forgiving about what the visitor types: default to https:// if no scheme.
  let input = String(rawInput || '').trim();
  if (!input) throw new AuditError('bad_url', 'Enter the URL of your store.');
  if (!/^https?:\/\//i.test(input)) input = 'https://' + input;

  const t0 = Date.now();
  const { res, finalUrl, ttfbMs } = await safeFetch(input, { deadline });
  if (!res.ok && res.status >= 400)
    throw new AuditError('http_error', `The site responded with ${res.status}.`);

  const reader = res.body;
  let html = '';
  if (res.headers.get('content-type')?.includes('text/html') || !res.headers.get('content-type')) {
    const raw = await res.text();
    html = raw.length > MAX_HTML_BYTES ? raw.slice(0, MAX_HTML_BYTES) : raw;
  }
  const totalMs = Date.now() - t0;

  const platform = detectPlatform(html, res.headers, finalUrl);
  const seo      = extractSeo(html);
  const plugins  = platform.isWordPress ? detectPlugins(html) : [];
  const perf     = {
    ttfbMs,
    totalMs,
    htmlBytes: Buffer.byteLength(html),
    assets: countAssets(html),
  };

  // Security probes only make sense (and are only polite) on WordPress installs.
  const origin = new URL(finalUrl).origin;
  const probes = platform.isWordPress
    ? await runProbes(origin, deadline)
    : { readmeExposed: false, wpVersionFromReadme: null, userEnumeration: false, xmlrpcEnabled: false };

  const findings = buildFindings({ platform, perf, plugins, probes, headers: res.headers, seo });
  const { score, label } = scoreFromFindings(findings);
  const pitch = buildPitch({ platform, findings, score });

  // High severity first, then by area, so the UI reads worst-to-best.
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    url: input,
    finalUrl,
    reachable: true,
    platform,
    performance: perf,
    plugins: plugins.slice(0, 20),
    pluginCount: plugins.length,
    seo,
    probes,
    findings,
    score,
    scoreLabel: label,
    pitch,
  };
}

module.exports = { auditStore, AuditError, _internal: { ipIsPublic, parseAndValidateUrl } };

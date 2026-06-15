// locations.js — Programmatic local-SEO engine.
//
// One template + a data list (towns.js) + routes, rendered on demand. This is
// real programmatic SEO over REAL Spanish municipalities — NOT a million thin
// doorway pages (that is "scaled content abuse" and gets a domain deindexed).
//
// Each page is localized (town + province), rotates intro copy to avoid being
// byte-identical, links to siblings + the hub, and embeds the live audit form.

let TOWNS = [];
try { TOWNS = require('./towns'); } catch { TOWNS = []; }

const BASE = (process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com').replace(/\/$/, '');
const bySlug = new Map(TOWNS.map(t => [t.slug, t]));

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Deterministic small int from a slug (stable intro variant per town).
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

function introVariant(t) {
  const v = [
    `¿Tienes una tienda online en <strong>${esc(t.name)}</strong> (${esc(t.province)})? Mantenemos tu WooCommerce rápido, seguro y actualizado todo el año por <strong>30€/año</strong>, en remoto y gestionado por email.`,
    `Si vendes online desde <strong>${esc(t.name)}</strong> o alrededores (${esc(t.province)}), nos encargamos del mantenimiento de tu tienda WooCommerce —actualizaciones, velocidad, seguridad y copias— por <strong>30€/año</strong>, sin que toques nada.`,
    `Mantenimiento de tiendas WooCommerce y WordPress para negocios de <strong>${esc(t.name)}</strong> (${esc(t.province)}): lo dejamos al día y seguro por <strong>30€/año</strong>, todo por email y sin permanencia.`,
    `Tu tienda WooCommerce en <strong>${esc(t.name)}</strong> (${esc(t.province)}), siempre online: actualizaciones probadas, velocidad, seguridad y soporte por email por <strong>30€/año</strong>. Empieza con una auditoría gratis.`,
  ];
  return v[hash(t.slug) % v.length];
}

const CSS = `
:root{--bg:#0a0a0d;--s1:#11141a;--s2:#171b22;--v:#7c5cff;--b:#1f2330;--t:#e2e8f0;--m:#94a3b8;--g:#34d399}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--t);line-height:1.6}
a{color:var(--v);text-decoration:none}.wrap{max-width:900px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--b);padding:16px 0}header .wrap{display:flex;align-items:center;justify-content:space-between}
.logo{font-weight:700;font-size:18px;color:#fff}.badge{display:inline-block;border:1px solid #7c5cff55;background:#7c5cff14;color:#b9a8ff;border-radius:999px;padding:4px 12px;font-size:13px;margin-bottom:18px}
h1{font-size:32px;line-height:1.2;color:#fff;margin-bottom:14px}h2{font-size:23px;color:#fff;margin:0 0 14px}h3{font-size:17px;color:#fff;margin:0 0 4px}
p{color:var(--m);margin-bottom:14px}section{padding:28px 0;border-bottom:1px solid var(--b)}.hero{padding:46px 0 30px}
.lead{font-size:18px;color:#cbd5e1;max-width:660px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px}
@media(max-width:640px){.grid{grid-template-columns:1fr}h1{font-size:25px}}
.card{background:var(--s1);border:1px solid var(--b);border-radius:12px;padding:18px}.card.hl{border-color:#7c5cff66;background:#15101f}
.tick{color:var(--g);font-weight:700;margin-right:6px}.price{display:flex;align-items:flex-end;gap:8px;margin:6px 0 10px}.price .n{font-size:32px;font-weight:800;color:#fff}.price .u{color:var(--m);margin-bottom:6px}
form.audit{display:flex;gap:8px;margin:16px 0;flex-wrap:wrap}form.audit input{flex:1;min-width:220px;background:var(--s2);border:1px solid var(--b);border-radius:10px;color:var(--t);padding:14px;font-size:16px}
.btn{background:var(--v);color:#fff;border:0;border-radius:10px;padding:14px 22px;font-size:16px;font-weight:600;cursor:pointer;display:inline-block}.btn:hover{background:#6b4cf0}.btn[disabled]{opacity:.6}
#result{margin-top:8px}.score{display:flex;align-items:center;gap:16px;background:var(--s1);border:1px solid var(--b);border-radius:12px;padding:18px;margin-bottom:12px}.score .num{font-size:38px;font-weight:800}
.finding{background:var(--s1);border:1px solid var(--b);border-left:3px solid var(--v);border-radius:8px;padding:12px 14px;margin-bottom:8px}.finding b{color:#fff}.finding .fix{color:#6ee7b7;font-size:14px}
.pitch{background:#1a1530;border:1px solid #7c5cff55;border-radius:12px;padding:18px;margin-top:12px}.muted{font-size:13px;color:#64748b}
ul.chk{list-style:none;margin:6px 0}ul.chk li{color:var(--m);padding:3px 0}ul.chk li::before{content:"✓";color:var(--g);font-weight:700;margin-right:8px}
details{background:var(--s1);border:1px solid var(--b);border-radius:10px;padding:14px 16px;margin-bottom:10px}summary{color:#fff;font-weight:600;cursor:pointer}details p{margin:10px 0 0}
.links{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.links a{background:var(--s1);border:1px solid var(--b);border-radius:8px;padding:6px 10px;font-size:13px;color:#cbd5e1}
footer{padding:28px 0;color:#64748b;font-size:14px}`;

const FORM_JS = `(function(){var f=document.getElementById('auditForm'),i=document.getElementById('url'),b=document.getElementById('auditBtn'),r=document.getElementById('result');var SEV={high:'#fb7185',medium:'#fbbf24',low:'#94a3b8'};function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}f.addEventListener('submit',function(e){e.preventDefault();var url=i.value.trim();if(!url)return;b.disabled=true;b.textContent='Analizando…';r.innerHTML='<p class="muted">Auditando tu tienda…</p>';fetch('/api/audit-store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url})}).then(function(res){return res.json().then(function(d){return{ok:res.ok,d:d}})}).then(function(o){if(!o.ok){r.innerHTML='<p style="color:#fb7185">'+esc(o.d.error||'No se pudo auditar.')+'</p>';return}var d=o.d,col=d.score>=75?'#34d399':d.score>=50?'#fb923c':'#fb7185';var html='<div class="score"><div class="num" style="color:'+col+'">'+d.score+'</div><div><div style="color:#fff;font-weight:600">'+esc(d.scoreLabel)+'</div><div class="muted">'+(d.platform.isWooCommerce?'WooCommerce detectado':d.platform.isWordPress?'WordPress detectado':'No es WordPress')+'</div></div></div>';(d.findings||[]).slice(0,3).forEach(function(x){html+='<div class="finding" style="border-left-color:'+(SEV[x.severity]||'#94a3b8')+'"><b>'+esc(x.title)+'</b><div class="muted">'+esc(x.detail)+'</div><div class="fix">→ '+esc(x.fix)+'</div></div>'});if(d.pitch){html+='<div class="pitch"><b style="color:#fff">'+esc(d.pitch.headline)+'</b><p style="margin:6px 0 10px">'+esc(d.pitch.body)+'</p><a class="btn" href="mailto:tiendas@bot.utopiaia.com?subject=Mantenimiento%20para%20mi%20tienda">Quiero arreglarlo por '+(d.pitch.tier||30)+'€/año →</a></div>'}r.innerHTML=html}).catch(function(){r.innerHTML='<p style="color:#fb7185">Error al auditar.</p>'}).finally(function(){b.disabled=false;b.textContent='Auditar gratis'})})})();`;

function renderLocationPage(t) {
  const url = `${BASE}/mantenimiento-woocommerce-${t.slug}`;
  const title = `Mantenimiento WooCommerce ${t.name} | Auditoría gratis 30€/año`.slice(0, 65);
  // 6 sibling links for internal linking (deterministic, stable per town).
  const others = TOWNS.filter(x => x.slug !== t.slug);
  const start = hash(t.slug) % Math.max(1, others.length);
  const siblings = others.length ? Array.from({ length: Math.min(6, others.length) }, (_, k) => others[(start + k) % others.length]) : [];
  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Mantenimiento de tu tienda WooCommerce en ${esc(t.name)} (${esc(t.province)}) por 30€/año: actualizaciones, velocidad, seguridad y copias, por email y sin permanencia. Auditoría gratis.">
<meta name="robots" content="index, follow"><link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:title" content="Mantenimiento WooCommerce ${esc(t.name)} · 30€/año">
<meta property="og:description" content="Audita tu tienda gratis y la mantenemos al día por 30€/año. ${esc(t.name)}, ${esc(t.province)}."><meta property="og:url" content="${url}"><meta property="og:locale" content="es_ES">
<style>${CSS}</style>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ProfessionalService',
    name: `Utopia IA — Mantenimiento WooCommerce ${t.name}`,
    description: `Mantenimiento de tiendas WooCommerce y WordPress en ${t.name} (${t.province}): actualizaciones, velocidad, seguridad y copias, gestionado por email.`,
    areaServed: { '@type': 'City', name: t.name }, url, email: 'tiendas@bot.utopiaia.com', priceRange: '€',
    makesOffer: { '@type': 'Offer', name: 'Mantenimiento WooCommerce', price: '30', priceCurrency: 'EUR' },
  })}</script>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [
      { '@type': 'Question', name: `¿Cuánto cuesta mantener una tienda WooCommerce en ${t.name}?`, acceptedAnswer: { '@type': 'Answer', text: `Las agencias cobran 90-300€/mes. Nosotros automatizamos y gestionamos por email, así que son 30€/año para WooCommerce y 5€/año para WordPress básico, sin permanencia.` } },
      { '@type': 'Question', name: '¿Trabajáis en remoto?', acceptedAnswer: { '@type': 'Answer', text: `Sí. Atendemos tiendas de ${t.name} y toda la provincia de ${t.province} en remoto, gestionado por email. No hace falta vernos.` } },
      { '@type': 'Question', name: '¿Hay permanencia?', acceptedAnswer: { '@type': 'Answer', text: 'No, 30€/año sin permanencia y con 30 días de garantía de devolución.' } },
    ],
  })}</script></head><body>
<header><div class="wrap"><a class="logo" href="/mantenimiento-woocommerce-madrid">Utopia IA</a><a class="btn" style="padding:8px 16px;font-size:14px" href="#auditar">Auditar mi tienda</a></div></header>
<main class="wrap">
<section class="hero" style="border:0"><span class="badge">${esc(t.name)} · ${esc(t.province)} · sin permanencia</span>
<h1>Mantenimiento de tu tienda WooCommerce en ${esc(t.name)}</h1>
<p class="lead">${introVariant(t)}</p>
<div style="margin-top:14px"><a class="btn" href="#auditar">Auditar mi tienda gratis →</a></div></section>
<section id="auditar" style="border:0"><h2>Audita tu tienda gratis</h2>
<p>Pega la dirección de tu tienda y te decimos al instante qué falla: velocidad, plugins desactualizados, seguridad y SEO. Sin registro.</p>
<form class="audit" id="auditForm"><input type="text" id="url" placeholder="mitienda.com" autocomplete="off" required><button class="btn" type="submit" id="auditBtn">Auditar gratis</button></form>
<div id="result"></div></section>
<section><h2>Qué incluye</h2><div class="grid">
<div class="card"><h3><span class="tick">✓</span>Actualizaciones</h3><p>WordPress, WooCommerce y plugins al día, con copia previa.</p></div>
<div class="card"><h3><span class="tick">✓</span>Velocidad y checkout</h3><p>Optimización para que no pierdas ventas por lentitud.</p></div>
<div class="card"><h3><span class="tick">✓</span>Seguridad y malware</h3><p>Vigilancia y limpieza si tu tienda ha sido hackeada.</p></div>
<div class="card"><h3><span class="tick">✓</span>Copias y soporte</h3><p>Copias externas y soporte por email cuando algo falla.</p></div></div></section>
<section><h2>Precio para ${esc(t.name)}, sin permanencia</h2><div class="grid">
<div class="card hl"><h3>Tienda WooCommerce</h3><div class="price"><span class="n">30€</span><span class="u">/año</span></div><ul class="chk"><li>Mantenimiento completo</li><li>Velocidad y seguridad</li><li>Soporte por email</li></ul></div>
<div class="card"><h3>Web WordPress básica</h3><div class="price"><span class="n">5€</span><span class="u">/año</span></div><ul class="chk"><li>Actualizaciones y copias</li><li>Seguridad básica</li></ul></div></div>
<p class="muted">Las agencias cobran 90-300€/mes. Nosotros automatizamos y gestionamos por email — por eso 30€/año.</p></section>
<section><h2>Preguntas frecuentes</h2>
<details><summary>¿Cuánto cuesta mantener una tienda WooCommerce en ${esc(t.name)}?</summary><p>Las agencias cobran 90-300€/mes. Nosotros 30€/año (WooCommerce) y 5€/año (WordPress básico), sin permanencia.</p></details>
<details><summary>¿Trabajáis en remoto para ${esc(t.name)}?</summary><p>Sí, atendemos ${esc(t.name)} y toda la provincia de ${esc(t.province)} en remoto, por email. No hace falta vernos.</p></details>
<details><summary>Mi tienda está caída o hackeada, ¿podéis ayudarme?</summary><p>Sí. Restauramos copia limpia, cambiamos contraseñas, limpiamos malware y actualizamos. Escríbenos a tiendas@bot.utopiaia.com.</p></details></section>
${siblings.length ? `<section><h2>Otras zonas</h2><div class="links"><a href="/zonas-mantenimiento-woocommerce">Ver todas</a>${siblings.map(s => `<a href="/mantenimiento-woocommerce-${s.slug}">${esc(s.name)}</a>`).join('')}</div></section>` : ''}
<section style="border:0"><h2>Audita tu tienda de ${esc(t.name)} gratis</h2><p>Te decimos qué mejorar. Si quieres, la mantenemos por 30€/año.</p>
<div style="margin-top:12px"><a class="btn" href="#auditar">Auditar mi tienda →</a> &nbsp;<a href="mailto:tiendas@bot.utopiaia.com?subject=Mantenimiento%20en%20${encodeURIComponent(t.name)}">o escríbenos</a></div></section>
</main><footer><div class="wrap">Utopia IA — mantenimiento WooCommerce y WordPress en ${esc(t.name)} (${esc(t.province)}) · <a href="mailto:tiendas@bot.utopiaia.com">tiendas@bot.utopiaia.com</a></div></footer>
<script>${FORM_JS}</script></body></html>`;
}

function renderHub() {
  const byProv = {};
  for (const t of TOWNS) (byProv[t.province] = byProv[t.province] || []).push(t);
  const provinces = Object.keys(byProv).sort();
  const body = provinces.map(p => `<h3>${esc(p)}</h3><div class="links">${byProv[p].map(t => `<a href="/mantenimiento-woocommerce-${t.slug}">${esc(t.name)}</a>`).join('')}</div>`).join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mantenimiento WooCommerce por zonas en España | Utopia IA</title>
<meta name="description" content="Mantenimiento de tiendas WooCommerce y WordPress en ${TOWNS.length} localidades de España, por 30€/año y sin permanencia. Encuentra tu zona.">
<link rel="canonical" href="${BASE}/zonas-mantenimiento-woocommerce"><style>${CSS}</style></head><body>
<header><div class="wrap"><a class="logo" href="/mantenimiento-woocommerce-madrid">Utopia IA</a></div></header>
<main class="wrap"><section style="border:0"><h1>Mantenimiento WooCommerce por zonas</h1>
<p>Mantenemos tiendas online en toda España en remoto, por email, desde 30€/año. Elige tu localidad:</p>${body}</section></main>
<footer><div class="wrap">Utopia IA · <a href="mailto:tiendas@bot.utopiaia.com">tiendas@bot.utopiaia.com</a></div></footer></body></html>`;
}

function renderSitemap() {
  const urls = [
    `${BASE}/mantenimiento-woocommerce-madrid`,
    `${BASE}/zonas-mantenimiento-woocommerce`,
    ...TOWNS.map(t => `${BASE}/mantenimiento-woocommerce-${t.slug}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${u}</loc><changefreq>weekly</changefreq></url>`).join('\n') + `\n</urlset>\n`;
}

function getTown(slug) { return bySlug.get(slug) || null; }

module.exports = { renderLocationPage, renderHub, renderSitemap, getTown, count: () => TOWNS.length };

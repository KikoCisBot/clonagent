import { useState, useEffect } from 'react';
import {
  Search, ShoppingCart, Globe, Zap, ShieldAlert, TrendingUp, Wrench,
  ArrowRight, CheckCircle2, AlertTriangle, Gauge, Loader2, Sparkles,
} from 'lucide-react';

// ── Visual helpers ────────────────────────────────────────────────────────────
const AREA_ICON = {
  speed: Zap, security: ShieldAlert, seo: TrendingUp, ecommerce: ShoppingCart, maintenance: Wrench,
};
const SEV = {
  high:   { dot: 'bg-rose-500',   text: 'text-rose-300',   ring: 'border-rose-500/30',   bg: 'bg-rose-500/5',   label: 'Urgente' },
  medium: { dot: 'bg-amber-500',  text: 'text-amber-300',  ring: 'border-amber-500/30',  bg: 'bg-amber-500/5',  label: 'Importante' },
  low:    { dot: 'bg-slate-500',  text: 'text-slate-300',  ring: 'border-slate-700',     bg: 'bg-surface-2',    label: 'Menor' },
};
function scoreColor(s) {
  if (s >= 90) return '#34d399';   // emerald
  if (s >= 75) return '#fbbf24';   // amber
  if (s >= 50) return '#fb923c';   // orange
  return '#fb7185';                // rose
}

// Circular score gauge.
function ScoreRing({ score, label }) {
  const r = 52, c = 2 * Math.PI * r, off = c * (1 - score / 100), col = scoreColor(score);
  return (
    <div className="relative flex items-center justify-center w-32 h-32 flex-shrink-0">
      <svg width="128" height="128" className="-rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="#1f2330" strokeWidth="9" />
        <circle cx="64" cy="64" r={r} fill="none" stroke={col} strokeWidth="9"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold" style={{ color: col }}>{score}</span>
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">/ 100</span>
      </div>
    </div>
  );
}

const LOADING_STEPS = [
  'Conectando con tu tienda…',
  'Detectando WordPress y WooCommerce…',
  'Midiendo velocidad de carga…',
  'Revisando plugins y versiones…',
  'Comprobando seguridad…',
  'Generando tu informe…',
];

// ── Main widget ────────────────────────────────────────────────────────────────
export default function StoreAudit() {
  const [url, setUrl]       = useState('');
  const [state, setState]   = useState('idle'); // idle | loading | done | error
  const [report, setReport] = useState(null);
  const [error, setError]   = useState('');
  const [step, setStep]     = useState(0);

  // Lead capture (post-report)
  const [email, setEmail]   = useState('');
  const [leadState, setLeadState] = useState('idle'); // idle | sending | sent

  useEffect(() => {
    if (state !== 'loading') return;
    setStep(0);
    const id = setInterval(() => setStep(s => Math.min(s + 1, LOADING_STEPS.length - 1)), 1400);
    return () => clearInterval(id);
  }, [state]);

  async function runAudit(e) {
    e?.preventDefault();
    if (!url.trim()) return;
    setState('loading'); setError(''); setReport(null); setLeadState('idle');
    try {
      const r = await fetch('/api/audit-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo auditar la tienda.');
      setReport(data);
      setState('done');
    } catch (err) {
      setError(err.message || 'No se pudo auditar la tienda.');
      setState('error');
    }
  }

  async function submitLead(e) {
    e.preventDefault();
    if (!email.includes('@')) return;
    setLeadState('sending');
    try {
      await fetch('/api/audit-store/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, url: report?.finalUrl, score: report?.score }),
      });
      setLeadState('sent');
    } catch { setLeadState('sent'); /* don't block the user on a logging failure */ }
  }

  return (
    <section id="audit" className="max-w-4xl mx-auto px-6 py-16 border-t border-border-subtle">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-xs text-violet-300 mb-4">
          <Gauge size={11} /> Diagnóstico gratis · sin registro
        </div>
        <h2 className="text-2xl sm:text-3xl font-semibold text-slate-100 mb-3">
          Audita tu tienda online en 10 segundos
        </h2>
        <p className="text-slate-400 max-w-xl mx-auto">
          Pega la dirección de tu tienda WooCommerce y te decimos al instante qué falla:
          velocidad, plugins desactualizados, seguridad y SEO. Sin compromiso.
        </p>
      </div>

      {/* Input */}
      <form onSubmit={runAudit} className="flex flex-col sm:flex-row gap-2 max-w-xl mx-auto mb-8">
        <div className="relative flex-1">
          <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text" value={url} onChange={e => setUrl(e.target.value)}
            placeholder="mitienda.com"
            className="input pl-9 text-base py-3"
            disabled={state === 'loading'}
          />
        </div>
        <button type="submit" disabled={state === 'loading' || !url.trim()}
          className="btn-primary px-6 py-3 text-base justify-center whitespace-nowrap disabled:opacity-50">
          {state === 'loading'
            ? <><Loader2 size={16} className="animate-spin" /> Analizando…</>
            : <><Search size={16} /> Auditar gratis</>}
        </button>
      </form>

      {/* Loading */}
      {state === 'loading' && (
        <div className="card max-w-xl mx-auto flex items-center gap-3 text-slate-300">
          <Loader2 size={18} className="animate-spin text-violet flex-shrink-0" />
          <span className="text-sm">{LOADING_STEPS[step]}</span>
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div className="card max-w-xl mx-auto border-rose-500/30 bg-rose-500/5 flex items-center gap-3">
          <AlertTriangle size={18} className="text-rose-400 flex-shrink-0" />
          <span className="text-sm text-rose-200">{error}</span>
        </div>
      )}

      {/* Report */}
      {state === 'done' && report && (
        <div className="max-w-3xl mx-auto space-y-5">

          {/* Score + platform */}
          <div className="card flex flex-col sm:flex-row items-center gap-6">
            <ScoreRing score={report.score} label={report.scoreLabel} />
            <div className="flex-1 text-center sm:text-left">
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Salud de la tienda</div>
              <div className="text-xl font-semibold text-slate-100 mb-2">{report.scoreLabel}</div>
              <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                {report.platform.isWooCommerce && (
                  <span className="pill-on"><ShoppingCart size={10} /> WooCommerce{report.platform.wooVersion ? ` ${report.platform.wooVersion}` : ''}</span>
                )}
                {report.platform.isWordPress && (
                  <span className="pill-on"><Globe size={10} /> WordPress{report.platform.wpVersion ? ` ${report.platform.wpVersion}` : ''}</span>
                )}
                {report.platform.theme && <span className="pill-off">tema: {report.platform.theme}</span>}
                {report.pluginCount > 0 && <span className="pill-off">{report.pluginCount} plugins</span>}
                {!report.platform.isWordPress && <span className="pill-off">No es WordPress</span>}
              </div>
            </div>
          </div>

          {/* Perf metrics */}
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Respuesta (TTFB)" value={`${report.performance.ttfbMs} ms`} good={report.performance.ttfbMs <= 800} />
            <Metric label="Carga total" value={`${(report.performance.totalMs / 1000).toFixed(1)} s`} good={report.performance.totalMs <= 1500} />
            <Metric label="Scripts" value={report.performance.assets.scripts} good={report.performance.assets.scripts <= 25} />
          </div>

          {/* Findings */}
          {report.findings.length > 0 ? (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-200 px-1">
                {report.findings.length} {report.findings.length === 1 ? 'punto a mejorar' : 'puntos a mejorar'}
              </div>
              {report.findings.map((f, i) => {
                const Icon = AREA_ICON[f.area] || Wrench;
                const sev = SEV[f.severity];
                return (
                  <div key={i} className={`card ${sev.ring} ${sev.bg} flex gap-3`}>
                    <div className="flex flex-col items-center gap-1 pt-0.5">
                      <span className={`w-2 h-2 rounded-full ${sev.dot}`} />
                      <Icon size={14} className="text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-100 text-sm">{f.title}</span>
                        <span className={`text-[10px] uppercase tracking-wide ${sev.text}`}>{sev.label}</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{f.detail}</p>
                      <p className="text-xs text-emerald-300/80 mt-1 flex items-start gap-1">
                        <Wrench size={11} className="mt-0.5 flex-shrink-0" /> {f.fix}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card border-emerald-500/30 bg-emerald-500/5 flex items-center gap-3">
              <CheckCircle2 size={18} className="text-emerald-400" />
              <span className="text-sm text-emerald-200">No hemos encontrado problemas graves. ¡Buen trabajo!</span>
            </div>
          )}

          {/* Pitch + lead capture */}
          <div className="card border-violet/40 bg-violet/5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-violet/20 flex items-center justify-center flex-shrink-0">
                <Sparkles size={18} className="text-violet-300" />
              </div>
              <div>
                <div className="font-semibold text-slate-100">{report.pitch.headline}</div>
                <p className="text-sm text-slate-400 mt-1">{report.pitch.body}</p>
              </div>
            </div>

            {leadState === 'sent' ? (
              <div className="flex items-center gap-2 text-emerald-300 text-sm">
                <CheckCircle2 size={16} /> ¡Recibido! Te escribimos con tu informe y los siguientes pasos.
              </div>
            ) : (
              <form onSubmit={submitLead} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  className="input flex-1 py-2.5"
                />
                <button type="submit" disabled={leadState === 'sending'}
                  className="btn-primary px-5 py-2.5 justify-center whitespace-nowrap">
                  {leadState === 'sending' ? '…' : <>Arregládmelo por {report.pitch.tier}€/año <ArrowRight size={14} /></>}
                </button>
              </form>
            )}
            <p className="text-[11px] text-slate-600 mt-2">
              Te enviamos el informe completo y una propuesta. Sin compromiso · puedes darte de baja cuando quieras.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, good }) {
  return (
    <div className="card py-3 text-center">
      <div className={`text-lg font-bold ${good ? 'text-emerald-300' : 'text-amber-300'}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

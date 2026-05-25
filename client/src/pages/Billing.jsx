import { useState, useEffect } from 'react';
import { CreditCard, Zap, ArrowRight, CheckCircle2, AlertCircle, ExternalLink, Sparkles } from 'lucide-react';
import { api } from '../api.js';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    features: ['1 agent', '20 runs / month', 'Own Anthropic API key required', 'Community support'],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 29,
    highlight: true,
    features: ['5 agents', '200 runs / month', 'Platform API key included', 'Email support'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 99,
    features: ['20 agents', 'Unlimited runs', 'Platform API key included', 'Priority support'],
  },
];

export default function Billing() {
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(null);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api('/api/billing/me').then(setBilling).catch(() => {}).finally(() => setLoading(false));
    // Handle Stripe redirect back
    const params = new URLSearchParams(window.location.search);
    if (params.get('success')) {
      setTimeout(() => {
        api('/api/billing/me').then(setBilling).catch(() => {});
        window.history.replaceState({}, '', '/billing');
      }, 2000);
    }
  }, []);

  async function checkout(planId) {
    setBusy(planId); setError('');
    try {
      const { url } = await api('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ planId }),
      });
      window.location.href = url;
    } catch (e) {
      setError(e.message || 'Stripe not configured yet — add STRIPE_SECRET_KEY to .env');
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy('portal'); setError('');
    try {
      const { url } = await api('/api/billing/portal', { method: 'POST' });
      window.open(url, '_blank');
    } catch (e) {
      setError(e.message);
    } finally { setBusy(null); }
  }

  const currentPlan = billing?.plan || 'free';
  const params = new URLSearchParams(window.location.search);
  const justUpgraded = params.get('success') === '1';

  if (loading) return <div className="p-6 text-slate-500 text-sm">Loading…</div>;

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-slate-100 mb-1 flex items-center gap-2">
        <CreditCard size={16} className="text-violet-300" /> Billing &amp; Plan
      </h1>
      <p className="text-xs text-slate-500 mb-6">Manage your subscription and limits.</p>

      {justUpgraded && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 size={14} /> Subscription activated — welcome to {PLANS.find(p => p.id === currentPlan)?.name}!
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span className="font-mono text-xs">{error}</span>
        </div>
      )}

      {/* Current plan status */}
      <div className="card mb-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Current plan</div>
            <div className="text-xl font-bold text-slate-100">
              {PLANS.find(p => p.id === currentPlan)?.name || 'Free'}
            </div>
            {billing?.planExpiresAt && (
              <div className="text-xs text-slate-500 mt-1">
                Renews {new Date(billing.planExpiresAt).toLocaleDateString('en')}
              </div>
            )}
            {billing?.subscriptionStatus && billing.subscriptionStatus !== 'free' && (
              <div className={`text-xs mt-1 ${billing.subscriptionStatus === 'active' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {billing.subscriptionStatus}
              </div>
            )}
          </div>
          <div className="text-right text-sm text-slate-400">
            <div>{billing?.maxAgents ?? 1} agents</div>
            <div>{billing?.maxRunsPerMonth ? `${billing.maxRunsPerMonth} runs/mo` : 'Unlimited runs'}</div>
          </div>
        </div>
        {billing?.stripeCustomerId && (
          <button
            onClick={openPortal}
            disabled={busy === 'portal'}
            className="btn-ghost text-xs mt-3"
          >
            <ExternalLink size={12} />
            {busy === 'portal' ? 'Opening…' : 'Manage subscription in Stripe portal'}
          </button>
        )}
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.map(plan => {
          const isCurrent = plan.id === currentPlan;
          return (
            <div key={plan.id} className={`card flex flex-col gap-4 ${plan.highlight ? 'border-violet/50 relative' : ''}`}>
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-violet text-white text-[10px] font-semibold px-3 py-1">
                  <Sparkles size={10} /> Most popular
                </div>
              )}
              <div>
                <div className="text-sm font-semibold text-slate-300">{plan.name}</div>
                <div className="flex items-end gap-1 mt-1">
                  <span className="text-2xl font-bold text-slate-100">${plan.price}</span>
                  {plan.price > 0 && <span className="text-slate-500 text-xs mb-1">/month</span>}
                </div>
              </div>
              <ul className="space-y-2 flex-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs text-slate-300">
                    <CheckCircle2 size={12} className="text-emerald-400 flex-shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
                  <CheckCircle2 size={12} /> Current plan
                </div>
              ) : (
                <button
                  onClick={() => plan.id !== 'free' ? checkout(plan.id) : null}
                  disabled={!!busy || plan.id === 'free'}
                  className={`btn-primary justify-center py-2 text-xs ${plan.id === 'free' ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  {busy === plan.id ? 'Redirecting…' : plan.id === 'free' ? 'Downgrade' : `Upgrade to ${plan.name}`}
                  {busy !== plan.id && plan.id !== 'free' && <ArrowRight size={12} />}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-600 mt-6">
        Payments are processed securely by Stripe. Cancel anytime from the Stripe portal.
        Questions? <a href="mailto:support@utopiaia.com" className="text-slate-500 hover:text-slate-400">support@utopiaia.com</a>
      </p>
    </div>
  );
}

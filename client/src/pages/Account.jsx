import { useEffect, useState } from 'react';
import { User, Save, KeyRound, Cpu, Server, Eye, EyeOff, CreditCard, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Account() {
  const [me,   setMe]   = useState(null);
  const [billing, setBilling] = useState(null);
  const [s,    setS]    = useState({});
  const [pw,   setPw]   = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg,  setMsg]  = useState('');

  async function reload() {
    const [u, b] = await Promise.all([
      api('/api/auth/me'),
      api('/api/billing/me').catch(() => null),
    ]);
    setMe(u);
    setS(u.settings || {});
    setBilling(b);
  }
  useEffect(() => { reload().catch(() => {}); }, []);

  function field(k, v) { setS(prev => ({ ...prev, [k]: v })); }

  async function save() {
    setBusy(true); setMsg('');
    try {
      await api('/api/auth/me', { method: 'PATCH', body: JSON.stringify({
        settings: s,
        password: pw || undefined,
      }) });
      setMsg('Saved.');
      setPw('');
      reload();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  if (!me) return <div className="p-6 text-slate-500 text-sm">Loading…</div>;

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl">
      <h1 className="text-lg font-semibold text-slate-100 mb-1 flex items-center gap-2">
        <User size={16} className="text-violet-300" /> My account
      </h1>
      <p className="text-xs text-slate-500 mb-6">Your personal credentials for the chat. Never shared with other users.</p>

      {billing && (
        <div className="card mb-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-0.5">Plan</div>
            <div className="text-sm font-semibold text-slate-100">{billing.planName}</div>
            <div className="text-[11px] text-slate-500">
              {billing.maxAgents} agents · {billing.maxRunsPerMonth ? `${billing.maxRunsPerMonth} runs/mo` : 'unlimited runs'}
            </div>
          </div>
          <Link to="/billing" className="btn-ghost text-xs">
            <CreditCard size={12} /> Manage <ArrowRight size={11} />
          </Link>
        </div>
      )}

      <div className="space-y-4">
        <Section icon={Cpu} title="Model" desc="Claude model used by your chat (overrides the system default).">
          <Field label="Model name" value={s.model} onChange={v => field('model', v)} placeholder="claude-opus-4-7" mono />
        </Section>

        <Section icon={KeyRound} title="API key" desc="Your key for calling the model. Anthropic API key goes directly to anthropic.com. Relay key uses the system relay with your token.">
          <Field label="Anthropic API key" value={s.anthropicApiKey} onChange={v => field('anthropicApiKey', v)} placeholder="sk-ant-…" mono secret={!show} />
          <Field label="Relay key (alternative)" value={s.relayKey} onChange={v => field('relayKey', v)} placeholder="optional" mono secret={!show} />
          <button type="button" className="btn-ghost text-xs" onClick={() => setShow(v => !v)}>
            {show ? <EyeOff size={11} /> : <Eye size={11} />} {show ? 'Hide' : 'Show'}
          </button>
        </Section>

        <Section icon={Server} title="Relay (advanced)" desc="Override the relay URL. By default uses the system relay.">
          <Field label="Relay URL" value={s.relayUrl} onChange={v => field('relayUrl', v)} placeholder="http://localhost:3202" mono />
        </Section>

        <Section icon={KeyRound} title="Change password">
          <input type="password" autoComplete="new-password" className="input font-mono"
            placeholder="new password (≥6 chars; leave blank to keep current)"
            value={pw} onChange={e => setPw(e.target.value)} />
        </Section>
      </div>

      <div className="flex items-center gap-3 mt-6">
        <button className="btn-primary" onClick={save} disabled={busy}>
          <Save size={13} /> {busy ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className="text-xs text-slate-400">{msg}</span>}
      </div>

      <div className="mt-8 pt-4 border-t border-border-subtle text-xs text-slate-500 space-y-1">
        <div>Username: <span className="font-mono text-slate-300">{me.username}</span> {me.isAdmin && <span className="pill bg-amber-500/10 text-amber-300 border border-amber-500/30 ml-1">admin</span>}</div>
        <div>Email: {me.email || '—'}</div>
        <div>Joined: {new Date(me.createdAt).toLocaleDateString('en')}</div>
        {me.lastLoginAt && <div>Last login: {new Date(me.lastLoginAt).toLocaleString('en')}</div>}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, desc, children }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-2">
        <div className="w-7 h-7 rounded-lg bg-violet/15 border border-violet/30 flex items-center justify-center">
          <Icon size={13} className="text-violet-300" />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-200">{title}</div>
          {desc && <div className="text-[11px] text-slate-500">{desc}</div>}
        </div>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono, secret }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider text-slate-500">{label}</label>
      <input
        type={secret ? 'password' : 'text'}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`input mt-1 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

import { useState, useEffect } from 'react';
import { LogIn, KeyRound, Bot, UserPlus, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Login({ onAuthed }) {
  const [mode, setMode]                   = useState('basic');
  const [allowRegistration, setAllowReg]  = useState(false);
  const [view, setView]                   = useState('login'); // 'login' | 'register' | 'forgot'
  const [username, setUsername]           = useState('');
  const [password, setPassword]           = useState('');
  const [name, setName]                   = useState('');
  const [email, setEmail]                 = useState('');
  const [busy, setBusy]                   = useState(false);
  const [err,  setErr]                    = useState('');
  const [info, setInfo]                   = useState('');

  useEffect(() => {
    api('/api/auth/whoami').then(r => {
      setMode(r.mode);
      setAllowReg(!!r.allowRegistration);
    }).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setInfo('');
    try {
      if (view === 'forgot') {
        await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
        setInfo('If that email is registered, a reset link is on its way.');
        setBusy(false);
        return;
      }
      const url = view === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body = view === 'register'
        ? { username, password, name, email }
        : { username, password };
      const r = await api(url, { method: 'POST', body: JSON.stringify(body) });
      onAuthed(r.user);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (mode === 'oidc') return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="card w-full max-w-sm space-y-4 text-center">
        <div className="w-12 h-12 rounded-2xl bg-violet/15 border border-violet/30 mx-auto flex items-center justify-center">
          <Bot size={20} className="text-violet-300" />
        </div>
        <h1 className="text-lg font-semibold text-slate-100">ClonAgent</h1>
        <p className="text-sm text-slate-400">Sign in with your corporate identity.</p>
        <a href="/api/auth/oidc/start" className="btn-primary w-full justify-center">
          <LogIn size={14} /> Sign in with SSO
        </a>
      </div>
    </div>
  );

  if (mode === 'none') {
    onAuthed({ sub: 'anon', name: 'anon', mode: 'none' });
    return null;
  }

  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <form onSubmit={submit}
            className="card w-full max-w-sm space-y-4"
            autoComplete="on">
        <div className="text-center">
          <Link to="/" className="inline-block">
            <div className="w-12 h-12 rounded-2xl bg-violet/15 border border-violet/30 mx-auto flex items-center justify-center mb-2">
              <Bot size={20} className="text-violet-300" />
            </div>
          </Link>
          <h1 className="text-lg font-semibold text-slate-100">ClonAgent</h1>
          <p className="text-xs text-slate-500">
            {view === 'login'    ? 'Sign in to continue'
           : view === 'register' ? 'Create your account'
           :                      'Reset your password'}
          </p>
        </div>

        {view === 'forgot' ? (
          <div>
            <label className="text-[11px] uppercase tracking-wider text-slate-500">Email</label>
            <input type="email" required autoFocus autoComplete="email"
              className="input mt-1" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
        ) : (
          <>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-500">Username</label>
              <input name="username" type="text" autoComplete="username" autoFocus required
                className="input mt-1" value={username} onChange={e => setUsername(e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-500">Password</label>
              <input name="password" type="password"
                autoComplete={view === 'register' ? 'new-password' : 'current-password'}
                className="input mt-1" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {view === 'register' && (
              <>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-slate-500">Name (optional)</label>
                  <input className="input mt-1" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-slate-500">Email (optional)</label>
                  <input className="input mt-1" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
                </div>
              </>
            )}
          </>
        )}

        {err  && <div className="text-xs text-rose-300">{err}</div>}
        {info && <div className="text-xs text-emerald-300">{info}</div>}

        <button type="submit" className="btn-primary w-full justify-center" disabled={busy}>
          {view === 'register' ? <UserPlus size={14} />
         : view === 'forgot'   ? <Mail size={14} />
         :                       <KeyRound size={14} />}
          {busy ? '…'
         : view === 'register' ? 'Create account'
         : view === 'forgot'   ? 'Send reset link'
         :                       'Sign in'}
        </button>

        <div className="flex flex-col items-center gap-1.5">
          {allowRegistration && view !== 'forgot' && (
            <button type="button" onClick={() => { setView(v => v === 'login' ? 'register' : 'login'); setErr(''); }}
              className="text-xs text-slate-500 hover:text-slate-300 transition">
              {view === 'register' ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
            </button>
          )}
          {view === 'login' && (
            <button type="button" onClick={() => { setView('forgot'); setErr(''); setInfo(''); }}
              className="text-xs text-slate-600 hover:text-slate-400 transition">
              Forgot password?
            </button>
          )}
          {view === 'forgot' && (
            <button type="button" onClick={() => { setView('login'); setErr(''); setInfo(''); }}
              className="text-xs text-slate-500 hover:text-slate-300 transition">
              ← Back to sign in
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

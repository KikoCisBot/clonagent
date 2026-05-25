import { useEffect, useState } from 'react';
import { Settings2, Save, Server, Cpu, Globe, Activity, Lock, Users, Plus, Trash2, GitBranch, Database, UserPlus, ShieldCheck, Mail as MailIcon, AlertCircle, Copy } from 'lucide-react';
import { api } from '../api.js';

export default function Settings() {
  const [cfg, setCfg]     = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]     = useState('');
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', name: '', email: '' });
  const [mailStatus, setMailStatus] = useState(null);
  const [mailboxes, setMailboxes]   = useState([]);
  const [newLocal, setNewLocal]     = useState('');
  const [createdMb, setCreatedMb]   = useState(null);

  async function reload() {
    const c = await api('/api/settings');
    setCfg(c); setDraft(c);
    try { setUsers(await api('/api/auth/users')); } catch {}
    try {
      const ms = await api('/api/mail/status');
      setMailStatus(ms);
      if (ms.available) setMailboxes(await api('/api/mail/mailboxes'));
    } catch {}
  }
  async function addMailbox() {
    if (!newLocal.trim()) return;
    try {
      const r = await api('/api/mail/mailboxes', {
        method: 'POST', body: JSON.stringify({ localPart: newLocal.trim() }),
      });
      setCreatedMb(r); setNewLocal(''); reload();
    } catch (e) { alert(e.message); }
  }
  async function delMailbox(email) {
    if (!confirm(`Eliminar el mailbox ${email}?`)) return;
    await api(`/api/mail/mailboxes/${encodeURIComponent(email)}`, { method: 'DELETE' });
    reload();
  }
  useEffect(() => { reload().catch(() => {}); }, []);

  function field(k, v)         { setDraft(d => ({ ...d, [k]: v })); }
  function authField(k, v)     { setDraft(d => ({ ...d, auth: { ...d.auth, [k]: v } })); }
  function oidcField(k, v)     { setDraft(d => ({ ...d, auth: { ...d.auth, oidc: { ...(d.auth?.oidc || {}), [k]: v } } })); }
  function intField(k, v)      { setDraft(d => ({ ...d, integrations: { ...(d.integrations || {}), [k]: v } })); }

  async function save() {
    setSaving(true); setMsg('');
    try {
      const next = await api('/api/settings', { method: 'PATCH', body: JSON.stringify(draft) });
      setCfg(next); setDraft(next);
      setMsg('Guardado.');
    } catch (e) { setMsg(e.message); }
    finally { setSaving(false); }
  }

  async function addUser() {
    if (!newUser.username || !newUser.password) return;
    try {
      await api('/api/auth/users', { method: 'POST', body: JSON.stringify(newUser) });
      setNewUser({ username: '', password: '', name: '', email: '' });
      reload();
    } catch (e) { alert(e.message); }
  }
  async function delUser(username) {
    if (!confirm(`Eliminar usuario "${username}"?`)) return;
    await api(`/api/auth/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    reload();
  }
  async function toggleAdmin(username, cur) {
    await api(`/api/auth/users/${encodeURIComponent(username)}/admin`, {
      method: 'PATCH', body: JSON.stringify({ isAdmin: !cur }),
    });
    reload();
  }

  if (!cfg) return <div className="p-6 text-slate-500 text-sm">Cargando…</div>;

  const mode = draft.auth?.mode || 'none';

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl">
      <h1 className="text-lg font-semibold text-slate-100 mb-1 flex items-center gap-2">
        <Settings2 size={16} className="text-violet-300" /> Settings
      </h1>
      <p className="text-xs text-slate-500 mb-6">Configuración del runtime de ClonAgent.</p>

      <div className="space-y-4">
        {/* ── Auth ─────────────────────────────────────────────────────── */}
        <Section icon={Lock} title="Autenticación" desc="Modo de login. Cambia y guarda; los usuarios actuales se desconectarán.">
          <div className="grid grid-cols-3 gap-2">
            {['none','basic','oidc'].map(m => (
              <button key={m}
                onClick={() => authField('mode', m)}
                className={`px-3 py-2 rounded-lg border text-sm capitalize transition ${
                  mode === m ? 'bg-violet/15 border-violet/40 text-violet-200' : 'border-border-subtle text-slate-400 hover:bg-surface-2'
                }`}>
                {m === 'none' ? 'Abierto' : m === 'basic' ? 'Básica' : 'SSO (OIDC)'}
              </button>
            ))}
          </div>

          {mode === 'basic' && (
            <div className="space-y-3 pt-3 border-t border-border-subtle">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!draft.auth?.allowRegistration}
                  onChange={e => authField('allowRegistration', e.target.checked)} />
                <UserPlus size={12} className="text-violet-300" />
                <span className="text-sm text-slate-200">Permitir registro abierto</span>
                <span className="text-[10px] text-slate-600">(cualquiera puede crear cuenta)</span>
              </label>

              <div className="text-[11px] uppercase tracking-wider text-slate-500 flex items-center gap-1 mt-3">
                <Users size={11} /> Usuarios ({users.length})
              </div>
              {users.length === 0 && (
                <div className="text-xs text-slate-600">Sin usuarios — añade el primero abajo o habilita registro abierto.</div>
              )}
              {users.map(u => (
                <div key={u.username} className="flex items-center justify-between bg-surface-2/50 rounded-lg px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-200">{u.username}</span>
                      {u.isAdmin && <span className="pill bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px]">admin</span>}
                    </div>
                    <div className="text-[10px] text-slate-600">
                      {u.email || '—'} · creado {new Date(u.createdAt).toLocaleDateString('es')}
                      {u.lastLoginAt && <> · last {new Date(u.lastLoginAt).toLocaleDateString('es')}</>}
                    </div>
                  </div>
                  <button onClick={() => toggleAdmin(u.username, u.isAdmin)} className="btn-ghost text-xs"
                    title={u.isAdmin ? 'Quitar admin' : 'Hacer admin'}>
                    <ShieldCheck size={11} />
                  </button>
                  <button onClick={() => delUser(u.username)} className="btn-ghost text-rose-300">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2 mt-3">
                <input className="input text-sm" placeholder="usuario"    value={newUser.username} onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))} />
                <input className="input text-sm" placeholder="contraseña" type="password" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))} />
                <input className="input text-sm" placeholder="nombre"     value={newUser.name}  onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))} />
                <input className="input text-sm" placeholder="email"      value={newUser.email} onChange={e => setNewUser(u => ({ ...u, email: e.target.value }))} />
              </div>
              <button className="btn-ghost text-xs" onClick={addUser}>
                <Plus size={11} /> Añadir usuario manualmente
              </button>
            </div>
          )}

          {mode === 'oidc' && (
            <div className="space-y-2 pt-2">
              <Field label="Issuer URL"     value={draft.auth?.oidc?.issuerUrl}    onChange={v => oidcField('issuerUrl', v)}    placeholder="https://keycloak.utopiaia.com/realms/kikocisbot" mono />
              <Field label="Client ID"      value={draft.auth?.oidc?.clientId}     onChange={v => oidcField('clientId', v)}     mono />
              <Field label="Client Secret"  value={draft.auth?.oidc?.clientSecret} onChange={v => oidcField('clientSecret', v)} mono secret />
              <Field label="Redirect URI"   value={draft.auth?.oidc?.redirectUri}  onChange={v => oidcField('redirectUri', v)}  mono />
              <p className="text-[11px] text-slate-500">
                Crea un cliente en Keycloak con esta Redirect URI y pega aquí el secret.
              </p>
            </div>
          )}
        </Section>

        <Section icon={Server} title="Host Relay" desc="El relay lanza sesiones de Claude CLI con la auth de subscripción.">
          <Field label="Relay URL" value={draft.relayUrl} onChange={v => field('relayUrl', v)} placeholder="http://localhost:3201" mono />
          <Field label="Internal API key" value={draft.relayKey} onChange={v => field('relayKey', v)} placeholder="relay-internal-2026" mono secret />
        </Section>

        <Section icon={Cpu} title="Model" desc="Modelo usado por el chat de configuración.">
          <Field label="Model name"  value={draft.model}     onChange={v => field('model', v)}     placeholder="claude-opus-4-7" mono />
        </Section>

        <Section icon={Globe} title="URL pública" desc="URL base para las URLs de tracking en los emails de los agentes.">
          <Field label="Public URL" value={draft.publicUrl} onChange={v => field('publicUrl', v)} placeholder="https://clonagent.utopiaia.com" mono />
        </Section>

        <Section icon={Activity} title="Polling" desc="Frecuencia con la que se revisa el inbox de cada agente.">
          <Field label="Cron pattern" value={draft.cron} onChange={v => field('cron', v)} placeholder="* * * * *" mono />
          <p className="text-[11px] text-slate-600 mt-1">Default <code>* * * * *</code> = cada minuto.</p>
        </Section>

        <Section icon={GitBranch} title="Gitea (built-in)" desc="Se usa para crear repos automáticamente cuando el chat detecta proyecto nuevo.">
          <Field label="URL"       value={draft.integrations?.giteaUrl}   onChange={v => intField('giteaUrl', v)}   placeholder="http://localhost:3200" mono />
          <Field label="Admin user" value={draft.integrations?.giteaUser} onChange={v => intField('giteaUser', v)} placeholder="kikocis" mono />
          <Field label="Token"     value={draft.integrations?.giteaToken} onChange={v => intField('giteaToken', v)} placeholder="…" mono secret />
        </Section>

        <Section icon={Database} title="PostgreSQL (built-in)" desc="Para provisionar bases de datos a proyectos nuevos.">
          <Field label="Container" value={draft.integrations?.pgContainer} onChange={v => intField('pgContainer', v)} placeholder="postgres-keycloak" mono />
          <Field label="Super user" value={draft.integrations?.pgSuperUser} onChange={v => intField('pgSuperUser', v)} placeholder="keycloak" mono />
          <Field label="Super DB"  value={draft.integrations?.pgSuperDb}   onChange={v => intField('pgSuperDb', v)}   placeholder="keycloak" mono />
        </Section>

        <Section icon={MailIcon} title={`Mail server (${mailStatus?.domain || 'bot.utopiaia.com'})`} desc="Mailboxes propios para que cada agente tenga su buzón. Cuando creas un agente IMAP el mailbox se aprovisiona automáticamente.">
          {!mailStatus?.available ? (
            <div className="card border-amber-500/30 bg-amber-500/5 space-y-2">
              <div className="flex items-start gap-2 text-sm">
                <AlertCircle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-slate-400">
                  Mail server no disponible. Corre el setup en el host (una vez):
                  <code className="block bg-surface-2 rounded p-2 font-mono text-[11px] mt-1.5 text-slate-300">
                    ssh ubuntu@145.239.65.26 'cd /home/ubuntu/clonagent && ./scripts/setup-mailserver.sh'
                  </code>
                </div>
              </div>
            </div>
          ) : (
            <>
              {createdMb && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                  <div className="text-sm font-medium text-emerald-200">Mailbox creado — guarda la password ahora, no se mostrará otra vez</div>
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="bg-surface-2 rounded p-2 flex items-center justify-between gap-2">
                      <span className="text-slate-500 mr-2">email:</span>
                      <span className="text-slate-100 truncate flex-1">{createdMb.email}</span>
                      <button onClick={() => navigator.clipboard.writeText(createdMb.email)} className="text-slate-400 hover:text-slate-200"><Copy size={11} /></button>
                    </div>
                    <div className="bg-surface-2 rounded p-2 flex items-center justify-between gap-2">
                      <span className="text-slate-500 mr-2">pass:</span>
                      <span className="text-slate-100 truncate flex-1">{createdMb.password}</span>
                      <button onClick={() => navigator.clipboard.writeText(createdMb.password)} className="text-slate-400 hover:text-slate-200"><Copy size={11} /></button>
                    </div>
                  </div>
                  <button className="btn-ghost text-xs" onClick={() => setCreatedMb(null)}>Cerrar</button>
                </div>
              )}
              <div className="flex gap-2">
                <input className="input flex-1 font-mono text-sm" placeholder="local-part (mia, soporte, …)"
                  value={newLocal} onChange={e => setNewLocal(e.target.value)} />
                <span className="self-center text-sm text-slate-500 font-mono">@{mailStatus.domain}</span>
                <button type="button" className="btn-primary text-sm" onClick={addMailbox} disabled={!newLocal.trim()}>
                  <Plus size={13} /> Crear
                </button>
              </div>
              {mailboxes.length === 0 ? (
                <div className="text-xs text-slate-600">Sin mailboxes (los agentes IMAP los crean automáticamente).</div>
              ) : (
                <div className="space-y-1.5">
                  {mailboxes.map(b => (
                    <div key={b.email} className="flex items-center justify-between bg-surface-2/50 rounded-lg px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <MailIcon size={11} className="text-violet-300" />
                        <span className="font-mono text-slate-200">{b.email}</span>
                      </div>
                      <button onClick={() => delMailbox(b.email)} className="text-rose-300 hover:text-rose-200">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Section>
      </div>

      <div className="flex items-center gap-3 mt-6">
        <button className="btn-primary" onClick={save} disabled={saving}>
          <Save size={13} /> {saving ? 'Guardando…' : 'Guardar'}
        </button>
        {msg && <span className="text-xs text-slate-400">{msg}</span>}
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
          <div className="text-[11px] text-slate-500">{desc}</div>
        </div>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono, secret }) {
  const [show, setShow] = useState(!secret);
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider text-slate-500">{label}</label>
      <div className="flex gap-2 mt-1">
        <input
          type={show ? 'text' : 'password'}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`input ${mono ? 'font-mono' : ''}`}
        />
        {secret && <button className="btn-ghost text-xs" onClick={() => setShow(s => !s)}>{show ? 'Hide' : 'Show'}</button>}
      </div>
    </div>
  );
}

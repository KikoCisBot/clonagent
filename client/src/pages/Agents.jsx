import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, KeyRound, Mail, Power, Play, Trash2, GitBranch, Server, X, Plus, Copy, CheckCheck, ListTodo, DollarSign, AlertTriangle } from 'lucide-react';
import { api } from '../api.js';
import VersionsModal from '../components/VersionsModal.jsx';
import McpModal from '../components/McpModal.jsx';

export default function Agents() {
  const nav = useNavigate();
  const [agents,   setAgents]   = useState([]);
  const [spending, setSpending] = useState({}); // agentId -> {today, this_month, all_time, runs_month}
  const [versionsFor, setVersionsFor] = useState(null);
  const [mcpFor,      setMcpFor]      = useState(null);

  async function reload() {
    const list = await api('/api/agents');
    setAgents(list);
    // Fetch spending for all agents in parallel
    const results = await Promise.allSettled(list.map(a =>
      api(`/api/agents/${a.id}/spending`).then(s => [a.id, s])
    ));
    const map = {};
    for (const r of results) {
      if (r.status === 'fulfilled') map[r.value[0]] = r.value[1];
    }
    setSpending(map);
  }
  useEffect(() => { reload().catch(() => {}); }, []);

  async function toggle(a) {
    const updated = await api(`/api/agents/${a.id}`, {
      method: 'PATCH', body: JSON.stringify({ enabled: !a.enabled }),
    });
    setAgents(list => list.map(x => x.id === a.id ? updated : x));
  }

  async function runNow(a) {
    try { await api(`/api/agents/${a.id}/run`, { method: 'POST' }); }
    catch (e) { alert(e.message); }
  }

  async function remove(a) {
    const msg = `Eliminar "${a.name}" completamente?\n\n` +
      `Esto borra:\n` +
      `  • la skill en ~/.claude/skills/${a.id}\n` +
      (a.botEmail?.endsWith('@bot.utopiaia.com') ? `  • el mailbox ${a.botEmail}\n` : '') +
      `  • todo el historial de versiones`;
    if (!confirm(msg)) return;
    try {
      await api(`/api/agents/${a.id}`, { method: 'DELETE' });
      reload();
    } catch (e) { alert(e.message); }
  }

  function senderEmails(agent) {
    return (agent.authorizedSenders || []).map(s => typeof s === 'string' ? s : s.email);
  }
  async function patchSenders(agent, next) {
    const updated = await api(`/api/agents/${agent.id}`, {
      method: 'PATCH', body: JSON.stringify({ authorizedSenders: next }),
    });
    setAgents(list => list.map(x => x.id === agent.id ? updated : x));
  }
  async function addSender(agent, email, role = 'reader') {
    email = (email || '').trim().toLowerCase();
    if (!email || !/.+@.+\..+/.test(email)) return;
    if (senderEmails(agent).includes(email)) return;
    const cur = (agent.authorizedSenders || []).map(s => typeof s === 'string' ? { email: s, role: 'reader' } : s);
    await patchSenders(agent, [...cur, { email, role }]);
  }
  async function removeSender(agent, email) {
    const cur = (agent.authorizedSenders || []).map(s => typeof s === 'string' ? { email: s, role: 'reader' } : s);
    await patchSenders(agent, cur.filter(s => s.email !== email));
  }
  async function changeRole(agent, email, newRole) {
    const cur = (agent.authorizedSenders || []).map(s => typeof s === 'string' ? { email: s, role: 'reader' } : s);
    await patchSenders(agent, cur.map(s => s.email === email ? { ...s, role: newRole } : s));
  }

  async function setSpendingLimit(agent, limitUsd) {
    const val = limitUsd === '' || limitUsd == null ? null : parseFloat(limitUsd);
    const updated = await api(`/api/agents/${agent.id}`, {
      method: 'PATCH', body: JSON.stringify({ spendingLimitMonthly: val }),
    });
    setAgents(list => list.map(x => x.id === agent.id ? updated : x));
  }

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Agents</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {agents.length} agente{agents.length === 1 ? '' : 's'} · {agents.filter(a=>a.enabled).length} activo{agents.filter(a=>a.enabled).length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="card text-center py-12 text-slate-500 text-sm">
          <Bot size={28} className="mx-auto mb-2 opacity-40" />
          Aún no tienes agentes — crea el primero desde Chat.
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map(a => (
            <div key={a.id} className="card">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-violet/15 border border-violet/30 flex items-center justify-center">
                  <Bot size={16} className="text-violet-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-100">{a.name}</span>
                    <span className={a.enabled ? 'pill-on' : 'pill-off'}>{a.enabled ? 'on' : 'off'}</span>
                    {a.version && <span className="pill bg-violet/10 border border-violet/30 text-violet-300 font-mono">v{a.version}</span>}
                    {a.mailProvider === 'imap'
                      ? (!a.hasImapCredentials && <span className="pill bg-amber-500/10 border border-amber-500/30 text-amber-300">sin imap-credentials.json</span>)
                      : (
                        <>
                          {!a.hasCredentials && <span className="pill bg-amber-500/10 border border-amber-500/30 text-amber-300">sin credentials.json</span>}
                          {a.hasCredentials && !a.hasToken && <span className="pill bg-amber-500/10 border border-amber-500/30 text-amber-300">sin OAuth token</span>}
                        </>
                      )}
                    {a.enabled && !a.ready && <span className="pill bg-rose-500/10 border border-rose-500/30 text-rose-300">no listo</span>}
                    {a.ready && !a.enabled && <span className="pill bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">listo</span>}
                  </div>
                  <div className="text-xs text-slate-500 font-mono truncate">{a.id}</div>
                </div>
                <div className="flex gap-1.5">
                  <button className="btn-ghost" title="Cola de tareas" onClick={() => nav(`/queue/${a.id}`)}>
                    <ListTodo size={13} />
                  </button>
                  <button className="btn-ghost" title="MCP / Tools" onClick={() => setMcpFor(a.id)}>
                    <Server size={13} />
                  </button>
                  <button className="btn-ghost" title="Versiones" onClick={() => setVersionsFor(a.id)}>
                    <GitBranch size={13} />
                  </button>
                  <button className="btn-ghost" title="Ejecutar ahora" onClick={() => runNow(a)}>
                    <Play size={13} />
                  </button>
                  <button className="btn-ghost" title={a.enabled ? 'Desactivar' : 'Activar'} onClick={() => toggle(a)}>
                    <Power size={13} className={a.enabled ? 'text-emerald-300' : 'text-slate-500'} />
                  </button>
                  <button className="btn-ghost" title="Eliminar" onClick={() => remove(a)}>
                    <Trash2 size={13} className="text-rose-300" />
                  </button>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-border-subtle grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <InboxRow agent={a} />
                <Field icon={KeyRound} label="SSH key" value={a.sshKey || '—'} mono />
                <Field icon={KeyRound} label="Servidor"
                       value={a.deployHost ? `${a.deployUser}@${a.deployHost}` : '—'} mono />
                <div /> {/* empty cell to keep the next row full-width */}
              </div>

              {/* Senders list — always visible */}
              <SendersEditor agent={a}
                             onAdd={(email, role) => addSender(a, email, role)}
                             onRemove={(email) => removeSender(a, email)}
                             onChangeRole={(email, role) => changeRole(a, email, role)} />

              {/* Spending control */}
              <SpendingCard agent={a}
                            data={spending[a.id]}
                            onSetLimit={val => setSpendingLimit(a, val)} />
            </div>
          ))}
        </div>
      )}

      {versionsFor && (
        <VersionsModal
          agentId={versionsFor}
          onClose={() => setVersionsFor(null)}
          onRollback={() => reload()}
        />
      )}
      {mcpFor && <McpModal agentId={mcpFor} onClose={() => setMcpFor(null)} />}
    </div>
  );
}

function Field({ icon: Icon, label, value, mono }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={11} className="text-slate-600 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-slate-600">{label}</div>
        <div className={`text-slate-300 truncate ${mono ? 'font-mono' : ''}`}>{value}</div>
      </div>
    </div>
  );
}

function InboxRow({ agent }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(agent.botEmail);
    setCopied(true); setTimeout(() => setCopied(false), 1200);
  }
  return (
    <div className="flex items-start gap-2">
      <Mail size={11} className="text-slate-600 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-slate-600">Inbox del bot</div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-slate-300 truncate">{agent.botEmail}</span>
          <button onClick={copy} className="text-slate-500 hover:text-slate-300" title="Copiar">
            {copied ? <CheckCheck size={11} className="text-emerald-400" /> : <Copy size={11} />}
          </button>
        </div>
      </div>
    </div>
  );
}

const ROLE_PILL = {
  owner:     'bg-amber-500/15 border-amber-500/40 text-amber-300',
  cocreator: 'bg-violet/15 border-violet/40 text-violet-300',
  reader:    'bg-slate-700/50 border-slate-600 text-slate-400',
};
const ROLE_TIP = {
  owner:     'creador — permiso total',
  cocreator: 'puede modificar el comportamiento',
  reader:    'solo puede usar el agente',
};

function SendersEditor({ agent, onAdd, onRemove, onChangeRole }) {
  const [val,  setVal]  = useState('');
  const [role, setRole] = useState('reader');
  const list = (agent.authorizedSenders || []).map(s =>
    typeof s === 'string' ? { email: s, role: 'reader' } : s
  );

  function submit() {
    const email = val.trim().toLowerCase();
    if (!email || !/.+@.+\..+/.test(email)) return;
    onAdd(email, role);
    setVal('');
  }

  return (
    <div className="mt-3 pt-3 border-t border-border-subtle">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
          <Mail size={10} /> Remitentes autorizados
        </div>
        <span className="text-[10px] text-slate-600">{list.length} permitido{list.length !== 1 ? 's' : ''}</span>
      </div>

      {list.length === 0 ? (
        <p className="text-[11px] text-slate-600 italic mb-2">
          Ninguno aún — añade emails que pueden escribir a este agente.
        </p>
      ) : (
        <div className="space-y-1 mb-2">
          {list.map(s => (
            <div key={s.email}
                 className="flex items-center gap-2 bg-surface-2/50 rounded-lg px-2.5 py-1.5">
              <span className="font-mono text-[12px] text-slate-200 flex-1 min-w-0 truncate"
                    title={s.email}>
                {s.email}
              </span>
              <select
                value={s.role}
                onChange={e => onChangeRole(s.email, e.target.value)}
                title={ROLE_TIP[s.role]}
                className={`text-[10px] font-mono rounded border px-1.5 py-0.5 outline-none cursor-pointer bg-surface-1 ${ROLE_PILL[s.role] || ROLE_PILL.reader}`}>
                <option value="reader">reader</option>
                <option value="cocreator">cocreator</option>
                <option value="owner">owner</option>
              </select>
              <button onClick={() => onRemove(s.email)}
                      className="text-slate-600 hover:text-rose-300 transition flex-shrink-0"
                      title="Quitar">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add row */}
      <div className="flex items-center gap-2 bg-surface-2/30 border border-dashed border-border-subtle rounded-lg px-2.5 py-1.5">
        <input
          type="email"
          placeholder="nuevo@email.com"
          className="flex-1 bg-transparent text-[12px] font-mono text-slate-300 placeholder:text-slate-600 outline-none min-w-0"
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') setVal(''); }}
        />
        <select value={role} onChange={e => setRole(e.target.value)}
                className={`text-[10px] font-mono rounded border px-1.5 py-0.5 outline-none cursor-pointer bg-surface-1 ${ROLE_PILL[role]}`}>
          <option value="reader">reader</option>
          <option value="cocreator">cocreator</option>
          <option value="owner">owner</option>
        </select>
        <button onClick={submit} disabled={!val.trim()}
                className="text-violet-400 hover:text-violet-200 disabled:opacity-30 flex-shrink-0 transition"
                title="Añadir remitente">
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

function SpendingCard({ agent, data, onSetLimit }) {
  const [editing, setEditing] = useState(false);
  const [limitVal, setLimitVal] = useState('');

  const limit = agent.spendingLimitMonthly;
  const spent = data?.this_month ?? 0;
  const pct   = limit ? Math.min(spent / limit * 100, 100) : 0;
  const over  = limit && spent >= limit;

  function startEdit() {
    setLimitVal(limit != null ? String(limit) : '');
    setEditing(true);
  }
  function saveEdit() {
    onSetLimit(limitVal);
    setEditing(false);
  }

  return (
    <div className="mt-3 pt-3 border-t border-border-subtle">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
          <DollarSign size={10} /> Gasto
        </div>
        {!editing ? (
          <button onClick={startEdit}
                  className="text-[10px] text-slate-600 hover:text-violet-300 transition">
            {limit != null ? `límite $${limit}/mes` : 'sin límite · configurar'}
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500">$</span>
            <input
              type="number" min="0" step="1" placeholder="ej. 5"
              value={limitVal}
              onChange={e => setLimitVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }}
              className="w-16 bg-surface-2 border border-border-subtle rounded px-1.5 py-0.5 text-[11px] font-mono text-slate-200 outline-none"
              autoFocus
            />
            <span className="text-[10px] text-slate-500">/mes</span>
            <button onClick={saveEdit} className="text-[10px] text-violet-300 hover:text-violet-200 ml-1">guardar</button>
            <button onClick={() => setEditing(false)} className="text-[10px] text-slate-600 hover:text-slate-400 ml-0.5">✕</button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Stats */}
        <div className="flex gap-3 text-[11px] flex-1">
          <div>
            <div className="text-slate-500 text-[10px]">hoy</div>
            <div className="font-mono text-slate-300">${(data?.today ?? 0).toFixed(3)}</div>
          </div>
          <div>
            <div className="text-slate-500 text-[10px]">este mes</div>
            <div className={`font-mono ${over ? 'text-rose-300' : 'text-slate-300'} flex items-center gap-1`}>
              ${spent.toFixed(3)}
              {over && <AlertTriangle size={10} className="text-rose-400" />}
            </div>
          </div>
          <div>
            <div className="text-slate-500 text-[10px]">total</div>
            <div className="font-mono text-slate-400">${(data?.all_time ?? 0).toFixed(3)}</div>
          </div>
          {data?.runs_month != null && (
            <div>
              <div className="text-slate-500 text-[10px]">runs/mes</div>
              <div className="font-mono text-slate-400">{data.runs_month}</div>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar — only when limit is set */}
      {limit != null && (
        <div className="mt-2">
          <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${over ? 'bg-rose-500' : pct > 75 ? 'bg-amber-500' : 'bg-violet-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-600 mt-0.5 text-right">
            {over
              ? <span className="text-rose-400">límite superado — nuevas ejecuciones bloqueadas</span>
              : `${pct.toFixed(0)}% del límite mensual ($${limit})`}
          </div>
        </div>
      )}
    </div>
  );
}

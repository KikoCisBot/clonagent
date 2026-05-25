import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Mail, ChevronRight, Clock, Bot, ArrowLeft, ExternalLink, Plus, Send, X, User } from 'lucide-react';
import { api, streamSSE } from '../api.js';

export default function Tasks() {
  const { id } = useParams();
  const nav = useNavigate();
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);
  const [events, setEvents] = useState([]);
  const [showCreate, setShowCreate] = useState(false);

  async function reload() { setList(await api('/api/tasks')); }
  useEffect(() => {
    reload().catch(() => {});
    const close = streamSSE('/api/tasks/stream', () => {
      reload().catch(() => {});
      if (id) api(`/api/tasks/${encodeURIComponent(id)}`).then(t => { setActive(t); setEvents(t.events || []); }).catch(() => {});
    });
    return close;
  }, [id]);

  useEffect(() => {
    if (!id) { setActive(null); setEvents([]); return; }
    api(`/api/tasks/${encodeURIComponent(id)}`).then(t => { setActive(t); setEvents(t.events || []); }).catch(() => setActive(null));
    const close = streamSSE(`/api/tasks/stream/${encodeURIComponent(id)}`, (msg) => {
      if (msg.type === 'event') setEvents(prev => [...prev, msg.event]);
      if (msg.type === 'thread:update' && msg.thread) setActive(msg.thread);
    });
    return close;
  }, [id]);

  if (id && active) return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-border-subtle">
        <button onClick={() => nav('/tasks')} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 mb-1">
          <ArrowLeft size={11} /> Volver
        </button>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-100 truncate">{active.subject || '(sin asunto)'}</div>
            <div className="text-xs text-slate-500 truncate font-mono">{active.from} · agente {active.agentId} · v{active.version || '?'}</div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {active.sessionId && (
              <button onClick={() => nav(`/hub/${active.sessionId}`)} className="btn-ghost text-xs" title="Ver sesión Claude en AgentHub">
                <Bot size={11} /> AgentHub
              </button>
            )}
            <button onClick={() => nav('/agents')} className="btn-ghost text-xs" title={`Ir al agente ${active.agentId}`}>
              <ExternalLink size={11} /> {active.agentId}
            </button>
            <span className={
              active.status === 'closed' ? 'pill bg-slate-700 text-slate-300' :
              (active.status === 'in-progress' || active.status === 'running' || active.status === 'processing')
                ? 'pill bg-amber-500/15 text-amber-300 border border-amber-500/30' :
              'pill bg-violet/15 text-violet-300 border border-violet/30'
            }>{active.status}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-3 max-w-3xl">
        {events.length === 0 && <div className="text-sm text-slate-600">Sin eventos aún…</div>}
        {events.map((ev, i) => <EventBlock key={i} ev={ev} agentId={active.agentId} />)}
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl">
      <div className="flex items-end justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-100">Tasks</h1>
        <button className="btn-primary text-sm" onClick={() => setShowCreate(true)}>
          <Plus size={13} /> Nueva tarea
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">Cada tarea es un email a un agente. Crea una desde aquí o mandando un correo.</p>

      {list.length === 0 ? (
        <div className="card text-center py-12 text-slate-500 text-sm">
          <Mail size={28} className="mx-auto mb-2 opacity-40" />
          Aún no hay tareas — pulsa "Nueva tarea" o mándale un correo a tu agente.
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(t => (
            <button key={t.id} onClick={() => nav(`/tasks/${encodeURIComponent(t.id)}`)}
              className="card w-full text-left hover:bg-surface-2 transition flex items-center gap-3">
              <Mail size={14} className="text-violet-300 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-100 truncate">{t.subject || '(sin asunto)'}</span>
                  {t.version && <span className="text-[10px] font-mono text-violet-300">v{t.version}</span>}
                </div>
                <div className="text-[11px] text-slate-500 font-mono truncate">
                  {t.agentId} · {t.from} · <Clock size={9} className="inline" /> {new Date(t.updatedAt).toLocaleString('es')}
                </div>
              </div>
              <span className={
                t.status === 'closed' ? 'pill bg-slate-700 text-slate-300' :
                (t.status === 'running' || t.status === 'processing')
                  ? 'pill bg-amber-500/15 text-amber-300 border border-amber-500/30' :
                'pill bg-violet/15 text-violet-300 border border-violet/30'
              }>{t.status}</span>
              <span className="text-[10px] text-slate-500">{t.eventCount || 0} ev</span>
              <ChevronRight size={14} className="text-slate-600" />
            </button>
          ))}
        </div>
      )}

      {showCreate && <NewTaskModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); reload(); }} />}
    </div>
  );
}

// Render a single event in the conversation thread.
//   - kind=email role=user      → emerald bubble (left)
//   - kind=email role=assistant → violet bubble (right)
//   - other kinds               → small system note centered
function EventBlock({ ev, agentId }) {
  if (ev.kind === 'email') {
    const isUser = (ev.role || 'user') === 'user';
    return (
      <div className={`flex gap-3 ${isUser ? '' : 'flex-row-reverse'}`}>
        <div className={`flex-shrink-0 mt-1 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser ? 'bg-emerald-900/40 border border-emerald-700/40' : 'bg-violet/15 border border-violet/30'
        }`}>
          {isUser ? <User size={14} className="text-emerald-300" /> : <Bot size={14} className="text-violet-300" />}
        </div>
        <div className={`max-w-[80%] min-w-0 ${isUser ? '' : 'text-right'}`}>
          <div className="flex items-baseline gap-2 text-[11px] text-slate-500 mb-1 flex-wrap">
            <span className="font-mono truncate">{ev.from || (isUser ? 'usuario' : agentId)}</span>
            {ev.sender_role && <span className={`pill text-[9px] ${
              ev.sender_role === 'owner' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' :
              ev.sender_role === 'cocreator' ? 'bg-violet/15 text-violet-300 border border-violet/30' :
              'bg-slate-800 text-slate-400 border border-slate-700'
            }`}>{ev.sender_role}</span>}
            <span className="text-slate-600">{new Date(ev.at).toLocaleString('es', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>
          </div>
          <div className={`rounded-2xl px-4 py-2.5 text-left ${
            isUser ? 'bg-emerald-900/20 border border-emerald-700/30 rounded-tl-sm'
                   : 'bg-violet/10 border border-violet/30 rounded-tr-sm ml-auto'
          }`}>
            {ev.subject && <div className="text-xs text-slate-400 mb-1 font-medium">{ev.subject}</div>}
            <div className="text-sm text-slate-200 whitespace-pre-wrap break-words">{ev.body || ev.message || '(sin cuerpo)'}</div>
          </div>
        </div>
      </div>
    );
  }
  // Generic system/tool event — small centered note
  return (
    <div className="flex justify-center">
      <div className="text-[11px] text-slate-500 bg-surface-2/40 rounded-full px-3 py-1 inline-flex items-center gap-1.5 max-w-full">
        <Bot size={10} className="text-violet-300 flex-shrink-0" />
        <span className="font-mono flex-shrink-0">{ev.kind || 'note'}</span>
        {ev.title && <span className="text-slate-400">· {ev.title}</span>}
        {ev.message && <span className="text-slate-300 truncate">· {ev.message}</span>}
        {ev.url && <a href={ev.url} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline inline-flex items-center gap-1">
          <ExternalLink size={9} /> link
        </a>}
        <span className="text-slate-700">· {new Date(ev.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
}

function NewTaskModal({ onClose, onCreated }) {
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  useEffect(() => {
    api('/api/agents').then(list => {
      const imapAgents = list.filter(a => a.mailProvider === 'imap');
      setAgents(imapAgents);
      if (imapAgents.length) {
        setAgentId(imapAgents[0].id);
        const senders = (imapAgents[0].authorizedSenders || []).map(s => s.email || s);
        if (senders.length) setFromEmail(senders[0]);
      }
    }).catch(() => {});
  }, []);

  function senders() {
    const a = agents.find(x => x.id === agentId);
    return (a?.authorizedSenders || []).map(s => s.email || s);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api('/api/tasks/create', {
        method: 'POST',
        body: JSON.stringify({ agentId, fromEmail, subject, body }),
      });
      onCreated();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const agentEmail = agents.find(a => a.id === agentId)?.botEmail;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form onSubmit={submit} className="bg-surface-1 border border-border-subtle rounded-xl w-full max-w-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-border-subtle flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Plus size={13} className="text-violet-300" /> Nueva tarea
          </h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X size={16} />
          </button>
        </header>
        <div className="p-5 space-y-3">
          {agents.length === 0 && (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-2">
              No tienes agentes IMAP. Crea uno en el chat primero.
            </div>
          )}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-slate-500">Agente</label>
            <select value={agentId} onChange={e => {
              setAgentId(e.target.value);
              const a = agents.find(x => x.id === e.target.value);
              const s = (a?.authorizedSenders || []).map(x => x.email || x);
              if (s.length) setFromEmail(s[0]);
            }} className="input mt-1 font-mono text-sm">
              {agents.map(a => <option key={a.id} value={a.id}>{a.name} — {a.botEmail}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-slate-500">De (autorizado)</label>
            <select value={fromEmail} onChange={e => setFromEmail(e.target.value)} className="input mt-1 font-mono text-sm">
              {senders().map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <p className="text-[10px] text-slate-600 mt-0.5">Solo emails en authorizedSenders del agente.</p>
          </div>
          {agentEmail && (
            <div className="text-[11px] text-slate-500 font-mono">→ to: {agentEmail}</div>
          )}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-slate-500">Asunto</label>
            <input className="input mt-1" value={subject} onChange={e => setSubject(e.target.value)} required />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-slate-500">Cuerpo</label>
            <textarea className="input mt-1 h-32 resize-none" value={body} onChange={e => setBody(e.target.value)} required />
          </div>
          {err && <div className="text-xs text-rose-300">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t border-border-subtle flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={busy || !agentId}>
            <Send size={13} /> {busy ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </form>
    </div>
  );
}

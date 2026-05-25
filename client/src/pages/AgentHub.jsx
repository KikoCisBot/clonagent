import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Activity, Bot, User, Wrench, ChevronRight, ChevronDown, Terminal, FileText, Code2 } from 'lucide-react';
import { api, streamSSE } from '../api.js';

export default function AgentHub() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sessions, setSessions]   = useState([]);
  const [active,   setActive]     = useState(null);
  const [events,   setEvents]     = useState([]);

  // Load sessions list
  useEffect(() => {
    api('/api/activity').then(setSessions).catch(() => {});
    const close = streamSSE('/api/activity/stream', (msg) => {
      if (msg.type === 'session:upsert' || msg.type === 'session:status') {
        api('/api/activity').then(setSessions).catch(() => {});
      }
    });
    return close;
  }, []);

  // Load selected session events
  useEffect(() => {
    if (!id) { setActive(null); setEvents([]); return; }
    api(`/api/activity/${id}`).then(s => {
      setActive(s); setEvents(s.events || []);
    }).catch(() => { setActive(null); });
    const close = streamSSE(`/api/activity/stream/${id}`, (msg) => {
      if (msg.type === 'event' && msg.sessionId === id) {
        setEvents(prev => [...prev, msg.event]);
      }
    });
    return close;
  }, [id]);

  return (
    <div className="h-full flex">
      {/* Session list */}
      <aside className="w-72 border-r border-border-subtle bg-surface-1 flex flex-col">
        <div className="px-4 py-3 border-b border-border-subtle">
          <div className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Activity size={14} className="text-violet-300" /> Sesiones Claude
          </div>
          <div className="text-[10px] text-slate-600 mt-0.5">{sessions.length} total</div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.length === 0 && (
            <div className="text-xs text-slate-600 p-3">
              Sin sesiones. Cuando un agente arranque vía host-relay, aparecerán aquí en vivo.
            </div>
          )}
          {sessions.map(s => (
            <button key={s.id}
              onClick={() => nav(`/hub/${s.id}`)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition ${
                id === s.id ? 'bg-violet/15 text-violet-200' : 'hover:bg-surface-2 text-slate-400'
              }`}>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  s.status === 'running' ? 'bg-emerald-400 animate-pulse' :
                  s.status === 'completed' ? 'bg-slate-500' : 'bg-rose-400'
                }`} />
                <span className="font-mono truncate flex-1">{s.agentId || s.id.slice(0, 12)}</span>
              </div>
              <div className="text-[10px] text-slate-600 truncate mt-0.5">{s.description || '—'}</div>
              <div className="text-[10px] text-slate-700 mt-0.5">{new Date(s.updated_at).toLocaleTimeString('es')}</div>
            </button>
          ))}
        </div>
      </aside>

      {/* Event feed */}
      <section className="flex-1 overflow-hidden flex flex-col">
        {!active ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-600">
            Selecciona una sesión a la izquierda para ver el feed en vivo.
          </div>
        ) : (
          <>
            <header className="px-6 py-3 border-b border-border-subtle">
              <div className="text-sm font-semibold text-slate-100">{active.agentId || active.id}</div>
              <div className="text-[11px] text-slate-500 truncate">{active.description}</div>
            </header>
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {events.length === 0 && <div className="text-xs text-slate-600">Sin eventos aún…</div>}
              {events.map((ev, i) => <EventBlock key={i} event={ev} />)}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function toolIcon(name = '') {
  const n = name.toLowerCase();
  if (n.includes('bash') || n.includes('shell')) return <Terminal size={11} />;
  if (n.includes('read') || n.includes('view'))  return <FileText size={11} />;
  if (n.includes('write') || n.includes('edit')) return <Code2 size={11} />;
  return <Wrench size={11} />;
}

function EventBlock({ event }) {
  const [open, setOpen] = useState(true);
  const ts = event.received_at ? new Date(event.received_at).toLocaleTimeString('es', { hour12: false }) : '';

  if (event.type === 'assistant') {
    const blocks = event.message?.content || [];
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-violet/15 border border-violet/30 flex items-center justify-center">
          <Bot size={13} className="text-violet-300" />
        </div>
        <div className="flex-1 space-y-1.5 min-w-0">
          {blocks.map((b, i) => {
            if (b.type === 'text') return <div key={i} className="text-sm text-slate-200 whitespace-pre-wrap">{b.text}</div>;
            if (b.type === 'tool_use') {
              const main = b.input?.command || b.input?.file_path || JSON.stringify(b.input).slice(0, 200);
              return (
                <div key={i} className="rounded-lg border border-border-subtle bg-surface-2/50 overflow-hidden">
                  <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left">
                    <span className="text-amber-400">{toolIcon(b.name)}</span>
                    <span className="text-amber-300 font-mono">{b.name}</span>
                    <span className="text-slate-500 truncate flex-1 font-mono">{String(main).slice(0, 80)}</span>
                    {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  </button>
                  {open && main && (
                    <pre className="text-xs font-mono px-2.5 py-1.5 border-t border-border-subtle/50 overflow-x-auto max-h-48 text-slate-300 whitespace-pre-wrap">
                      {String(main).slice(0, 1500)}
                    </pre>
                  )}
                </div>
              );
            }
            return null;
          })}
          <div className="text-[10px] text-slate-700 font-mono">{ts}</div>
        </div>
      </div>
    );
  }
  if (event.type === 'user') {
    const results = (event.message?.content || []).filter(b => b.type === 'tool_result');
    if (!results.length) return null;
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-emerald-900/30 border border-emerald-700/30 flex items-center justify-center">
          <User size={13} className="text-emerald-300" />
        </div>
        <div className="flex-1 space-y-1.5 min-w-0">
          {results.map((r, i) => (
            <pre key={i} className="text-xs font-mono text-slate-400 bg-surface-2/40 rounded-lg px-2.5 py-1.5 overflow-x-auto max-h-32 whitespace-pre-wrap">
              {String(typeof r.content === 'string' ? r.content : JSON.stringify(r.content)).slice(0, 1500)}
            </pre>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

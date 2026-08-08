import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, CheckCircle2, AlertCircle, Loader2, Plus, MessageSquare, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api.js';

const SEED = {
  role: 'assistant',
  content: '¡Hola! Soy ClonAgent Builder.\n\nDime qué quieres automatizar y lo monto desde cero: creo el proyecto, la base de datos, la web y el buzón de correo — todo listo para funcionar. Solo cuéntame:\n• Qué hace el agente (qué tipo de tareas resuelve)\n• Quién puede escribirle (uno o varios emails)\n\nSi ya tienes un proyecto o repo propio, dímelo y lo conecto. Si no, lo creo yo.',
};

export default function Chat() {
  const [sessionId, setSessionId] = useState(null);
  const [list, setList]           = useState([]);
  const [messages, setMessages]   = useState([SEED]);
  const [input, setInput]         = useState('');
  const [busy, setBusy]           = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const scrollRef = useRef(null);

  // ── Initial load: get sessions, restore most recent ──────────────────
  useEffect(() => {
    (async () => {
      try {
        const ss = await api('/api/chat/sessions');
        setList(ss);
        if (ss.length > 0) await loadSession(ss[0].id);
      } catch {}
    })();
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 9e9, behavior: 'smooth' }); }, [messages]);

  async function loadSession(id) {
    try {
      const s = await api(`/api/chat/sessions/${id}`);
      setSessionId(id);
      setMessages(s.messages || [SEED]);
    } catch {}
  }

  function newSession() {
    setSessionId(null);
    setMessages([SEED]);
    setInput('');
  }

  async function deleteSession(id, e) {
    e.stopPropagation();
    if (!confirm('Borrar esta conversación?')) return;
    await api(`/api/chat/sessions/${id}`, { method: 'DELETE' });
    const ss = await api('/api/chat/sessions');
    setList(ss);
    if (sessionId === id) newSession();
  }

  async function reloadList() {
    const ss = await api('/api/chat/sessions');
    setList(ss);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next); setInput(''); setBusy(true);
    try {
      const apiMsgs = next.filter(m => m !== SEED).map(({ role, content }) => ({ role, content }));
      const res = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: apiMsgs, sessionId }),
      });
      if (res.sessionId && res.sessionId !== sessionId) setSessionId(res.sessionId);
      setMessages(m => [
        ...m,
        { role: 'assistant', content: res.reply, actions: res.actions || [] },
      ]);
      reloadList();
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `❌ ${e.message}`, error: true }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="h-full flex">
      {/* Sessions sidebar */}
      {showSidebar ? (
        <aside className="w-64 border-r border-border-subtle bg-surface-1 flex flex-col">
          <div className="px-3 py-3 border-b border-border-subtle flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
              <MessageSquare size={13} className="text-violet-300" /> Conversaciones
            </div>
            <button onClick={() => setShowSidebar(false)} className="text-slate-500 hover:text-slate-200" title="Ocultar">
              <ChevronLeft size={14} />
            </button>
          </div>
          <button onClick={newSession} className="mx-2 mt-2 btn-ghost text-sm justify-center border border-border-subtle">
            <Plus size={12} /> Nueva conversación
          </button>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {list.length === 0 && <div className="text-xs text-slate-600 p-3 text-center">No hay sesiones aún.</div>}
            {list.map(s => (
              <div key={s.id}
                onClick={() => loadSession(s.id)}
                className={`group cursor-pointer px-2.5 py-2 rounded-lg text-xs transition ${
                  sessionId === s.id ? 'bg-violet/15 text-violet-200' : 'hover:bg-surface-2 text-slate-400'
                }`}>
                <div className="flex items-start gap-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{s.title}</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">{new Date(s.updatedAt).toLocaleString('es', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {s.messageCount} msg</div>
                  </div>
                  <button onClick={(e) => deleteSession(s.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-rose-300 hover:text-rose-200 transition">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      ) : (
        <button onClick={() => setShowSidebar(true)} className="px-1.5 py-1.5 text-slate-500 hover:bg-surface-2 self-start mt-3" title="Mostrar conversaciones">
          <ChevronRight size={16} />
        </button>
      )}

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Chat — Crear / Editar agentes</h1>
            <p className="text-xs text-slate-500 mt-0.5">Conversa para construir un email-triage agent o modificar uno existente.</p>
          </div>
          <button onClick={newSession} className="btn-ghost text-xs" title="Nueva conversación">
            <Plus size={11} /> Nueva
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className="flex gap-3">
              <div className={`flex-shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center ${
                m.role === 'assistant' ? 'bg-violet/15 border border-violet/30' : 'bg-emerald-900/30 border border-emerald-700/30'
              }`}>
                {m.role === 'assistant' ? <Bot size={14} className="text-violet-300" /> : <User size={14} className="text-emerald-300" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm leading-relaxed whitespace-pre-wrap ${m.error ? 'text-rose-300' : 'text-slate-200'}`}>
                  {m.content}
                </div>
                {(m.actions || []).map((a, j) => (
                  <div key={j} className={`mt-2 inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border ${
                    a.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                         : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  }`}>
                    {a.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                    <span className="font-mono">{a.tool}</span>
                    {a.ok && a.agent && <span>· {a.agent.id}</span>}
                    {a.ok && a.mailbox && <span>· {a.mailbox.email}</span>}
                    {!a.ok && <span>· {a.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-lg bg-violet/15 border border-violet/30 flex items-center justify-center">
                <Loader2 size={14} className="text-violet-300 animate-spin" />
              </div>
              <div className="text-sm text-slate-500 mt-1">pensando…</div>
            </div>
          )}
        </div>

        <div className="border-t border-border-subtle p-4">
          <div className="flex gap-2 max-w-4xl">
            <textarea
              className="input min-h-[44px] max-h-40 resize-none"
              placeholder="Cuenta qué agente quieres crear, o pídele un cambio…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
            />
            <button className="btn-primary self-end" onClick={send} disabled={busy || !input.trim()}>
              <Send size={14} /> Enviar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

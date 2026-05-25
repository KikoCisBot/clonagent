import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bot, Zap, CheckCircle, XCircle, Clock, AlertCircle, RefreshCw } from 'lucide-react';
import { api, streamSSE } from '../api.js';

const STATUS_STYLE = {
  pending:     'pill bg-slate-700/60 text-slate-300 border border-slate-600',
  'in-progress': 'pill bg-amber-500/15 text-amber-300 border border-amber-500/30',
  done:        'pill bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
  failed:      'pill bg-rose-500/15 text-rose-300 border border-rose-500/30',
};
const STATUS_ICON = {
  pending:       <Clock size={11} />,
  'in-progress': <Zap size={11} />,
  done:          <CheckCircle size={11} />,
  failed:        <XCircle size={11} />,
};
const PRIORITY_LABEL = { 1: 'urgente', 2: 'normal', 3: 'baja' };
const PRIORITY_STYLE = {
  1: 'text-rose-400',
  2: 'text-amber-400',
  3: 'text-slate-500',
};

export default function Queue() {
  const { agentId } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const d = await api(`/api/agents/${encodeURIComponent(agentId)}/queue`);
      setData(d);
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    // Poll every 10s to reflect task updates
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [agentId]);

  if (loading) return <div className="p-6 text-slate-500 text-sm">Cargando…</div>;
  if (!data) return <div className="p-6 text-rose-400 text-sm">No se pudo cargar la cola.</div>;

  const tasks    = data.tasks || [];
  const pending  = tasks.filter(t => t.status === 'pending');
  const active   = tasks.filter(t => t.status === 'in-progress');
  const done     = tasks.filter(t => t.status === 'done' || t.status === 'failed');
  const sessions = data.sessions || {};

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl">
      {/* Header */}
      <button onClick={() => nav('/agents')} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 mb-3">
        <ArrowLeft size={11} /> Agentes
      </button>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-base font-semibold text-slate-100">Cola — {agentId}</h1>
          <p className="text-xs text-slate-500 mt-0.5">Planificador + Ejecutor · {tasks.length} tareas totales</p>
        </div>
        <button onClick={load} className="btn-ghost text-xs"><RefreshCw size={11} /> Refrescar</button>
      </div>

      {/* Session status */}
      <div className="card flex gap-4 mb-4 text-xs">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${sessions.schedulerActive ? 'bg-violet-400 animate-pulse' : 'bg-slate-600'}`} />
          <span className="text-slate-400">Planificador</span>
          <span className={sessions.schedulerActive ? 'text-violet-300' : 'text-slate-600'}>
            {sessions.schedulerActive ? 'activo' : 'idle'}
          </span>
        </div>
        <div className="w-px bg-border-subtle" />
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${sessions.executorActive ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`} />
          <span className="text-slate-400">Ejecutor</span>
          <span className={sessions.executorActive ? 'text-amber-300' : 'text-slate-600'}>
            {sessions.executorActive ? 'activo' : 'idle'}
          </span>
        </div>
        {(sessions.schedulerClaudeId || sessions.executorClaudeId) && (
          <>
            <div className="w-px bg-border-subtle" />
            {sessions.schedulerClaudeId && (
              <button onClick={() => nav(`/hub/${sessions.schedulerClaudeId}`)}
                className="text-violet-400 hover:text-violet-200 flex items-center gap-1">
                <Bot size={10} /> sesión planif.
              </button>
            )}
            {sessions.executorClaudeId && (
              <button onClick={() => nav(`/hub/${sessions.executorClaudeId}`)}
                className="text-amber-400 hover:text-amber-200 flex items-center gap-1">
                <Bot size={10} /> sesión ejec.
              </button>
            )}
          </>
        )}
      </div>

      {/* Plan */}
      {data.plan && (
        <div className="card mb-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Plan actual</div>
          <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{data.plan}</p>
          {data.updatedAt && (
            <div className="text-[10px] text-slate-600 mt-1.5">
              actualizado {new Date(data.updatedAt).toLocaleString('es')}
            </div>
          )}
        </div>
      )}

      {/* Active tasks */}
      {active.length > 0 && (
        <Section title="En progreso" tasks={active} />
      )}

      {/* Pending tasks */}
      <Section title={`Pendientes (${pending.length})`} tasks={pending} empty="No hay tareas pendientes." />

      {/* Completed */}
      {done.length > 0 && (
        <Section title={`Completadas (${done.length})`} tasks={done} collapsed />
      )}
    </div>
  );
}

function Section({ title, tasks, empty, collapsed }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div className="mb-4">
      <button onClick={() => setOpen(o => !o)}
        className="text-xs text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1 hover:text-slate-200">
        <span>{open ? '▾' : '▸'}</span> {title}
      </button>
      {open && (
        tasks.length === 0
          ? <div className="text-xs text-slate-600 pl-2">{empty}</div>
          : <div className="space-y-2">
              {tasks.map(t => <TaskCard key={t.id} task={t} />)}
            </div>
      )}
    </div>
  );
}

function TaskCard({ task }) {
  return (
    <div className="card text-xs space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-slate-100">{task.title}</div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={PRIORITY_STYLE[task.priority] || 'text-slate-500'}>
            {PRIORITY_LABEL[task.priority] || `p${task.priority}`}
          </span>
          <span className={STATUS_STYLE[task.status] || STATUS_STYLE.pending}>
            {STATUS_ICON[task.status]}{task.status}
          </span>
        </div>
      </div>
      {task.description && (
        <p className="text-slate-400 leading-relaxed">{task.description}</p>
      )}
      {task.result && (
        <div className={`rounded px-2 py-1 font-mono ${
          task.status === 'failed'
            ? 'bg-rose-900/20 text-rose-300 border border-rose-700/30'
            : 'bg-emerald-900/20 text-emerald-300 border border-emerald-700/30'
        }`}>
          {task.result}
        </div>
      )}
      <div className="text-slate-600 flex gap-3">
        {task.from && <span>de: {task.from}</span>}
        {task.createdAt && <span>{new Date(task.createdAt).toLocaleString('es', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>}
      </div>
    </div>
  );
}

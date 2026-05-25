import { useState, useEffect } from 'react';
import { Bot, Mail, Activity, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { api, streamSSE } from '../api.js';

export default function Dashboard() {
  const [agents, setAgents] = useState([]);
  const [runs,   setRuns]   = useState([]);
  const [tick,   setTick]   = useState(0);

  useEffect(() => { (async () => {
    setAgents(await api('/api/agents'));
    setRuns(await api('/api/runs'));
  })().catch(() => {}); }, [tick]);

  useEffect(() => {
    const close = streamSSE('/api/activity/stream', () => setTick(t => t + 1));
    return close;
  }, []);

  const enabled = agents.filter(a => a.enabled);
  const last24  = runs.filter(r => Date.now() - new Date(r.at).getTime() < 86400000);
  const errors  = last24.filter(r => r.status === 'error').length;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Dashboard</h1>
        <p className="text-xs text-slate-500 mt-0.5">Live status of your ClonAgents.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat label="Agents" value={agents.length} icon={Bot} />
        <Stat label="Active" value={enabled.length} icon={CheckCircle2} tone="ok" />
        <Stat label="Runs (24h)" value={last24.length} icon={Activity} />
        <Stat label="Errors (24h)" value={errors} icon={AlertCircle} tone={errors ? 'err' : 'mute'} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <Bot size={14} className="text-violet-300" /> Agents
          </h2>
          {agents.length === 0 ? (
            <p className="text-sm text-slate-500">No agents yet. Go to Chat to create your first one.</p>
          ) : (
            <ul className="space-y-2">
              {agents.map(a => (
                <li key={a.id} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-100 truncate">{a.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">{a.botEmail}</div>
                  </div>
                  <span className={a.enabled ? 'pill-on' : 'pill-off'}>
                    {a.enabled ? 'on' : 'off'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <Mail size={14} className="text-violet-300" /> Recent runs
          </h2>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">No runs yet.</p>
          ) : (
            <ul className="space-y-2">
              {runs.slice(0, 8).map(r => (
                <li key={r.id} className="flex items-start gap-2 text-sm">
                  <Clock size={12} className="text-slate-600 mt-1 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-200 truncate">{r.subject || '(no subject)'}</div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">
                      {r.agentId} · {r.from} · {new Date(r.at).toLocaleTimeString('en', { hour12: false })}
                    </div>
                  </div>
                  <span className={r.status === 'error' ? 'pill bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                  : 'pill bg-violet/15 text-violet-300 border border-violet/30'}>
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone = 'normal' }) {
  const toneCls = {
    ok:   'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    err:  'text-rose-300    bg-rose-500/10    border-rose-500/30',
    mute: 'text-slate-400   bg-slate-800      border-slate-700',
    normal:'text-violet-300 bg-violet/10      border-violet/30',
  }[tone];
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-slate-500">{label}</span>
        <span className={`w-7 h-7 rounded-lg border flex items-center justify-center ${toneCls}`}>
          <Icon size={14} />
        </span>
      </div>
      <div className="text-2xl font-semibold text-slate-100 mt-2">{value}</div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { X, RotateCcw, Clock, GitBranch } from 'lucide-react';
import { api } from '../api.js';

export default function VersionsModal({ agentId, onClose, onRollback }) {
  const [versions, setVersions] = useState([]);
  const [busy, setBusy] = useState(false);

  async function reload() { setVersions(await api(`/api/agents/${agentId}/versions`)); }
  useEffect(() => { reload().catch(() => {}); }, [agentId]);

  async function rollback(v) {
    if (!confirm(`Rollback a v${v}? Esto crea una nueva versión a partir de la v${v}.`)) return;
    setBusy(true);
    try {
      await api(`/api/agents/${agentId}/versions/${v}/rollback`, { method: 'POST' });
      await reload();
      onRollback && onRollback();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-surface-1 border border-border-subtle rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch size={14} className="text-violet-300" />
            <h2 className="text-sm font-semibold text-slate-100">Versiones de <span className="font-mono">{agentId}</span></h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {versions.length === 0 && <div className="text-center text-sm text-slate-500 py-8">Sin versiones aún.</div>}
          {[...versions].reverse().map(v => (
            <div key={v.version} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-2/50 hover:bg-surface-2 transition text-sm">
              <span className="font-mono font-semibold text-violet-300 w-12">v{v.version}</span>
              <div className="flex-1 min-w-0">
                <div className="text-slate-200 truncate">{v.reason}</div>
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Clock size={10} /> {new Date(v.createdAt).toLocaleString('es')}
                </div>
              </div>
              <button onClick={() => rollback(v.version)} disabled={busy}
                className="btn-ghost text-xs" title="Rollback a esta versión">
                <RotateCcw size={11} /> Rollback
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Server, Check, ExternalLink } from 'lucide-react';
import { api } from '../api.js';

export default function McpModal({ agentId, onClose }) {
  const [registry, setRegistry] = useState([]);
  const [active,   setActive]   = useState({});            // mcpServers from agent's mcp.json
  const [picking,  setPicking]  = useState(null);          // registry entry being configured
  const [values,   setValues]   = useState({});

  async function reload() {
    const [r, mcp] = await Promise.all([
      api('/api/mcp/registry'),
      api(`/api/mcp/${agentId}`),
    ]);
    setRegistry(r);
    setActive(mcp.mcpServers || {});
  }
  useEffect(() => { reload().catch(() => {}); }, [agentId]);

  async function add() {
    if (!picking) return;
    try {
      await api(`/api/mcp/${agentId}/servers`, {
        method: 'POST',
        body: JSON.stringify({ name: picking.name, values }),
      });
      setPicking(null); setValues({});
      reload();
    } catch (e) { alert(e.message); }
  }

  async function remove(name) {
    if (!confirm(`Quitar MCP server "${name}"?`)) return;
    await api(`/api/mcp/${agentId}/servers/${name}`, { method: 'DELETE' });
    reload();
  }

  function startPicking(entry) {
    setPicking(entry);
    setValues({});
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-surface-1 border border-border-subtle rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server size={14} className="text-violet-300" />
            <h2 className="text-sm font-semibold text-slate-100">
              Tools (MCP servers) · <span className="font-mono">{agentId}</span>
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Active servers */}
          <div>
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Equipados</h3>
            {Object.keys(active).length === 0 ? (
              <div className="text-xs text-slate-600">Ninguno todavía. Añade abajo.</div>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(active).map(([name, cfg]) => (
                  <div key={name} className="flex items-center justify-between bg-surface-2/50 rounded-lg px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Check size={11} className="text-emerald-400" />
                      <span className="font-mono text-slate-200">{name}</span>
                      <span className="text-[11px] text-slate-500 truncate">{cfg.command} {(cfg.args || []).slice(0, 2).join(' ')}</span>
                    </div>
                    <button onClick={() => remove(name)} className="text-rose-300 hover:text-rose-200">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pick form */}
          {picking && (
            <div className="card border-violet/40 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Configurar {picking.label}</div>
                  <div className="text-[11px] text-slate-500">{picking.description}</div>
                </div>
                <button onClick={() => setPicking(null)} className="text-slate-500 hover:text-slate-200">
                  <X size={14} />
                </button>
              </div>
              {(picking.fields || []).map(f => (
                <div key={f.key}>
                  <label className="text-[11px] uppercase tracking-wider text-slate-500">
                    {f.label} {f.required && <span className="text-rose-400">*</span>}
                  </label>
                  <input
                    type={f.secret ? 'password' : 'text'}
                    placeholder={f.placeholder}
                    value={values[f.key] || ''}
                    onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                    className="input mt-1 font-mono text-sm"
                  />
                  {f.help && <p className="text-[10px] text-slate-600 mt-0.5">{f.help}</p>}
                </div>
              ))}
              {picking.docs && (
                <a href={picking.docs} target="_blank" rel="noreferrer" className="text-[11px] text-violet-300 hover:underline inline-flex items-center gap-1">
                  <ExternalLink size={10} /> Docs
                </a>
              )}
              <div className="flex justify-end gap-2">
                <button className="btn-ghost text-xs" onClick={() => setPicking(null)}>Cancelar</button>
                <button className="btn-primary text-xs" onClick={add}>
                  <Plus size={11} /> Añadir
                </button>
              </div>
            </div>
          )}

          {/* Registry grid */}
          <div>
            <h3 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Disponibles</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {registry.map(e => {
                const installed = !!active[e.name];
                return (
                  <button key={e.name}
                    onClick={() => !installed && startPicking(e)}
                    disabled={installed}
                    className={`text-left px-3 py-2.5 rounded-lg border transition ${
                      installed
                        ? 'border-emerald-500/30 bg-emerald-500/5 cursor-default'
                        : 'border-border-subtle hover:bg-surface-2'
                    }`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-slate-100">{e.label}</span>
                      <span className="pill bg-slate-800 text-slate-500 border border-slate-700 text-[10px]">{e.category}</span>
                      {installed && <Check size={11} className="text-emerald-400 ml-auto" />}
                    </div>
                    <div className="text-[11px] text-slate-500 leading-snug">{e.description}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

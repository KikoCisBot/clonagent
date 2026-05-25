import { useState, useEffect } from 'react';
import { NavLink, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MessageSquare, LayoutDashboard, Bot, Activity, Inbox, Settings2, LogOut, User, CreditCard } from 'lucide-react';
import Chat from './pages/Chat.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Agents from './pages/Agents.jsx';
import AgentHub from './pages/AgentHub.jsx';
import Queue from './pages/Queue.jsx';
import Tasks from './pages/Tasks.jsx';
import Settings from './pages/Settings.jsx';
import Account from './pages/Account.jsx';
import Billing from './pages/Billing.jsx';
import Login from './pages/Login.jsx';
import Landing from './pages/Landing.jsx';
import Tos from './pages/Tos.jsx';
import Privacy from './pages/Privacy.jsx';
import { api } from './api.js';

const NAV = [
  { to: '/chat',      label: 'Chat',      icon: MessageSquare },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/agents',    label: 'Agents',    icon: Bot },
  { to: '/tasks',     label: 'Tasks',     icon: Inbox },
  { to: '/hub',       label: 'AgentHub',  icon: Activity },
  { to: '/billing',   label: 'Billing',   icon: CreditCard },
  { to: '/account',   label: 'Account',   icon: User },
  { to: '/settings',  label: 'Settings',  icon: Settings2, adminOnly: true },
];

export default function App() {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    api('/api/auth/whoami').then(r => {
      if (r.mode === 'none') setUser({ sub: 'anon', name: 'anon', mode: 'none' });
      else if (r.user)       setUser(r.user);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }

  const PUBLIC_ROUTES = ['/', '/tos', '/privacy'];
  if (PUBLIC_ROUTES.includes(location.pathname)) {
    if (location.pathname === '/tos')     return <Tos />;
    if (location.pathname === '/privacy') return <Privacy />;
    return <Landing />;
  }

  if (loading) return <div className="h-full flex items-center justify-center text-slate-500">…</div>;
  if (!user)   return <Login onAuthed={setUser} />;

  return (
    <div className="h-full flex">
      <aside className="w-56 border-r border-border-subtle bg-surface-1 flex flex-col">
        <div className="px-4 py-4 border-b border-border-subtle">
          <div className="text-lg font-semibold text-slate-100">ClonAgent</div>
          <div className="text-[11px] text-slate-500">email-triage agents</div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV.filter(n => !n.adminOnly || user.isAdmin).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition ${
                isActive ? 'bg-violet/15 text-violet-200' : 'text-slate-400 hover:bg-surface-2 hover:text-slate-200'
              }`}>
              <Icon size={16} />{label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border-subtle p-3 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-xs text-slate-300 truncate">{user.name || user.sub}</div>
            <div className="text-[10px] text-slate-600">{user.mode}</div>
          </div>
          <button onClick={logout} className="btn-ghost text-xs" title="Sign out">
            <LogOut size={12} />
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/"             element={<Landing />} />
          <Route path="/chat"         element={<Chat />} />
          <Route path="/dashboard"    element={<Dashboard />} />
          <Route path="/agents"       element={<Agents />} />
          <Route path="/tasks"        element={<Tasks />} />
          <Route path="/tasks/:id"    element={<Tasks />} />
          <Route path="/threads"      element={<Navigate to="/tasks" replace />} />
          <Route path="/threads/:id"  element={<Navigate to="/tasks/:id" replace />} />
          <Route path="/hub"          element={<AgentHub />} />
          <Route path="/hub/:id"      element={<AgentHub />} />
          <Route path="/queue/:agentId" element={<Queue />} />
          <Route path="/billing"      element={<Billing />} />
          <Route path="/account"      element={<Account />} />
          <Route path="/settings"     element={<Settings />} />
          <Route path="/tos"          element={<Tos />} />
          <Route path="/privacy"      element={<Privacy />} />
        </Routes>
      </main>
    </div>
  );
}

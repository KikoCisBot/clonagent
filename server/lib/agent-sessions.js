// Persists the two named Claude sessions per agent: 'scheduler' and 'executor'.
// Never more than one of each. Stored in data/agent-sessions.json.
const fs   = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'data', 'agent-sessions.json');

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}
function writeAll(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function get(agentId) {
  return readAll()[agentId] || {};
}

function set(agentId, updates) {
  const all = readAll();
  all[agentId] = { ...(all[agentId] || {}), ...updates, updatedAt: new Date().toISOString() };
  writeAll(all);
  return all[agentId];
}

// Mark role active/idle so executor doesn't double-launch
const activeRoles = new Set(); // 'agentId:role'

function isActive(agentId, role) {
  return activeRoles.has(`${agentId}:${role}`);
}
function setActive(agentId, role, active) {
  const key = `${agentId}:${role}`;
  if (active) activeRoles.add(key); else activeRoles.delete(key);
}

module.exports = { get, set, isActive, setActive };

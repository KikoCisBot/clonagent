// Manages the shared task queue for each agent.
// Lives at ~/.claude/skills/<agentId>/agent-tasks.json so both scheduler
// and executor Claude sessions can read/write it directly via Bash tools.
const fs   = require('fs');
const path = require('path');
const os   = require('os');

function filePath(agentId) {
  return path.join(os.homedir(), '.claude', 'skills', agentId, 'agent-tasks.json');
}

function empty(agentId) {
  return { agentId, plan: '', tasks: [], updatedAt: new Date().toISOString() };
}

function read(agentId) {
  try { return JSON.parse(fs.readFileSync(filePath(agentId), 'utf8')); }
  catch { return empty(agentId); }
}

function write(agentId, data) {
  const f = filePath(agentId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2));
}

function hasPending(agentId) {
  const { tasks } = read(agentId);
  return Array.isArray(tasks) && tasks.some(t => t.status === 'pending');
}

module.exports = { filePath, read, write, hasPending };

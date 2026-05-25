// Append-only log of every agent run/launch
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'data', 'runs.json');
const MAX_RUNS = 500;

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return []; }
}

function recordRun(r) {
  const all = readAll();
  all.unshift({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), ...r });
  if (all.length > MAX_RUNS) all.length = MAX_RUNS;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}

function listRuns(agentId) {
  const all = readAll();
  return agentId ? all.filter(r => r.agentId === agentId) : all;
}

module.exports = { recordRun, listRuns };

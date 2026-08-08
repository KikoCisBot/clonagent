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

// Atomic write: temp file + rename to prevent corruption on crash mid-write
function write(agentId, data) {
  const f = filePath(agentId);
  const tmp = f + '.tmp';
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, f);
}

// Add a task with idempotency by threadId:
// - threadId exists as 'failed' → reset to 'pending' (auto-retry)
// - threadId exists otherwise   → no-op (dedup)
// - threadId not found          → append new task
function addTask(agentId, newTask) {
  const queue = read(agentId);
  const existing = queue.tasks.find(t => t.threadId === newTask.threadId);

  if (existing) {
    if (existing.status === 'failed') {
      existing.status = 'pending';
      existing.retries = (existing.retries || 0) + 1;
      existing.updatedAt = new Date().toISOString();
      if (!Array.isArray(existing.log)) existing.log = [];
      existing.log.push({ ts: new Date().toISOString(), msg: `Retry #${existing.retries}` });
      write(agentId, queue);
    }
    return queue;
  }

  queue.tasks.push({
    retries: 0,
    log: [],
    dependsOn: [],
    ...newTask,
  });
  write(agentId, queue);
  return queue;
}

// Append a timestamped entry to a task's log[] — used by executor for progress tracking
function appendLog(agentId, taskId, msg) {
  const queue = read(agentId);
  const task = queue.tasks.find(t => t.id === taskId);
  if (!task) return;
  if (!Array.isArray(task.log)) task.log = [];
  task.log.push({ ts: new Date().toISOString(), msg });
  write(agentId, queue);
}

// Get the highest-priority pending task whose dependencies are all 'done'.
// Side-effect: auto-skips tasks whose dependencies have 'failed'.
function getNextTask(agentId) {
  const queue = read(agentId);
  const { tasks } = queue;
  let dirty = false;

  const pending = tasks
    .filter(t => t.status === 'pending')
    .sort((a, b) => (a.priority || 2) - (b.priority || 2));

  let result = null;
  for (const task of pending) {
    if (!task.dependsOn?.length) { result = task; break; }

    const deps = task.dependsOn.map(id => tasks.find(t => t.id === id));
    const failedDep = deps.find(d => d?.status === 'failed');

    if (failedDep) {
      task.status = 'skipped';
      task.updatedAt = new Date().toISOString();
      task.result = `Skipped: dependency "${failedDep.title || failedDep.id}" failed`;
      if (!Array.isArray(task.log)) task.log = [];
      task.log.push({ ts: new Date().toISOString(), msg: task.result });
      dirty = true;
      continue;
    }

    if (deps.every(d => d?.status === 'done')) { result = task; break; }
  }

  if (dirty) write(agentId, queue);
  return result;
}

// True if at least one pending task has all its deps satisfied
function hasPendingReady(agentId) {
  const { tasks } = read(agentId);
  if (!Array.isArray(tasks)) return false;
  return tasks.some(t => {
    if (t.status !== 'pending') return false;
    if (!t.dependsOn?.length) return true;
    return t.dependsOn.every(id => tasks.find(d => d.id === id)?.status === 'done');
  });
}

// Legacy helper — kept for compatibility; prefer hasPendingReady for executor launch
function hasPending(agentId) {
  const { tasks } = read(agentId);
  return Array.isArray(tasks) && tasks.some(t => t.status === 'pending');
}

// Mark any pending task whose dependency has 'failed' as 'skipped'.
// getNextTask skips lazily, but if the only pending task has a failed dep the
// executor never launches (hasPendingReady is false) and getNextTask is never
// called — so the task would linger as 'pending' forever. Run this at startup
// to reconcile that user-visible state.
function reconcileSkips(agentId) {
  const queue = read(agentId);
  const { tasks } = queue;
  let skipped = 0;
  for (const task of tasks) {
    if (task.status !== 'pending' || !task.dependsOn?.length) continue;
    const failedDep = task.dependsOn
      .map(id => tasks.find(t => t.id === id))
      .find(d => d?.status === 'failed');
    if (!failedDep) continue;
    task.status = 'skipped';
    task.updatedAt = new Date().toISOString();
    task.result = `Skipped: dependency "${failedDep.title || failedDep.id}" failed`;
    if (!Array.isArray(task.log)) task.log = [];
    task.log.push({ ts: new Date().toISOString(), msg: task.result });
    skipped++;
  }
  if (skipped > 0) {
    write(agentId, queue);
    console.log(`[task-queue] ${agentId}: reconciled ${skipped} task(s) with failed deps → skipped`);
  }
  return skipped;
}

// Reset any 'in-progress' tasks to 'pending' after a crash.
// Call once on server startup for each agent.
function recoverStaleTasks(agentId) {
  const queue = read(agentId);
  let recovered = 0;
  for (const task of queue.tasks) {
    if (task.status !== 'in-progress') continue;
    task.status = 'pending';
    task.retries = (task.retries || 0) + 1;
    task.updatedAt = new Date().toISOString();
    if (!Array.isArray(task.log)) task.log = [];
    task.log.push({ ts: new Date().toISOString(), msg: 'Recovered from stale in-progress (server restart)' });
    recovered++;
  }
  if (recovered > 0) {
    write(agentId, queue);
    console.log(`[task-queue] ${agentId}: recovered ${recovered} stale task(s)`);
  }
  return recovered;
}

module.exports = { filePath, read, write, addTask, appendLog, getNextTask, hasPending, hasPendingReady, recoverStaleTasks, reconcileSkips };

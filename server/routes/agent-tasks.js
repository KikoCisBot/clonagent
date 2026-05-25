// REST API for per-agent task queue and planning state.
// GET  /api/agents/:id/tasks        → full queue + plan + session state
// PATCH /api/agents/:id/tasks/:tid  → update a task (status, result, etc.)
const express      = require('express');
const { getAgent } = require('../lib/skill-fs');
const taskQueue    = require('../lib/task-queue');
const agentSessions = require('../lib/agent-sessions');

const router = express.Router({ mergeParams: true });

router.get('/', (req, res) => {
  if (!getAgent(req.params.id)) return res.status(404).json({ error: 'agent not found' });
  const queue   = taskQueue.read(req.params.id);
  const sessions = agentSessions.get(req.params.id);
  res.json({
    ...queue,
    sessions: {
      schedulerActive:  agentSessions.isActive(req.params.id, 'scheduler'),
      executorActive:   agentSessions.isActive(req.params.id, 'executor'),
      schedulerClaudeId: sessions.schedulerClaudeId || null,
      executorClaudeId:  sessions.executorClaudeId  || null,
    },
  });
});

router.patch('/tasks/:taskId', (req, res) => {
  if (!getAgent(req.params.id)) return res.status(404).json({ error: 'agent not found' });
  const queue = taskQueue.read(req.params.id);
  const task  = (queue.tasks || []).find(t => t.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: 'task not found' });
  Object.assign(task, req.body, { updatedAt: new Date().toISOString() });
  taskQueue.write(req.params.id, queue);
  res.json({ ok: true, task });
});

module.exports = router;

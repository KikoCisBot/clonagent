// Calls the host-relay to launch Claude CLI sessions.
// Two named roles per agent: 'scheduler' (fires on new email) and
// 'executor' (fires when pending tasks exist). Never more than one
// session of each role at a time.
const path = require('path');
const os   = require('os');
const fs   = require('fs');
const { mcpPath }    = require('./mcp-fs');
const agentSessions  = require('./agent-sessions');
const taskQueue      = require('./task-queue');

const RELAY_URL  = process.env.AGENT_RELAY_URL || process.env.LITELLM_URL || 'http://localhost:3202';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com').replace(/\/$/, '');
const UUID_RE    = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSIONS_FILE = path.resolve(__dirname, '..', 'data', 'activity-sessions.json');
const SPEND_CACHE_TTL = 60_000;
const _spendCache = new Map(); // agentId -> { value, expiresAt }

async function getMonthlySpend(agentId) {
  const now = Date.now();
  const hit = _spendCache.get(agentId);
  if (hit && hit.expiresAt > now) return hit.value;

  try {
    const data = await fs.promises.readFile(SESSIONS_FILE, 'utf8');
    const sessions = JSON.parse(data);
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const ms = monthStart.toISOString();
    const value = sessions
      .filter(s => (s.agentId || s.agent_id) === agentId && s.created_at >= ms && s.cost_usd > 0)
      .reduce((t, s) => t + (s.cost_usd || 0), 0);
    _spendCache.set(agentId, { value, expiresAt: now + SPEND_CACHE_TTL });
    return value;
  } catch { return 0; }
}

function newUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Core launch helper ─────────────────────────────────────────────────────

const DEFAULT_MODEL = 'claude-sonnet-4-6';

async function _launch({ skillId, role, prompt, description, resumeClaudeId, model }) {
  const skillDir = path.join(os.homedir(), '.claude', 'skills', skillId);
  const sessionId = newUuid();
  const mcp = mcpPath(skillId);
  const resolvedModel = model || DEFAULT_MODEL;

  // Register session with activity API
  await fetch(`${PUBLIC_URL}/api/activity/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: sessionId, agentId: skillId, task: prompt,
      description: `[${role}] ${description || prompt.slice(0, 60)}`, status: 'running' }),
  }).catch(() => {});

  const args = [
    '--output-format', 'stream-json', '--verbose',
    '--dangerously-skip-permissions',
    '--model', resolvedModel,
  ];
  if (resumeClaudeId && UUID_RE.test(resumeClaudeId)) args.push('--resume', resumeClaudeId);
  args.push('-p', `/${skillId}\n\n${prompt}`);
  if (fs.existsSync(mcp)) args.push('--mcp-config', mcp);

  const resp = await fetch(`${RELAY_URL}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, task: prompt, workdir: skillDir,
      model: resolvedModel, args }),
  });
  if (!resp.ok) throw new Error(`relay ${resp.status}: ${(await resp.text()).slice(0, 200)}`);

  // Save the relay sessionId so activity.js can link it to the Claude UUID on init event
  agentSessions.set(skillId, { [`${role}RelayId`]: sessionId });
  agentSessions.setActive(skillId, role, true);

  return { sessionId };
}

// ── Scheduler — fires on new email ────────────────────────────────────────
// Reads the email, plans tasks, writes agent-tasks.json, exits.

async function launchScheduler(agent, { from, subject, threadId }) {
  const skillId = agent.id;
  if (agentSessions.isActive(skillId, 'scheduler')) {
    console.log(`[runner] ${skillId}: scheduler already active, skipping`);
    return null;
  }
  if (agent.spendingLimitMonthly != null) {
    const spent = getMonthlySpend(skillId);
    if (spent >= agent.spendingLimitMonthly) {
      console.warn(`[runner] ${skillId}: monthly limit $${agent.spendingLimitMonthly} reached (spent $${spent.toFixed(4)}) — launch blocked`);
      return null;
    }
  }

  const sess = agentSessions.get(skillId);
  const resumeClaudeId = sess.schedulerClaudeId || null;
  const tasksFile = taskQueue.filePath(skillId);

  const prompt = `ROL: PLANIFICADOR

Nueva comunicación recibida:
  De: ${from}
  Asunto: ${subject}
  ThreadId: ${threadId}

Tu tarea (sé rápido y concreto):
1. Lee el email: python3 mail_client.py get-thread "${threadId}"
2. Lee el fichero de tareas actual: cat agent-tasks.json (puede no existir aún)
3. Añade las tareas necesarias a agent-tasks.json en formato JSON:
   { "id": "<uuid4>", "title": "...", "description": "...", "priority": 1,
     "status": "pending", "threadId": "${threadId}", "from": "${from}",
     "createdAt": "<iso>" }
   - priority 1=urgente, 2=normal, 3=baja
   - No dupliques tareas ya existentes para el mismo threadId
4. Actualiza el campo "plan" con tu análisis breve de la situación
5. Escribe el fichero actualizado. El ejecutor se encarga de ejecutar las tareas.
6. Sal cuando hayas terminado de planificar.

Fichero de tareas: ${tasksFile}`;

  try {
    const launch = await _launch({ skillId, role: 'scheduler', prompt,
      description: subject, resumeClaudeId, model: agent.model });
    console.log(`[runner] ${skillId}: scheduler launched session=${launch.sessionId}`);
    return launch;
  } catch (err) {
    agentSessions.setActive(skillId, 'scheduler', false);
    throw err;
  }
}

// ── Executor — fires when pending tasks exist ──────────────────────────────
// Executes all pending tasks in order, updates statuses, exits when queue empty.

async function launchExecutor(agent) {
  const skillId = agent.id;
  if (agentSessions.isActive(skillId, 'executor')) {
    console.log(`[runner] ${skillId}: executor already active, skipping`);
    return null;
  }
  if (agent.spendingLimitMonthly != null) {
    const spent = getMonthlySpend(skillId);
    if (spent >= agent.spendingLimitMonthly) {
      console.warn(`[runner] ${skillId}: monthly limit $${agent.spendingLimitMonthly} reached (spent $${spent.toFixed(4)}) — executor blocked`);
      return null;
    }
  }
  if (!taskQueue.hasPending(skillId)) return null;

  const sess = agentSessions.get(skillId);
  const resumeClaudeId = sess.executorClaudeId || null;
  const tasksFile = taskQueue.filePath(skillId);

  const prompt = `ROL: EJECUTOR

Ejecuta las tareas pendientes de agent-tasks.json.

Proceso (repite hasta que no haya más tareas pendientes):
1. Lee agent-tasks.json
2. Toma la tarea con status="pending" de mayor prioridad (1=urgente)
3. Actualiza su status a "in-progress" en el fichero
4. Ejecuta la tarea (responder emails, analizar datos, lo que corresponda)
5. Actualiza la tarea: status="done" o "failed", result="descripción breve", updatedAt=<iso>
6. Si quedan más tareas pending, vuelve al paso 1
7. Cuando no haya ninguna tarea pending, sal

Reglas:
- Marca "failed" (no crashees) si algo falla, y continúa con la siguiente
- Usa mail_client.py para enviar respuestas de email
- Sé conciso en los campos "result"

Fichero de tareas: ${tasksFile}`;

  try {
    const launch = await _launch({ skillId, role: 'executor', prompt,
      description: 'proceso cola de tareas', resumeClaudeId, model: agent.model });
    console.log(`[runner] ${skillId}: executor launched session=${launch.sessionId}`);
    return launch;
  } catch (err) {
    agentSessions.setActive(skillId, 'executor', false);
    throw err;
  }
}

// ── Legacy helper (used by chat.js / task injection) ──────────────────────

async function launchAgent({ skillId, prompt, cwd, threadInfo, resumeSessionId }) {
  const skillDir = cwd || path.join(os.homedir(), '.claude', 'skills', skillId);
  const sessionId = newUuid();
  const mcp = mcpPath(skillId);

  await fetch(`${PUBLIC_URL}/api/activity/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: sessionId, agentId: skillId, task: prompt,
      description: threadInfo?.subject || prompt.slice(0, 80), status: 'running' }),
  }).catch(() => {});

  const args = [
    '--output-format', 'stream-json', '--verbose',
    '--dangerously-skip-permissions', '--model', 'claude-sonnet-4-6',
  ];
  if (resumeSessionId && UUID_RE.test(resumeSessionId)) args.push('--resume', resumeSessionId);
  args.push('-p', `/${skillId}\n\n${prompt}`);
  if (fs.existsSync(mcp)) args.push('--mcp-config', mcp);

  const resp = await fetch(`${RELAY_URL}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, task: prompt, workdir: skillDir,
      model: 'claude-sonnet-4-6', args }),
  });
  if (!resp.ok) throw new Error(`relay ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return { ...(await resp.json()), sessionId };
}

async function relayHealthy() {
  try {
    const r = await fetch(`${RELAY_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

module.exports = { launchAgent, launchScheduler, launchExecutor, relayHealthy, RELAY_URL };

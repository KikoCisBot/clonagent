// Two-agent loop per clone:
//   Scheduler — fires when new email arrives; plans tasks → agent-tasks.json
//   Executor  — fires every 2 min when pending tasks exist; executes them
// Never more than one scheduler + one executor active at the same time per agent.
const { spawn }  = require('child_process');
const fs         = require('fs');
const path       = require('path');
const cron       = require('node-cron');
const { listAgents, SKILLS_ROOT } = require('./skill-fs');
const { launchScheduler, launchExecutor } = require('./relay-client');
const { recordRun } = require('./runs');
const threadStore   = require('./email-thread-store');
const agentSessions = require('./agent-sessions');
const taskQueue     = require('./task-queue');

const COMMAND_PREFIX = '!';

// Detect auto-replies, OOO messages, bounces, marketing signatures etc.
// Returns true if the email should be silently skipped.
function isAutoReply(msg) {
  const subject = (msg.subject || '').toLowerCase();
  const from    = (msg.from    || '').toLowerCase();
  const headers = msg.headers  || {};

  // Standard auto-reply headers
  if (headers['auto-submitted'] && headers['auto-submitted'] !== 'no') return true;
  if (headers['x-autoreply'])       return true;
  if (headers['x-autorespond'])     return true;
  if (headers['precedence'] === 'bulk' || headers['precedence'] === 'auto-reply') return true;
  if (headers['x-auto-response-suppress']) return true;

  // Common subject patterns
  const autoSubjects = [
    'out of office', 'fuera de oficina', 'ausencia', 'vacaciones',
    'automatic reply', 'respuesta automática', 'auto:', 'ndr:', 'delivery status',
    'undeliverable', 'no se puede entregar', 'mailer-daemon',
  ];
  if (autoSubjects.some(s => subject.includes(s))) return true;

  // Bounce / mailer-daemon senders
  if (from.includes('mailer-daemon') || from.includes('postmaster@') ||
      from.includes('no-reply') || from.includes('noreply')) return true;

  return false;
}
const HELP_TEXT = `ClonAgent commands — send any of these to manage your agent:

  !help                      Show this message
  !status                    Agent status
  !senders                   List authorized senders
  !add someone@example.com   Add an authorized sender
  !remove someone@example.com  Remove an authorized sender
  !pause                     Pause this agent
  !resume                    Resume this agent

Any other email (no !) is treated as a request and handled by Claude.`;

async function detectAndHandleCommand(agent, msg, threadId, script, skillDir) {
  const text = ((msg.subject || '') + '\n' + (msg.body || '')).trim();
  const firstLine = text.split('\n').find(l => l.trim()) || '';
  if (!firstLine.startsWith(COMMAND_PREFIX)) return false;

  const [rawCmd, ...args] = firstLine.slice(1).trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  const configPath = path.join(skillDir, 'config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}

  let reply = '';

  if (cmd === 'help') {
    reply = HELP_TEXT;
  } else if (cmd === 'status') {
    const fresh = listAgents().find(a => a.id === agent.id) || agent;
    const senders = config.authorizedSenders || [];
    reply = `Agent: ${fresh.id}\nStatus: ${fresh.enabled ? '✅ active' : '⏸ paused'}\nAuthorized senders: ${senders.length}\n\nSend !help for all commands.`;
  } else if (cmd === 'senders') {
    const senders = config.authorizedSenders || [];
    reply = senders.length
      ? 'Authorized senders:\n' + senders.map(s => '  • ' + (typeof s === 'string' ? s : s.email)).join('\n')
      : 'No authorized senders configured yet.';
  } else if (cmd === 'add') {
    const email = args[0];
    if (!email || !email.includes('@')) {
      reply = '❌ Usage: !add email@example.com';
    } else {
      const senders = config.authorizedSenders || [];
      if (senders.some(s => (typeof s === 'string' ? s : s.email) === email)) {
        reply = `ℹ️ ${email} is already authorized.`;
      } else {
        config.authorizedSenders = [...senders, email];
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        reply = `✅ Added ${email} as an authorized sender.`;
      }
    }
  } else if (cmd === 'remove') {
    const email = args[0];
    if (!email) {
      reply = '❌ Usage: !remove email@example.com';
    } else {
      const before = (config.authorizedSenders || []).length;
      config.authorizedSenders = (config.authorizedSenders || [])
        .filter(s => (typeof s === 'string' ? s : s.email) !== email);
      if (config.authorizedSenders.length === before) {
        reply = `ℹ️ ${email} was not in the list.`;
      } else {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        reply = `✅ Removed ${email}.`;
      }
    }
  } else if (cmd === 'pause') {
    const { updateAgent } = require('./skill-fs');
    updateAgent(agent.id, { enabled: false });
    reply = '⏸ Agent paused. Send !resume to reactivate it.';
  } else if (cmd === 'resume') {
    const { updateAgent } = require('./skill-fs');
    updateAgent(agent.id, { enabled: true });
    reply = '✅ Agent resumed. Checking for emails every minute.';
  } else {
    reply = `❓ Unknown command: !${cmd}\n\nSend !help to see available commands.`;
  }

  try {
    await runPython(skillDir, [script, 'reply', threadId, '--body', reply]);
  } catch (e) {
    console.error(`[command] reply failed for ${agent.id}: ${e.message}`);
  }
  return true;
}


const PYTHON = process.env.PYTHON_BIN || '/usr/bin/env python3';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com').replace(/\/$/, '');

let pollerRunning  = false;
let executorRunning = false;

// ── Email poller (every 1 min) → triggers Scheduler ───────────────────────

async function checkAgent(agent) {
  const skillDir = path.join(SKILLS_ROOT, agent.id);
  const script = agent.mailProvider === 'imap' ? 'mail_client.py' : 'gmail_client.py';
  if (!fs.existsSync(path.join(skillDir, script)))
    throw new Error(`${script} not found in ${skillDir}`);

  const unread = await runPython(skillDir, [script, 'list-unread', '--days', '7']);
  if (!unread || unread.length === 0) return { agent: agent.id, processed: 0 };

  // Group by thread
  const byThread = new Map();
  for (const m of unread) {
    const tid = m.thread_id || m.message_id || m.uid;
    if (!byThread.has(tid)) byThread.set(tid, []);
    byThread.get(tid).push(m);
  }

  // Record incoming emails in the UI task feed
  await recordIncomingEmails(agent, byThread, script, skillDir);

  let processed = 0;
  for (const [threadId, msgs] of byThread) {
    const last = msgs[msgs.length - 1];
    try {
      // Check for !commands first — handle them without launching Claude
      let fullMsg = last;
      try {
        const thread = await runPython(skillDir, [script, 'get-thread', threadId]);
        const lastMsg = thread?.messages?.[thread.messages.length - 1] || thread;
        fullMsg = { ...last, body: lastMsg?.body || '' };
      } catch {}
      const wasCommand = await detectAndHandleCommand(agent, fullMsg, threadId, script, skillDir);
      if (wasCommand) {
        for (const m of msgs) {
          if (m.uid) runPython(skillDir, [script, 'mark-read', m.uid]).catch(() => {});
        }
        processed++;
        continue;
      }

      // Skip auto-replies / bounces — no point launching Claude for those
      if (isAutoReply(last)) {
        for (const m of msgs)
          if (m.uid) runPython(skillDir, [script, 'mark-read', m.uid]).catch(() => {});
        continue;
      }

      // Trigger scheduler (it will plan tasks; executor picks them up separately)
      const launch = await launchScheduler(agent, {
        from: last.from, subject: last.subject, threadId,
      });

      if (launch) {
        threadStore.rememberSession(agent.id, threadId, launch.sessionId);
        fetch(`${PUBLIC_URL}/api/tasks/${encodeURIComponent(threadId)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: launch.sessionId, status: 'running' }),
        }).catch(() => {});
        recordRun({ agentId: agent.id, threadId, sessionId: launch.sessionId,
          from: last.from, subject: last.subject, status: 'scheduled',
          at: new Date().toISOString() });
      }

      // Mark emails as read so we don't re-trigger the scheduler
      for (const m of msgs) {
        if (m.uid) runPython(skillDir, [script, 'mark-read', m.uid]).catch(() => {});
      }
      processed++;
    } catch (err) {
      recordRun({ agentId: agent.id, threadId, from: last.from,
        subject: last.subject, status: 'error', error: err.message,
        at: new Date().toISOString() });
    }
  }
  return { agent: agent.id, processed };
}

// ── Executor tick (every 2 min) → launches Executor if tasks pending ───────

async function tickExecutor() {
  if (executorRunning) return;
  executorRunning = true;
  try {
    const agents = listAgents().filter(a => a.enabled && a.ready);
    for (const agent of agents) {
      if (!taskQueue.hasPending(agent.id)) continue;
      try {
        const launch = await launchExecutor(agent);
        if (launch) {
          console.log(`[executor] ${agent.id}: launched session=${launch.sessionId}`);
          recordRun({ agentId: agent.id, sessionId: launch.sessionId,
            status: 'executor-launched', at: new Date().toISOString() });
        }
      } catch (err) {
        console.error(`[executor] ${agent.id}: ${err.message}`);
      }
    }
  } finally { executorRunning = false; }
}

// ── Mark scheduler/executor as done when activity reports session end ──────
// Called from activity.js when a session_end or session_error event arrives.

function onSessionEnd(relaySessionId) {
  // Find which agent+role owns this relay session and mark it idle
  const all = require('./agent-sessions').get;
  // We stored ${role}RelayId in agent-sessions — scan all agents
  try {
    const data = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '..', 'data', 'agent-sessions.json'), 'utf8'));
    for (const [agentId, sess] of Object.entries(data)) {
      if (sess.schedulerRelayId === relaySessionId) {
        agentSessions.setActive(agentId, 'scheduler', false);
        console.log(`[runner] ${agentId}: scheduler done (${relaySessionId})`);
      }
      if (sess.executorRelayId === relaySessionId) {
        agentSessions.setActive(agentId, 'executor', false);
        console.log(`[runner] ${agentId}: executor done (${relaySessionId})`);
      }
    }
  } catch { /* ignore */ }
}

// ── Email recording helper ─────────────────────────────────────────────────

async function recordIncomingEmails(agent, byThread, script, skillDir) {
  for (const [tid, msgs] of byThread) {
    for (const m of msgs) {
      const idArg = m.thread_id || m.message_id || m.uid;
      let body = '';
      try {
        const full = await runPython(skillDir, [script, 'get-thread', idArg]);
        body = full?.messages?.[full.messages.length - 1]?.body || full?.body || '';
      } catch { /* best-effort */ }
      try {
        await fetch(`${PUBLIC_URL}/api/tasks`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: tid, agentId: agent.id, from: m.from,
            subject: m.subject, status: 'running' }),
        }).catch(() => {});
        await fetch(`${PUBLIC_URL}/api/tasks/${encodeURIComponent(tid)}/events`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'email', role: 'user', from: m.from,
            sender_role: m.sender_role, subject: m.subject, body,
            at: new Date().toISOString() }),
        }).catch(() => {});
      } catch { /* best-effort */ }
    }
  }
}

function runPython(cwd, args) {
  return new Promise((resolve, reject) => {
    const cmd = PYTHON.split(/\s+/);
    const proc = spawn(cmd[0], [...cmd.slice(1), ...args], { cwd });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`python exited ${code}: ${err}`));
      try { resolve(JSON.parse(out || '[]')); }
      catch (e) { reject(new Error(`bad JSON: ${e.message}`)); }
    });
  });
}

// ── Cron setup ─────────────────────────────────────────────────────────────

async function tick() {
  if (pollerRunning) return;
  pollerRunning = true;
  try {
    const agents = listAgents().filter(a => a.enabled && a.ready);
    if (agents.length) console.log(`[poller] checking ${agents.length} agent(s): ${agents.map(a => a.id).join(', ')}`);
    for (const a of agents) {
      try {
        const r = await checkAgent(a);
        if (r.processed) console.log(`[poller] ${a.id}: triggered scheduler for ${r.processed} thread(s)`);
      } catch (err) { console.error(`[poller] ${a.id}: ${err.message}`); }
    }
  } finally { pollerRunning = false; }
}

function startPoller() {
  // Recover any tasks stuck in-progress from a previous crash, and reconcile
  // tasks whose dependency failed (they'd otherwise linger as 'pending').
  const agents = listAgents().filter(a => a.enabled && a.ready);
  for (const a of agents) {
    taskQueue.recoverStaleTasks(a.id);
    taskQueue.reconcileSkips(a.id);
  }

  cron.schedule('* * * * *',   tick);          // email check: every 1 min
  cron.schedule('*/2 * * * *', tickExecutor);  // executor:    every 2 min
  console.log('[poller] started (email: 1min, executor: 2min)');
}

module.exports = { startPoller, tick, tickExecutor, checkAgent, onSessionEnd };

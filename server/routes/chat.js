// Chat endpoint with proper tool-calling loop. Persists conversations per user.
const express = require('express');
const { chat } = require('../lib/claude-client');
const { createAgent, updateAgent, getAgent, listAgents } = require('../lib/skill-fs');
const { addServer, removeServer } = require('../lib/mcp-fs');
const { listRegistry } = require('../lib/mcp-registry');
const mailServer = require('../lib/mail-server');
const sessions  = require('../lib/chat-store');
const gitea     = require('../lib/gitea-client');
const pg        = require('../lib/postgres-client');
const taskInjector = require('../lib/task-injector');
const { checkAgent } = require('../lib/gmail-poller');
const fs = require('fs');
const path = require('path');
const os = require('os');

const router = express.Router();

// ─── Sessions list / get / delete / rename ───────────────────────────────
router.get('/sessions', (req, res) => {
  res.json(sessions.listSessions(req.session.user?.sub || 'anon'));
});
router.get('/sessions/:id', (req, res) => {
  const s = sessions.getSession(req.params.id, req.session.user?.sub || 'anon');
  if (!s) return res.status(404).json({ error: 'session not found' });
  res.json(s);
});
router.delete('/sessions/:id', (req, res) => {
  sessions.deleteSession(req.params.id, req.session.user?.sub || 'anon');
  res.json({ ok: true });
});
router.patch('/sessions/:id', (req, res) => {
  const { title } = req.body || {};
  const updated = sessions.renameSession(req.params.id, req.session.user?.sub || 'anon', title);
  if (!updated) return res.status(404).json({ error: 'session not found' });
  res.json(updated);
});

const SYSTEM_PROMPT = `Eres "ClonAgent Builder", un asistente que ayuda al usuario a crear, editar y
operar agentes que procesan correo electrónico (clones de premeti-email-triage).

Schema de un agente:
- id (string, lowercase-kebab)                            REQUERIDO al crear
- name (string)                                            REQUERIDO al crear
- description (string)                                     opcional
- botEmail (string)                                        opcional (auto en IMAP)
- authorizedSenders (array de {email, role})              REQUERIDO al crear (≥1)
- projectPath / deployHost / deployUser / deployDir        opcional
- sshKey                                                   opcional
- mailProvider ("gmail" | "imap")                         default "imap" si mailserver activo
- pollMinutes (number)                                     default 1
- extraContext (string)                                    opcional

Si el usuario menciona un agente sin decirte su id exacto ("el agente de btc",
"haz que arranque el de mia"), llama PRIMERO a 'list_agents' para resolverlo.
NUNCA inventes ids.

Si el usuario dice "haz que funcione X" / "que arranque X" / "actívalo":
- enabled=false → llama 'update_agent' con enabled:true
- enabled=true → propón 'create_task' con un mensaje de arranque
- ready=false → dile qué credencial le falta

Cuando el usuario quiera crear un agente nuevo, primero pregunta si:
(a) Es para un proyecto existente — pídele ruta del repo + deploy host
(b) Es para un proyecto nuevo — ofrece crear repo en Gitea built-in
    ('gitea_create_repo'), provisionar Postgres ('provision_database'), etc.

Por defecto cada agente nuevo lleva su propio buzón en bot.utopiaia.com.
NO llames 'provision_mailbox' a mano: 'save_agent' lo crea automáticamente.

Equipas al agente con MCP servers (github, slack, jira, postgres, k8s…) con
'add_mcp_server'/'remove_mcp_server'/'list_mcp_registry'.

Reglas:
- Sé breve. UNA pregunta a la vez.
- Confirma antes de crear/borrar.
- Si tienes dudas, pregunta — no inventes.
- Después de ejecutar tools, RESUME al usuario lo que se hizo en lenguaje natural.`;

const TOOLS = [
  { type: 'function', function: { name: 'list_agents', description: 'Lista todos los agentes existentes con id, name, botEmail, enabled, ready, mailProvider, authorizedSenders.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'save_agent', description: 'Crea un nuevo ClonAgent. Auto-provisiona mailbox IMAP si mailserver activo.',
    parameters: { type: 'object', properties: {
      id: { type: 'string', pattern: '^[a-z0-9-]+$' }, name: { type: 'string' }, description: { type: 'string' }, botEmail: { type: 'string' },
      authorizedSenders: { type: 'array', items: { type: 'object', properties: { email: { type: 'string' }, role: { type: 'string', enum: ['owner', 'cocreator', 'reader'] } }, required: ['email'] } },
      projectPath: { type: 'string' }, deployHost: { type: 'string' }, deployUser: { type: 'string' }, deployDir: { type: 'string' }, sshKey: { type: 'string' },
      pollMinutes: { type: 'number' }, extraContext: { type: 'string' },
      mailProvider: { type: 'string', enum: ['gmail', 'imap'] },
    }, required: ['id', 'name', 'authorizedSenders'] } } },
  { type: 'function', function: { name: 'update_agent', description: 'Actualiza un agente existente (config, enabled, senders…).',
    parameters: { type: 'object', properties: {
      id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
      authorizedSenders: { type: 'array', items: { type: 'object' } },
      projectPath: { type: 'string' }, deployHost: { type: 'string' }, deployUser: { type: 'string' }, deployDir: { type: 'string' }, sshKey: { type: 'string' },
      pollMinutes: { type: 'number' }, extraContext: { type: 'string' }, enabled: { type: 'boolean' },
    }, required: ['id'] } } },
  { type: 'function', function: { name: 'create_task', description: 'Manda una tarea (= email) al inbox del agente. El agente la procesa en su próximo tick.',
    parameters: { type: 'object', properties: {
      agentId:   { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' },
      fromEmail: { type: 'string', description: 'autorizado en el agente; default: email del usuario actual' },
    }, required: ['agentId', 'subject', 'body'] } } },
  { type: 'function', function: { name: 'list_mcp_registry', description: 'Lista los MCP servers disponibles para añadir.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'add_mcp_server', description: 'Añade un MCP server al agente. values son env vars del registry entry.',
    parameters: { type: 'object', properties: { agentId: { type: 'string' }, name: { type: 'string' }, values: { type: 'object' } }, required: ['agentId', 'name', 'values'] } } },
  { type: 'function', function: { name: 'remove_mcp_server', description: 'Quita un MCP server del agente.',
    parameters: { type: 'object', properties: { agentId: { type: 'string' }, name: { type: 'string' } }, required: ['agentId', 'name'] } } },
  { type: 'function', function: { name: 'gitea_list_repos', description: 'Lista repos del Gitea built-in.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'gitea_create_repo', description: 'Crea un repo nuevo en Gitea built-in.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, owner: { type: 'string' }, description: { type: 'string' }, private: { type: 'boolean' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'check_repo', description: 'Comprueba si un path local existe o si una URL git responde.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'provision_database', description: 'Crea una BD PostgreSQL nueva en el postgres built-in.',
    parameters: { type: 'object', properties: { db: { type: 'string' }, user: { type: 'string' }, password: { type: 'string' } }, required: ['db', 'user'] } } },
  { type: 'function', function: { name: 'provision_mailbox', description: 'Crea un mailbox <agentId>@bot.utopiaia.com manual (save_agent ya lo hace por defecto).',
    parameters: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] } } },
];

async function executeTool(name, args, req) {
  if (name === 'list_agents') {
    return { agents: listAgents().map(a => ({
      id: a.id, name: a.name, botEmail: a.botEmail, enabled: a.enabled, ready: a.ready,
      mailProvider: a.mailProvider, authorizedSenders: (a.authorizedSenders || []).map(s => s.email || s),
      description: a.description || '', version: a.version,
    })) };
  }
  if (name === 'save_agent')      return { agent: await createAgent(args) };
  if (name === 'update_agent')    {
    const { id, ...patch } = args;
    if (!getAgent(id)) throw new Error(`agent '${id}' not found`);
    return { agent: updateAgent(id, patch) };
  }
  if (name === 'create_task') {
    if (!args.agentId) throw new Error('agentId required — call list_agents first');
    const agent = getAgent(args.agentId);
    if (!agent) throw new Error(`agent '${args.agentId}' not found — available: ${listAgents().map(a => a.id).join(', ')}`);
    if (agent.mailProvider !== 'imap') throw new Error('create_task only supported on IMAP agents');
    const senders = (agent.authorizedSenders || []).map(s => (s.email || s).toLowerCase());
    let from = (args.fromEmail || '').toLowerCase();
    if (!from) from = req.session?.user?.email?.toLowerCase() || senders[0];
    if (!senders.includes(from)) throw new Error(`from ${from} not in authorizedSenders of ${args.agentId}`);
    const result = await taskInjector.injectEmail({
      agentId: args.agentId, fromEmail: from, fromName: req.session?.user?.name || '',
      subject: args.subject, body: args.body,
    });
    checkAgent(agent).catch(() => {});
    return { task: { agentId: args.agentId, to: result.to, subject: args.subject } };
  }
  if (name === 'list_mcp_registry') return { registry: listRegistry().map(e => ({ name: e.name, label: e.label, category: e.category, description: e.description, fields: e.fields })) };
  if (name === 'add_mcp_server') {
    if (!getAgent(args.agentId)) throw new Error(`agent '${args.agentId}' not found`);
    const built = addServer(args.agentId, args.name, args.values || {});
    return { mcp: { agent: args.agentId, name: args.name, command: built.command } };
  }
  if (name === 'remove_mcp_server') {
    if (!getAgent(args.agentId)) throw new Error(`agent '${args.agentId}' not found`);
    removeServer(args.agentId, args.name);
    return { removed: args.name };
  }
  if (name === 'gitea_list_repos') {
    const list = await gitea.listRepos();
    return { repos: list.slice(0, 30).map(r => ({ full_name: r.full_name, description: r.description, clone_url: r.clone_url, html_url: r.html_url })) };
  }
  if (name === 'gitea_create_repo') return { repo: await gitea.createRepo(args) };
  if (name === 'check_repo') {
    const p = args.path;
    if (/^https?:\/\//.test(p) || p.startsWith('git@')) {
      try {
        const r = await fetch(p, { signal: AbortSignal.timeout(3000) });
        return { ok: r.ok, info: `HTTP ${r.status}`, path: p };
      } catch (e) { return { ok: false, info: e.message, path: p }; }
    }
    return { ok: fs.existsSync(p), info: fs.existsSync(p) ? 'exists' : 'not found', path: p };
  }
  if (name === 'provision_database') {
    const password = args.password || require('crypto').randomBytes(16).toString('base64').replace(/[+/=]/g, '');
    const r = await pg.provisionDatabase({ ...args, password });
    return { db: { db: r.db, user: r.user, host: r.host, port: r.port, password, connectionString: r.connectionString } };
  }
  if (name === 'provision_mailbox') {
    const email = mailServer.suggestEmailFor(args.agentId);
    const password = require('crypto').randomBytes(16).toString('base64').replace(/[+/=]/g, '');
    await mailServer.addMailbox(email, password);
    if (getAgent(args.agentId)) {
      const credPath = path.join(os.homedir(), '.claude', 'skills', args.agentId, 'imap-credentials.json');
      fs.writeFileSync(credPath, JSON.stringify({ password }, null, 2));
      try { fs.chmodSync(credPath, 0o600); } catch {}
    }
    return { mailbox: { email, password, imapHost: mailServer.DOMAIN, imapPort: 993, smtpHost: mailServer.DOMAIN, smtpPort: 587 } };
  }
  throw new Error(`unknown tool '${name}'`);
}

router.post('/', async (req, res) => {
  const { messages = [], sessionId: providedId } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }
  const userId = req.session.user?.sub || 'anon';
  const allActions = [];
  let workingMessages = [...messages];
  let finalText = '';
  let finalReason = null;

  try {
    // Tool-calling loop. We allow tools on the first call. After tools have
    // run we force a final natural-language answer (tool_choice='none') so the
    // model can never loop forever calling the same thing. If it didn't use
    // any tool on the first call, we just take that text.
    const MAX_ITERS = 3;
    const calledTools = new Set();
    for (let iter = 0; iter < MAX_ITERS; iter++) {
      const lastIter = iter === MAX_ITERS - 1;
      const choiceMode = (iter === 0) ? 'auto' : (lastIter ? 'none' : 'auto');
      const resp = await chat({
        system: SYSTEM_PROMPT,
        messages: workingMessages,
        tools: TOOLS,
        userSub: userId,
        toolChoice: choiceMode,
      });
      const choice = resp.choices?.[0]?.message || {};
      finalReason = resp.choices?.[0]?.finish_reason;
      const toolCalls = choice.tool_calls || [];

      if (toolCalls.length === 0) {
        finalText = choice.content || '';
        break;
      }

      // Detect a runaway loop: same tool+args called again on a later iter.
      const fp = toolCalls.map(t => `${t.function?.name}:${t.function?.arguments}`).join('|');
      if (calledTools.has(fp)) {
        // Force final answer next iter
        workingMessages.push({
          role: 'assistant',
          content: 'Tengo lo que necesito, voy a responder al usuario.',
        });
        // Loop again with tool_choice=none on the last iter
        continue;
      }
      calledTools.add(fp);

      workingMessages.push({
        role: 'assistant',
        content: choice.content || '',
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const name = tc.function?.name;
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); }
        catch { /* bad args */ }
        let result;
        try {
          result = await executeTool(name, args, req);
          allActions.push({ tool: name, ok: true, ...result });
        } catch (e) {
          result = { error: e.message };
          allActions.push({ tool: name, ok: false, error: e.message });
        }
        workingMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Strip an optional "{...function_calls: []...}" preamble (line-anchored so
    // it doesn't eat the rest of the message), then fall back to a friendly
    // default if the model returned nothing.
    let cleanedText = (finalText || '').replace(/^\s*\{\s*"?function_calls"?\s*:\s*\[\s*\]\s*\}\s*\n?/i, '').trim();
    const reply = cleanedText || (allActions.length
      ? `Hecho. (Acciones: ${allActions.map(a => a.tool).join(', ')})`
      : '(sin respuesta del modelo — vuelve a probar)');
    const finalMessages = [
      ...messages,
      { role: 'assistant', content: reply, actions: allActions.length ? allActions : undefined },
    ];
    const sessionId = providedId || sessions.newId();
    sessions.saveSession({ id: sessionId, userId, messages: finalMessages });

    res.json({ sessionId, reply, actions: allActions, finishReason: finalReason });
  } catch (e) {
    console.error('[chat] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

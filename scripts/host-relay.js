#!/usr/bin/env node
// ── Agent Host Relay ─────────────────────────────────────────────────────────
// Runs on the Mac HOST (outside Docker) so claude can authenticate via
// the macOS Keychain / OAuth subscription.
//
// The console container hits http://host.docker.internal:3201/run  to launch
// a claude agent with full Mac auth, and events are POSTed back to the
// console's activity API.
//
// Usage (from the work2026/agent-manager directory):
//   node scripts/host-relay.js
//
// Or start automatically via the start.sh wrapper.
// ─────────────────────────────────────────────────────────────────────────────

const http   = require('http');
const https  = require('https');
const { spawn } = require('child_process');
const path   = require('path');
const url    = require('url');
const os     = require('os');

const PORT             = parseInt(process.env.RELAY_PORT    || '3201', 10);
const CLAUDE_BIN       = process.env.CLAUDE_BIN   || path.join(os.homedir(), '.local', 'bin', 'claude');
const CONSOLE_URL      = process.env.CONSOLE_URL  || 'http://localhost:3100';
const AUTH_TOKEN       = process.env.RELAY_TOKEN  || ''; // optional bearer token for relay itself
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'relay-internal-2026'; // must match console
const LOCAL_MLX_URL    = process.env.LOCAL_MLX_URL   || 'http://localhost:8000';
const LOCAL_MLX_URL_B  = process.env.LOCAL_MLX_URL_B || 'http://localhost:8001';
const LITELLM_URL      = process.env.LITELLM_URL     || 'http://localhost:4000';

// ── Auto-recovery config ──────────────────────────────────────────────────────
const SESSION_TIMEOUT_MS        = parseInt(process.env.SESSION_TIMEOUT_MS        || '600000', 10); // 10 min
const CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5',      10); // 5 consecutive failures
const CIRCUIT_BREAKER_RESET_MS  = parseInt(process.env.CIRCUIT_BREAKER_RESET_MS  || '300000', 10); // 5 min
const WATCHDOG_INTERVAL_MS      = parseInt(process.env.WATCHDOG_INTERVAL_MS      || '60000',  10); // 1 min
const BINARY_CHECK_INTERVAL_MS  = parseInt(process.env.BINARY_CHECK_INTERVAL_MS  || '120000', 10); // 2 min

// ── Relay state ───────────────────────────────────────────────────────────────
let claudeAvailable     = true;  // false when binary check fails
let circuitOpen         = false; // true after N consecutive spawn failures
let circuitOpenAt       = 0;     // timestamp when circuit opened
let consecutiveFailures = 0;     // circuit breaker counter

const active = new Map(); // sessionId → { proc, stdin, startedAt, lastActivity }

// ── MLX health check (GET /v1/models) ────────────────────────────────────────
async function checkMlx(baseUrl) {
  const modelsUrl = baseUrl.replace(/\/v1\/?$/, '') + '/v1/models';
  try {
    const r = await fetch(modelsUrl, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { ok: false, url: modelsUrl, status: r.status };
    const data = await r.json();
    const models = (data.data || []).map(m => m.id || m.model_name).filter(Boolean);
    return { ok: true, url: modelsUrl, models };
  } catch (e) {
    return { ok: false, url: modelsUrl, error: e.message };
  }
}

// ── DNS check for .kikocis.test ───────────────────────────────────────────────
function checkDns(hostname) {
  const dns = require('dns');
  return new Promise(resolve => {
    dns.lookup(hostname, (err, addr) =>
      err ? resolve({ ok: false, error: err.message }) : resolve({ ok: true, addr })
    );
  });
}

// ── Claude binary check ───────────────────────────────────────────────────────
function checkClaudeBinary() {
  const { execFile } = require('child_process');
  execFile(CLAUDE_BIN, ['--version'], { timeout: 8000 }, (err, stdout) => {
    if (err) {
      if (claudeAvailable) {
        console.error(`[relay] ⚠ claude binary unavailable: ${err.message}`);
        claudeAvailable = false;
      }
    } else {
      if (!claudeAvailable) {
        console.log(`[relay] ✓ claude binary restored: ${stdout.trim()}`);
        claudeAvailable = true;
      }
    }
  });
}

// ── Circuit breaker helpers ───────────────────────────────────────────────────
function recordSpawnFailure() {
  consecutiveFailures++;
  if (!circuitOpen && consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpen   = true;
    circuitOpenAt = Date.now();
    console.error(`[relay] ⚡ Circuit breaker OPEN after ${consecutiveFailures} consecutive failures — pausing spawns for ${CIRCUIT_BREAKER_RESET_MS / 60000}min`);
  }
}

function recordSpawnSuccess() {
  if (consecutiveFailures > 0) {
    console.log(`[relay] ✓ Spawn success — resetting failure counter (was ${consecutiveFailures})`);
  }
  consecutiveFailures = 0;
  circuitOpen         = false;
}

function isCircuitOpen() {
  if (!circuitOpen) return false;
  if (Date.now() - circuitOpenAt >= CIRCUIT_BREAKER_RESET_MS) {
    console.log(`[relay] ⚡ Circuit breaker HALF-OPEN — allowing test spawn`);
    circuitOpen = false; // half-open: allow one attempt
    return false;
  }
  return true;
}

// ── Session watchdog ──────────────────────────────────────────────────────────
// Runs every WATCHDOG_INTERVAL_MS — kills stale sessions and cleans up zombies
function runWatchdog() {
  const now = Date.now();
  for (const [sid, entry] of active.entries()) {
    const { proc, startedAt, lastActivity } = entry;

    // Zombie check: process already exited but wasn't cleaned up
    if (proc.exitCode !== null || proc.killed) {
      console.warn(`[relay] watchdog: cleaning up zombie session ${sid} (exitCode=${proc.exitCode})`);
      active.delete(sid);
      post(`${CONSOLE_URL}/api/activity/sessions/${sid}/events`, {
        type: 'session_error', code: proc.exitCode || 1, error: 'Session zombie — cleaned up by watchdog',
      }).catch(() => {});
      continue;
    }

    // Timeout check: session has been running too long with no recent activity
    const idleMs  = now - (lastActivity || startedAt);
    const totalMs = now - startedAt;
    if (totalMs > SESSION_TIMEOUT_MS) {
      console.warn(`[relay] watchdog: session ${sid} timed out after ${Math.round(totalMs / 60000)}min — killing`);
      try { proc.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { if (!proc.killed) proc.kill('SIGKILL'); } catch {} }, 5000);
      active.delete(sid);
      post(`${CONSOLE_URL}/api/activity/sessions/${sid}/events`, {
        type: 'session_error', code: 1, error: `Session timed out after ${Math.round(totalMs / 60000)}min`,
      }).catch(() => {});
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function post(targetUrl, body) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(targetUrl);
    const mod    = parsed.protocol === 'https:' ? https : http;
    const data   = JSON.stringify(body);
    const req    = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.path,
      method:   'POST',
      headers: {
        'Content-Type':    'application/json',
        'Content-Length':  Buffer.byteLength(data),
        'x-internal-key':  INTERNAL_API_KEY,
      },
    }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => buf += c);
    req.on('end',  () => {
      try { resolve(JSON.parse(buf)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── routes ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);

  // Auth check
  if (AUTH_TOKEN) {
    const tok = (req.headers.authorization || '').replace('Bearer ', '');
    if (tok !== AUTH_TOKEN) {
      res.writeHead(401); return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
  }

  res.setHeader('Content-Type', 'application/json');

  // ── GET /health ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/health') {
    // Run all checks in parallel
    const [mlxA, mlxB, dnsConsole, dnsLitellm] = await Promise.all([
      checkMlx(LOCAL_MLX_URL),
      checkMlx(LOCAL_MLX_URL_B),
      checkDns('console.kikocis.test'),
      checkDns('litellm.kikocis.test'),
    ]);
    const degraded = !claudeAvailable || circuitOpen;
    return res.end(JSON.stringify({
      ok:       !degraded,
      degraded,
      relay:    '1.1',
      claude:   CLAUDE_BIN,
      claudeOk: claudeAvailable,
      active:   active.size,
      circuit: {
        open:               circuitOpen,
        consecutiveFailures,
        openSince:          circuitOpen ? new Date(circuitOpenAt).toISOString() : null,
        resetInMs:          circuitOpen ? Math.max(0, CIRCUIT_BREAKER_RESET_MS - (Date.now() - circuitOpenAt)) : 0,
      },
      mlx: {
        a: mlxA,
        b: mlxB,
      },
      dns: {
        'console.kikocis.test':  dnsConsole,
        'litellm.kikocis.test':  dnsLitellm,
      },
    }));
  }

  // ── POST /v1/chat/completions — OpenAI-compatible endpoint via Claude subscription ──
  // LiteLLM calls this as the "claude-subscription" backend. It spawns the claude CLI
  // WITHOUT ANTHROPIC_BASE_URL so it authenticates via macOS Keychain (OAuth subscription).
  if (req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/chat/completions')) {
    // Auth: accept INTERNAL_API_KEY or LITELLM_MASTER_KEY as bearer token
    const authHdr   = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const xKey      = req.headers['x-internal-key'] || '';
    const masterKey = process.env.LITELLM_MASTER_KEY || '';
    if (authHdr !== INTERNAL_API_KEY && xKey !== INTERNAL_API_KEY &&
        (masterKey && authHdr !== masterKey)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'auth_error', code: '401' } }));
    }

    let body;
    try { body = await readBody(req); }
    catch { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Invalid JSON' } })); }

    const messages   = body.messages || [];
    const doStream   = body.stream   || false;
    const maxTokens  = body.max_tokens || 8192;

    // Map LiteLLM model names → Claude model identifiers
    const MODEL_MAP = {
      'claude-haiku-4-5':  'claude-haiku-4-5',
      'claude-sonnet-4-6': 'claude-sonnet-4-6',
      'claude-opus-4-5':   'claude-opus-4-5',
      'claude-primary':    'claude-sonnet-4-6',
      'council-security':  'claude-sonnet-4-6',
      'council-quality':   'claude-sonnet-4-6',
      'council-fixes':     'claude-sonnet-4-6',
      'chat-assistant':    'claude-haiku-4-5',
    };
    const requestedModel = (body.model || 'claude-sonnet-4-6').replace(/^openai\//, '');
    const claudeModel    = MODEL_MAP[requestedModel] || requestedModel;
    // Optional reasoning effort (low|medium|high|max) — lets callers ask for max thinking.
    const reqEffort = (body.effort || body.reasoning_effort || '').toString().toLowerCase();
    const validEffort = ['low','medium','high','max'].includes(reqEffort) ? reqEffort : '';

    // Extract system prompt and build user prompt
    const sysParts = messages.filter(m => m.role === 'system').map(m =>
      typeof m.content === 'string' ? m.content : (m.content || []).map(c => c.text || '').join('')
    );
    const systemPrompt = sysParts.join('\n');

    const nonSys = messages.filter(m => m.role !== 'system');
    if (nonSys.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'No user messages provided' } }));
    }

    let userPrompt;
    if (nonSys.length === 1 && nonSys[0].role === 'user') {
      const c = nonSys[0].content;
      userPrompt = typeof c === 'string' ? c : (c || []).map(b => b.text || '').join('');
    } else {
      // Multi-turn: format as dialogue, handling tool-call exchanges
      userPrompt = nonSys.map(m => {
        if (m.role === 'user') {
          const c = m.content;
          const text = typeof c === 'string' ? c : (c || []).map(b => b.text || '').join('');
          return `Human: ${text}`;
        }
        if (m.role === 'assistant') {
          // May have tool_calls (no content) or content (plain response)
          if (m.tool_calls?.length) {
            const calls = m.tool_calls.map(tc => `${tc.function.name}(${tc.function.arguments})`).join(', ');
            return `Assistant (called): ${calls}`;
          }
          const c = m.content;
          const text = typeof c === 'string' ? c : (c || []).map(b => b.text || '').join('');
          return `Assistant: ${text}`;
        }
        if (m.role === 'tool') {
          return `Tool result [${m.tool_call_id || 'call'}]: ${m.content}`;
        }
        return '';
      }).filter(Boolean).join('\n\n');
      // When tool-calling mode and the last message is a tool result,
      // append a reminder so claude doesn't drift into plain text
      if ((body.tools || []).length > 0 && nonSys.length > 1 && nonSys[nonSys.length - 1]?.role === 'tool') {
        userPrompt += '\n\n[REMINDER: Respond ONLY with a JSON object {"function_calls": [...]}. No text outside the JSON.]';
      }
    }

    const reqId    = `relay-cmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created  = Math.floor(Date.now() / 1000);
    const startMs  = Date.now();

    // ── Prompt-based tool calling ─────────────────────────────────────────────
    // The claude CLI doesn't support OpenAI tool_calls format. When tools are
    // provided in the request (e.g. from the orchestrator), we inject them as
    // text into the system prompt and ask claude to respond with JSON.
    // The relay then parses the JSON and returns it as proper OpenAI tool_calls.
    const requestedTools = body.tools || [];
    const hasTools = requestedTools.length > 0;

    let effectiveSystemPrompt;
    if (hasTools) {
      const toolDescriptions = requestedTools.map(t => {
        const fn = t.function;
        return `- ${fn.name}: ${fn.description}`;
      }).join('\n');

      // Put the JSON constraint FIRST so it overrides the orchestrator's system prompt.
      // Explicitly state that WebSearch/Bash do NOT exist to prevent claude from trying them.
      effectiveSystemPrompt =
        `CRITICAL: You are a JSON function-calling endpoint. You CANNOT use WebSearch, Bash, Task, or any built-in tools — they do not exist here. Attempting to use them will fail.\n\n` +
        `To take actions, output ONLY a JSON object with the functions you want to call. The system executes them and calls you again with results.\n\n` +
        `AVAILABLE FUNCTIONS (the ONLY ones you can use):\n${toolDescriptions}\n\n` +
        `REQUIRED OUTPUT FORMAT — respond with ONLY this JSON, nothing else:\n` +
        `{"function_calls": [{"name": "function_name", "arguments": {"key": "value"}}]}\n` +
        `Multiple calls: {"function_calls": [{"name": "fn1", "arguments": {}}, {"name": "fn2", "arguments": {}}]}\n` +
        `No calls needed: {"function_calls": []}\n\n` +
        (systemPrompt || '');
    } else {
      // Non-tool-calling: ask for plain text, prevent built-in tool use that wastes turns
      const noToolsNote = '\n\nIMPORTANT: Respond with plain text only. Do NOT call WebSearch, Bash, or any other tools. Base your response on the information already provided.';
      effectiveSystemPrompt = systemPrompt ? systemPrompt + noToolsNote : noToolsNote.trim();
    }

    const cliArgs = [
      '--print', '--verbose',
      '--output-format', doStream ? 'stream-json' : 'json',
      '--model', claudeModel,
      '--no-session-persistence',
      '--dangerously-skip-permissions', // allow built-in tools to run within the 1 turn
      '--max-turns', '1', // 1 turn: use tools if needed, then output JSON
    ];
    if (validEffort) cliArgs.push('--effort', validEffort);
    cliArgs.push('--system-prompt', effectiveSystemPrompt);
    cliArgs.push(userPrompt);

    // Run WITHOUT ANTHROPIC_BASE_URL → Claude uses real Anthropic (subscription)
    // If no Anthropic API key is available, fall back to direct MLX call
    const homeDir = os.homedir();
    const userName = path.basename(homeDir) || 'user';

    // ── Spawn Claude CLI — uses OAuth subscription if no API key, or API key if set ──
    // Detect a REAL Anthropic API key (not the fake relay proxy key)
    const rawKey       = process.env.ANTHROPIC_API_KEY || '';
    const isFakeKey    = !rawKey || rawKey === 'sk-ant-local-proxy' || rawKey.length < 20;
    const anthropicKey = isFakeKey ? '' : rawKey;
    // No API key → claude uses stored OAuth credentials (subscription) automatically

    // ── Spawn Claude CLI ──────────────────────────────────────────────────────
    const claudeEnv = {
      HOME: homeDir, USER: userName, LOGNAME: userName,
      TMPDIR: process.env.TMPDIR || '/tmp',
      TERM:   process.env.TERM   || 'xterm-256color',
      LANG:   process.env.LANG   || 'en_US.UTF-8',
      PATH:   process.env.PATH   || `/Users/${userName}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      XDG_CONFIG_HOME: `${homeDir}/.config`,
      XDG_DATA_HOME:   `${homeDir}/.local/share`,
      ...process.env,
      HOME: homeDir,
      ...(anthropicKey ? { ANTHROPIC_API_KEY: anthropicKey } : {}),
    };
    // Remove LiteLLM proxy override — use real Anthropic endpoint for subscription
    delete claudeEnv.ANTHROPIC_BASE_URL;
    delete claudeEnv.ANTHROPIC_AUTH_TOKEN;

    const promptSize = (systemPrompt.length + userPrompt.length);
    console.log(`[relay] /v1/chat/completions model=${claudeModel} stream=${doStream} id=${reqId} prompt=${promptSize}chars`);

    let proc;
    try {
      proc = spawn(CLAUDE_BIN, cliArgs, { env: claudeEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: `spawn failed: ${err.message}` } }));
    }
    proc.stdin.end(); // no stdin needed

    if (!doStream) {
      // ── Non-streaming ────────────────────────────────────────────────────
      let stdout = '', stderr = '';
      // Declare BEFORE the close handler to avoid TDZ ReferenceError
      let resultText = '', inputTok = 0, outputTok = 0;
      // --output-format json emits a JSON array on stdout; stream-json emits NDJSON.
      // Try JSON array first, then fall back to NDJSON line-by-line parsing.
      const findResult = ev => {
        // Capture last assistant text message (fallback if result.result is null)
        if (ev.type === 'assistant' && ev.message?.content) {
          const textBlocks = (ev.message.content || []).filter(b => b.type === 'text');
          if (textBlocks.length) resultText = textBlocks.map(b => b.text).join('');
        }
        if (ev.type === 'result') {
          if (ev.result) resultText = ev.result; // prefer result.result if present
          inputTok  = ev.usage?.input_tokens  || inputTok;
          outputTok = ev.usage?.output_tokens || outputTok;
        }
      };
      proc.stdout.on('data', d => stdout += d.toString());
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', code => {
        const elapsed = ((Date.now() - startMs) / 1000).toFixed(2);
        // Parse stdout — handles both JSON array (--output-format json) and NDJSON (stream-json)
        try {
          const parsed = JSON.parse(stdout.trim());
          if (Array.isArray(parsed)) parsed.forEach(findResult);
          else findResult(parsed);
        } catch {
          for (const line of stdout.split('\n')) {
            const t = line.trim(); if (!t) continue;
            try { findResult(JSON.parse(t)); } catch {}
          }
        }
        if (code !== 0 && !resultText) {
          console.error(`[relay] completions failed code=${code} stderr="${stderr.slice(0, 300)}" stdout_tail="${stdout.slice(-500)}"`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: { message: `Claude exited ${code}: ${stderr.slice(0, 200)}`, type: 'server_error', code: '500' } }));
        }
        if (code !== 0) {
          console.log(`[relay] completions code=${code} but has result text — recovering id=${reqId}`);
        }
        if (!resultText) resultText = stdout.trim();
        // ── Tool-calling response: parse JSON function_calls → OpenAI tool_calls ──
        if (hasTools && resultText) {
          console.log(`[relay] tool-mode result preview: ${resultText.slice(0, 300).replace(/\n/g, '↵')}`);
          try {
            // Strip markdown code fences if present
            const cleaned = resultText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
            const parsed = JSON.parse(cleaned);
            if (parsed.function_calls !== undefined) {
              const fcs = parsed.function_calls || [];
              if (fcs.length > 0) {
                const tool_calls = fcs.map((fc, i) => ({
                  id: `call_${reqId}_${i}`,
                  type: 'function',
                  function: { name: fc.name, arguments: JSON.stringify(fc.arguments || {}) },
                }));
                console.log(`[relay] completions tool_calls=[${fcs.map(f => f.name).join(',')}] id=${reqId} tokens=${inputTok}+${outputTok} elapsed=${elapsed}s`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                  id: reqId, object: 'chat.completion', created, model: claudeModel,
                  choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls }, finish_reason: 'tool_calls' }],
                  usage: { prompt_tokens: inputTok, completion_tokens: outputTok, total_tokens: inputTok + outputTok },
                }));
              } else {
                // Empty function_calls → model is done
                console.log(`[relay] completions tool_calls=[] (done) id=${reqId} elapsed=${elapsed}s`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                  id: reqId, object: 'chat.completion', created, model: claudeModel,
                  choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [] }, finish_reason: 'stop' }],
                  usage: { prompt_tokens: inputTok, completion_tokens: outputTok, total_tokens: inputTok + outputTok },
                }));
              }
            }
          } catch { /* not JSON — fall through to plain text response */ }
        }
        console.log(`[relay] completions done id=${reqId} tokens=${inputTok}+${outputTok} elapsed=${elapsed}s`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: reqId, object: 'chat.completion', created, model: claudeModel,
          choices: [{ index: 0, message: { role: 'assistant', content: resultText }, finish_reason: 'stop' }],
          usage:   { prompt_tokens: inputTok, completion_tokens: outputTok, total_tokens: inputTok + outputTok },
        }));
      });

    } else {
      // ── Streaming (SSE) ──────────────────────────────────────────────────
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      // Send role delta first
      res.write(`data: ${JSON.stringify({ id: reqId, object: 'chat.completion.chunk', created, model: claudeModel,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`);

      let buf = '', lastLen = 0;
      proc.stdout.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          const t = line.trim(); if (!t) continue;
          try {
            const ev = JSON.parse(t);
            if (ev.type === 'assistant' && ev.message?.content) {
              for (const blk of ev.message.content) {
                if (blk.type === 'text') {
                  const delta = blk.text.slice(lastLen);
                  lastLen = blk.text.length;
                  if (delta) res.write(`data: ${JSON.stringify({ id: reqId, object: 'chat.completion.chunk', created, model: claudeModel,
                    choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })}\n\n`);
                }
              }
            }
            if (ev.type === 'result') {
              res.write(`data: ${JSON.stringify({ id: reqId, object: 'chat.completion.chunk', created, model: claudeModel,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
              res.write('data: [DONE]\n\n');
            }
          } catch {}
        }
      });
      proc.on('close', code => {
        const elapsed = ((Date.now() - startMs) / 1000).toFixed(2);
        console.log(`[relay] completions stream done id=${reqId} code=${code} elapsed=${elapsed}s`);
        if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
      });
      req.on('close', () => { if (!proc.killed) proc.kill('SIGTERM'); });
    }
    return;
  }

  // ── GET /pid/:pid — check if a process is still alive ────────────────────
  if (req.method === 'GET' && pathname.startsWith('/pid/')) {
    const pid = parseInt(pathname.split('/pid/')[1], 10);
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { alive = false; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ pid, alive }));
  }

  // ── POST /run — launch a claude agent ────────────────────────────────────
  if (req.method === 'POST' && pathname === '/run') {
    let job;
    try { job = await readBody(req); }
    catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'bad json' })); }

    const { sessionId, task, workdir, model, args: prebuiltArgs } = job;
    if (!sessionId || !task) {
      res.writeHead(400); return res.end(JSON.stringify({ error: 'sessionId and task required' }));
    }

    // ── Circuit breaker check ──────────────────────────────────────────────
    if (isCircuitOpen()) {
      const resetIn = Math.ceil((CIRCUIT_BREAKER_RESET_MS - (Date.now() - circuitOpenAt)) / 1000);
      res.writeHead(503);
      return res.end(JSON.stringify({ ok: false, error: `Circuit breaker open — relay paused. Resets in ${resetIn}s` }));
    }
    if (!claudeAvailable) {
      res.writeHead(503);
      return res.end(JSON.stringify({ ok: false, error: `Claude binary unavailable at ${CLAUDE_BIN}` }));
    }

    const resolvedModel = model || 'claude-sonnet-4-6';
    const resolvedDir   = workdir || process.cwd();
    // Always use the relay's own CONSOLE_URL — the callbackUrl from the container
    // is an internal Docker DNS name (http://console:3100) not reachable from the host.
    const callback      = CONSOLE_URL;

    // Use pre-built args from agent-runner if provided (includes --dangerously-skip-permissions etc.)
    // Otherwise fall back to minimal args
    const args = (prebuiltArgs && prebuiltArgs.length > 0) ? prebuiltArgs : [
      '--output-format', 'stream-json',
      '--verbose',
      '--model',         resolvedModel,
      '-p',              task,
    ];

    // Ensure workspace dir exists before spawning (cwd must exist or Node throws ENOENT)
    require('fs').mkdirSync(resolvedDir, { recursive: true });

    console.log(`[relay] Launching ${sessionId} model=${resolvedModel} dir=${resolvedDir} args=${args.slice(0,6).join(' ')}...`);

    let proc;
    try {
      // When running under launchd the environment is very sparse (only what's in the plist).
      // Claude needs USER, LOGNAME, TMPDIR, etc. to authenticate and run properly.
      // Build a complete env by combining launchd env with essential user vars.
      const homeDir = os.homedir();
      const userName = process.env.USER || path.basename(homeDir) || 'user';
      const claudeEnv = {
        // Essential user environment
        HOME:       homeDir,
        USER:       process.env.USER       || userName,
        LOGNAME:    process.env.LOGNAME    || userName,
        TMPDIR:     process.env.TMPDIR     || '/tmp',
        TERM:       process.env.TERM       || 'xterm-256color',
        LANG:       process.env.LANG       || 'en_US.UTF-8',
        // PATH that includes homebrew, local bin, standard bins
        PATH: process.env.PATH || [
          `${homeDir}/.local/bin`,
          '/opt/homebrew/bin',
          '/opt/homebrew/sbin',
          '/usr/local/bin',
          '/usr/bin',
          '/bin',
          '/usr/sbin',
          '/sbin',
        ].join(':'),
        // XDG dirs (some CLIs need these)
        XDG_CONFIG_HOME: `${homeDir}/.config`,
        XDG_DATA_HOME:   `${homeDir}/.local/share`,
        // Merge any extra vars from launchd (ANTHROPIC_API_KEY etc.)
        ...process.env,
        // Always override HOME to the correct value
        HOME: homeDir,
      };
      // Agents must use native Claude OAuth (macOS Keychain), NOT LiteLLM proxy.
      // The LiteLLM port in the plist (4000) is the internal Docker port — not
      // reachable from the host. Removing these vars lets Claude Code authenticate
      // directly via the user's subscription stored in the Keychain.
      delete claudeEnv.ANTHROPIC_BASE_URL;
      delete claudeEnv.ANTHROPIC_AUTH_TOKEN;
      delete claudeEnv.ANTHROPIC_API_KEY;
      proc = spawn(CLAUDE_BIN, args, {
        cwd:   resolvedDir,
        env:   claudeEnv,
        stdio: ['pipe', 'pipe', 'pipe'], // stdin piped so we can inject comments
      });
    } catch (err) {
      console.error(`[relay] spawn failed: ${err.message}`);
      recordSpawnFailure();
      res.writeHead(500);
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }

    recordSpawnSuccess();
    const sessionEntry = { proc, stdin: proc.stdin, startedAt: Date.now(), lastActivity: Date.now() };
    active.set(sessionId, sessionEntry);
    res.end(JSON.stringify({ ok: true, sessionId, pid: proc.pid }));

    // Stream stdout events back to the console
    let buf = '';
    proc.stdout.on('data', async chunk => {
      sessionEntry.lastActivity = Date.now(); // update for watchdog
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete line
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          await post(`${callback}/api/activity/sessions/${sessionId}/events`, event)
            .catch(e => console.warn(`[relay] callback failed: ${e.message}`));
        } catch { /* non-JSON line, ignore */ }
      }
    });

    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) console.warn(`[relay] stderr [${sessionId}]: ${msg}`);
    });

    // Prevent uncaught 'error' events from crashing the relay process
    proc.on('error', async err => {
      active.delete(sessionId);
      recordSpawnFailure();
      console.error(`[relay] spawn error [${sessionId}]: ${err.message}`);
      await post(`${callback}/api/activity/sessions/${sessionId}/events`, {
        type:  'session_error',
        code:  1,
        error: `Spawn failed: ${err.message}`,
      }).catch(() => {});
    });

    proc.on('close', async code => {
      active.delete(sessionId);
      console.log(`[relay] ${sessionId} exited code=${code}`);
      await post(`${callback}/api/activity/sessions/${sessionId}/events`, {
        type:     code === 0 ? 'session_end' : 'session_error',
        code,
        error:    code !== 0 ? `Process exited with code ${code}` : undefined,
      }).catch(() => {});
    });

    return;
  }

  // ── POST /inject/:sessionId — write a comment to running agent's stdin ────
  if (req.method === 'POST' && pathname.startsWith('/inject/')) {
    const sid   = pathname.slice('/inject/'.length);
    const entry = active.get(sid);
    if (!entry) {
      res.writeHead(404);
      return res.end(JSON.stringify({ ok: false, error: 'session not running' }));
    }
    let body;
    try { body = await readBody(req); } catch { body = {}; }
    const text = (body.text || '').trim();
    if (!text) {
      return res.end(JSON.stringify({ ok: false, error: 'text required' }));
    }
    try {
      // Write as a human message — Claude Code reads from stdin during interactive turns
      entry.proc.stdin.write(`\n${text}\n`);
      console.log(`[relay] Injected comment into ${sid}: ${text.slice(0, 60)}`);
      return res.end(JSON.stringify({ ok: true, sid }));
    } catch (e) {
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // ── POST /stop/:sessionId — kill a running agent ──────────────────────────
  if (req.method === 'POST' && pathname.startsWith('/stop/')) {
    const sid = pathname.slice('/stop/'.length);
    const entry = active.get(sid);
    const proc  = entry?.proc || entry; // support both old and new format
    if (proc) { try { proc.kill(); } catch {} active.delete(sid); }
    return res.end(JSON.stringify({ ok: true, killed: !!proc }));
  }

  // ── GET /active — list running agents ─────────────────────────────────────
  if (req.method === 'GET' && pathname === '/active') {
    return res.end(JSON.stringify({
      active: [...active.keys()],
      count:  active.size,
    }));
  }

  // ── GET /rtk-status — check RTK installation on the host ──────────────────
  if (req.method === 'GET' && pathname === '/rtk-status') {
    const { execFile } = require('child_process');
    execFile('rtk', ['--version'], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        return res.end(JSON.stringify({
          installed: false,
          error:     'RTK no instalado — ejecuta: brew install rtk-ai/tap/rtk',
          hint:      'https://github.com/rtk-ai/rtk',
        }));
      }
      // Check if hook is initialised
      execFile('rtk', ['init', '--show'], { timeout: 5000 }, (err2, hookOut) => {
        const hookActive = !err2 && hookOut.includes('hook');
        res.end(JSON.stringify({
          installed:   true,
          version:     stdout.trim(),
          hookActive,
          note:        hookActive
            ? 'RTK instalado y hook activo — los agentes ahorran tokens automáticamente'
            : 'RTK instalado pero hook no activo — ejecuta: rtk init -g',
        }));
      });
    });
    return; // async — don't fall through to 404
  }

  // ── POST /admin/circuit-reset — manually reset circuit breaker ───────────
  if (req.method === 'POST' && pathname === '/admin/circuit-reset') {
    consecutiveFailures = 0;
    circuitOpen         = false;
    circuitOpenAt       = 0;
    console.log('[relay] Circuit breaker manually reset');
    return res.end(JSON.stringify({ ok: true, message: 'Circuit breaker reset' }));
  }

  // ── POST /admin/restart — drain active sessions then exit (systemd restarts) ─
  if (req.method === 'POST' && pathname === '/admin/restart') {
    console.log(`[relay] Graceful restart requested — draining ${active.size} active sessions`);
    res.end(JSON.stringify({ ok: true, message: `Draining ${active.size} sessions then restarting` }));

    // Give active sessions 10s to finish, then SIGTERM them and exit
    setTimeout(() => {
      for (const [sid, entry] of active.entries()) {
        console.log(`[relay] restart: killing session ${sid}`);
        try { entry.proc.kill('SIGTERM'); } catch {}
      }
      setTimeout(() => {
        console.log('[relay] Restarting now (systemd will restart)');
        process.exit(0);
      }, 3000);
    }, active.size > 0 ? 10000 : 0);
    return;
  }

  // ── POST /rtk-install — install + init RTK hook on the host ───────────────
  if (req.method === 'POST' && pathname === '/rtk-install') {
    const { exec } = require('child_process');
    // Try brew first, then cargo
    const installCmd = 'brew install rtk-ai/tap/rtk 2>&1 || cargo install rtk 2>&1';
    exec(installCmd, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err && !stdout.includes('already installed')) {
        return res.end(JSON.stringify({ ok: false, error: stderr || err.message, stdout }));
      }
      // Init hook
      exec('rtk init -g --auto-patch 2>&1', { timeout: 30000 }, (err2, hookOut) => {
        res.end(JSON.stringify({
          ok:      true,
          install: stdout,
          hook:    hookOut,
          note:    'RTK instalado. Reinicia el relay para activar el hook.',
        }));
      });
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🤖 Agent Host Relay v1.1`);
  console.log(`   Listening on  :${PORT}`);
  console.log(`   Claude bin:    ${CLAUDE_BIN}`);
  console.log(`   Console URL:   ${CONSOLE_URL}`);
  console.log(`   Auth:          ${AUTH_TOKEN ? 'token set' : 'none (localhost only)'}`);
  console.log(`   Session timeout:  ${SESSION_TIMEOUT_MS / 60000}min`);
  console.log(`   Circuit breaker:  ${CIRCUIT_BREAKER_THRESHOLD} failures → ${CIRCUIT_BREAKER_RESET_MS / 60000}min pause`);
  console.log(`   Watchdog:         every ${WATCHDOG_INTERVAL_MS / 1000}s\n`);

  // Verify claude is accessible on startup
  checkClaudeBinary();
});

// ── Periodic auto-recovery tasks ──────────────────────────────────────────────
setInterval(runWatchdog,        WATCHDOG_INTERVAL_MS);
setInterval(checkClaudeBinary,  BINARY_CHECK_INTERVAL_MS);

// ── Uncaught exception guard — log but don't crash ────────────────────────────
process.on('uncaughtException', err => {
  console.error(`[relay] uncaughtException: ${err.message}\n${err.stack}`);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[relay] unhandledRejection: ${reason}`);
});

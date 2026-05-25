// Maps an email thread (per agent) to its Claude session id, so follow-up
// emails in the same conversation continue the same agent session instead of
// spawning a fresh one. Persisted in data/email-threads.json.
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'data', 'email-threads.json');

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}
function writeAll(map) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(map, null, 2));
}

function key(agentId, threadId) {
  return `${agentId}::${threadId}`;
}

function getSession(agentId, threadId) {
  return readAll()[key(agentId, threadId)] || null;
}

function rememberSession(agentId, threadId, sessionId) {
  const all = readAll();
  all[key(agentId, threadId)] = {
    sessionId,
    threadId,
    agentId,
    updatedAt: new Date().toISOString(),
  };
  writeAll(all);
}

function forgetSession(agentId, threadId) {
  const all = readAll();
  delete all[key(agentId, threadId)];
  writeAll(all);
}

// Called by activity route when Claude's init event arrives with the real session UUID.
// Finds the thread entry that was launched with relaySessionId and updates it
// with the Claude UUID so future --resume calls use a valid UUID.
function updateClaudeSessionId(relaySessionId, claudeSessionId) {
  const all = readAll();
  for (const entry of Object.values(all)) {
    if (entry.sessionId === relaySessionId) {
      entry.claudeSessionId = claudeSessionId;
      entry.updatedAt = new Date().toISOString();
      writeAll(all);
      return true;
    }
  }
  return false;
}

module.exports = { getSession, rememberSession, forgetSession, updateClaudeSessionId };

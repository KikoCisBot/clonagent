// Magic-link authentication — no passwords required for signup.
// Tokens are stored in data/magic-tokens.json and expire in 15 minutes.
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const FILE = path.resolve(__dirname, '..', 'data', 'magic-tokens.json');

function readTokens() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}
function writeTokens(obj) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2));
}

function createToken(email) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokens = readTokens();
  // purge expired first
  const now = Date.now();
  for (const [t, v] of Object.entries(tokens)) {
    if (new Date(v.expiresAt) < now) delete tokens[t];
  }
  tokens[token] = { email, expiresAt: new Date(now + 15 * 60_000).toISOString() };
  writeTokens(tokens);
  return token;
}

function consumeToken(token) {
  const tokens = readTokens();
  const entry  = tokens[token];
  if (!entry) return null;
  if (new Date(entry.expiresAt) < new Date()) {
    delete tokens[token];
    writeTokens(tokens);
    return null;
  }
  delete tokens[token];
  writeTokens(tokens);
  return entry.email;
}

module.exports = { createToken, consumeToken };

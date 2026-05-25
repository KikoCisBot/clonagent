// Per-user chat session persistence (data/chat-sessions.json).
// Each session: { id, userId, title, messages, createdAt, updatedAt }.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.resolve(__dirname, '..', 'data', 'chat-sessions.json');
const MAX_SESSIONS_PER_USER = 100;
const MAX_MESSAGES_PER_SESSION = 200;

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return []; }
}

function writeAll(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

function newId() { return crypto.randomBytes(8).toString('hex'); }

function listSessions(userId) {
  return readAll()
    .filter(s => s.userId === userId)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .map(s => ({
      id: s.id, title: s.title,
      messageCount: (s.messages || []).length,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    }));
}

function getSession(id, userId) {
  return readAll().find(s => s.id === id && s.userId === userId) || null;
}

function deriveTitle(messages) {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return 'Nueva conversación';
  const text = (firstUser.content || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 60) + (text.length > 60 ? '…' : '');
}

function saveSession({ id, userId, messages, title }) {
  const now = new Date().toISOString();
  const all = readAll();
  const i = all.findIndex(s => s.id === id);
  // Keep last N messages only
  const trimmed = messages.slice(-MAX_MESSAGES_PER_SESSION);
  let session;
  if (i >= 0) {
    session = {
      ...all[i],
      messages: trimmed,
      title: title || all[i].title || deriveTitle(trimmed),
      updatedAt: now,
    };
    all[i] = session;
  } else {
    session = {
      id: id || newId(),
      userId,
      title: title || deriveTitle(trimmed),
      messages: trimmed,
      createdAt: now,
      updatedAt: now,
    };
    all.unshift(session);
  }
  // Cap per-user sessions
  const keep = new Set();
  const userSessions = all.filter(s => s.userId === userId)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, MAX_SESSIONS_PER_USER)
    .map(s => s.id);
  userSessions.forEach(x => keep.add(x));
  const pruned = all.filter(s => s.userId !== userId || keep.has(s.id));
  writeAll(pruned);
  return session;
}

function deleteSession(id, userId) {
  const all = readAll().filter(s => !(s.id === id && s.userId === userId));
  writeAll(all);
}

function renameSession(id, userId, title) {
  const all = readAll();
  const i = all.findIndex(s => s.id === id && s.userId === userId);
  if (i < 0) return null;
  all[i] = { ...all[i], title, updatedAt: new Date().toISOString() };
  writeAll(all);
  return all[i];
}

module.exports = {
  newId, listSessions, getSession, saveSession, deleteSession, renameSession,
};

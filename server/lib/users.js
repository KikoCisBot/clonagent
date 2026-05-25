// Multi-user store. Replaces the simple users array inside settings.json with a
// dedicated file (data/users.json) and keeps per-user settings (relayKey,
// model, anthropicApiKey, etc.) so each user can authenticate against their
// own LLM credentials while sharing the same relay infrastructure.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const FILE = path.resolve(__dirname, '..', 'data', 'users.json');

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return []; }
}
function writeAll(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

function listUsers() {
  return readAll().map(u => ({
    username: u.username, name: u.name || u.username, email: u.email || '',
    isAdmin: !!u.isAdmin,
    createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
  }));
}

function findUser(username) {
  return readAll().find(u => u.username === username) || null;
}

function userCount() { return readAll().length; }

async function createUser({ username, password, name, email, isAdmin }) {
  if (!username || !/^[a-z0-9._-]+$/i.test(username)) throw new Error('username invalid');
  if (!password || password.length < 6) throw new Error('password must be ≥6 chars');
  const all = readAll();
  if (all.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('username already taken');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    username,
    passwordHash,
    name: name || username,
    email: email || '',
    isAdmin: !!isAdmin,
    settings: {},
    createdAt: new Date().toISOString(),
  };
  all.push(user);
  writeAll(all);
  return safeView(user);
}

async function verifyPassword(username, password) {
  const u = findUser(username);
  if (!u) return null;
  const ok = u.passwordHash
    ? await bcrypt.compare(password, u.passwordHash)
    : password === u.password;
  if (!ok) return null;
  // touch lastLoginAt
  const all = readAll();
  const i = all.findIndex(x => x.username === username);
  if (i >= 0) {
    all[i].lastLoginAt = new Date().toISOString();
    writeAll(all);
  }
  return safeView(u);
}

async function changePassword(username, newPassword) {
  if (!newPassword || newPassword.length < 6) throw new Error('password must be ≥6 chars');
  const all = readAll();
  const i = all.findIndex(u => u.username === username);
  if (i < 0) throw new Error('user not found');
  all[i].passwordHash = await bcrypt.hash(newPassword, 10);
  delete all[i].password;
  writeAll(all);
  return safeView(all[i]);
}

function deleteUser(username) {
  const all = readAll().filter(u => u.username !== username);
  writeAll(all);
}

function getUserSettings(username) {
  const u = findUser(username);
  return u?.settings || {};
}

function updateUserSettings(username, patch) {
  const all = readAll();
  const i = all.findIndex(u => u.username === username);
  if (i < 0) throw new Error('user not found');
  all[i].settings = { ...(all[i].settings || {}), ...patch };
  writeAll(all);
  return all[i].settings;
}

function setAdmin(username, isAdmin) {
  const all = readAll();
  const i = all.findIndex(u => u.username === username);
  if (i < 0) throw new Error('user not found');
  all[i].isAdmin = !!isAdmin;
  writeAll(all);
  return safeView(all[i]);
}

function findUserByEmail(email) {
  return readAll().find(u => u.email && u.email.toLowerCase() === email.toLowerCase()) || null;
}

function setResetToken(username, token) {
  const all = readAll();
  const i = all.findIndex(u => u.username === username);
  if (i < 0) return;
  all[i].resetToken    = token;
  all[i].resetTokenExp = new Date(Date.now() + 3600_000).toISOString(); // 1h
  writeAll(all);
}

function findUserByResetToken(token) {
  const u = readAll().find(u => u.resetToken === token);
  if (!u) return null;
  if (new Date(u.resetTokenExp) < new Date()) return null;
  return u;
}

function clearResetToken(username) {
  const all = readAll();
  const i = all.findIndex(u => u.username === username);
  if (i < 0) return;
  delete all[i].resetToken;
  delete all[i].resetTokenExp;
  writeAll(all);
}

function updateUserPlan(username, { plan, stripeCustomerId, stripeSubscriptionId, subscriptionStatus, planExpiresAt }) {
  const all = readAll();
  const i = all.findIndex(u => u.username === username);
  if (i < 0) throw new Error('user not found');
  if (plan                !== undefined) all[i].plan                 = plan;
  if (stripeCustomerId    !== undefined) all[i].stripeCustomerId     = stripeCustomerId;
  if (stripeSubscriptionId !== undefined) all[i].stripeSubscriptionId = stripeSubscriptionId;
  if (subscriptionStatus  !== undefined) all[i].subscriptionStatus   = subscriptionStatus;
  if (planExpiresAt       !== undefined) all[i].planExpiresAt        = planExpiresAt;
  writeAll(all);
  return safeView(all[i]);
}

function safeView(u) {
  if (!u) return null;
  return {
    username: u.username, name: u.name || u.username, email: u.email || '',
    isAdmin: !!u.isAdmin,
    plan:               u.plan               || 'free',
    stripeCustomerId:   u.stripeCustomerId   || null,
    subscriptionStatus: u.subscriptionStatus || null,
    planExpiresAt:      u.planExpiresAt      || null,
    settings: u.settings || {},
    createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
  };
}

// Migrate legacy users defined inside settings.json → users.json
async function migrateFromLegacy(legacyUsers) {
  if (!Array.isArray(legacyUsers) || legacyUsers.length === 0) return 0;
  const all = readAll();
  const have = new Set(all.map(u => u.username));
  let migrated = 0;
  for (const lu of legacyUsers) {
    if (have.has(lu.username)) continue;
    all.push({
      username: lu.username,
      passwordHash: lu.passwordHash,
      name: lu.name || lu.username,
      email: lu.email || '',
      isAdmin: lu.isAdmin === undefined ? true : !!lu.isAdmin,    // legacy users were admins
      settings: {},
      createdAt: new Date().toISOString(),
    });
    migrated++;
  }
  if (migrated) writeAll(all);
  return migrated;
}

module.exports = {
  listUsers, findUser, findUserByEmail, createUser, verifyPassword, changePassword,
  deleteUser, getUserSettings, updateUserSettings, setAdmin, userCount,
  setResetToken, findUserByResetToken, clearResetToken,
  updateUserPlan, migrateFromLegacy, safeView,
};

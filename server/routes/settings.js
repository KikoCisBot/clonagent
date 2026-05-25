// Read/write runtime settings stored in data/settings.json.
// Env vars are still authoritative on boot; settings.json overrides for hot-edit.
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const FILE = path.resolve(__dirname, '..', 'data', 'settings.json');

const DEFAULTS = () => ({
  relayUrl:  process.env.AGENT_RELAY_URL || process.env.LITELLM_URL || 'http://localhost:3201',
  relayKey:  process.env.LITELLM_MASTER_KEY || process.env.RELAY_KEY || 'relay-internal-2026',
  model:     process.env.CLONAGENT_MODEL || 'claude-opus-4-7',
  publicUrl: process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com',
  cron:      process.env.POLL_CRON || '* * * * *',
  integrations: {
    giteaUrl:    process.env.GITEA_URL_INTERNAL || 'http://localhost:3200',
    giteaToken:  process.env.GITEA_TOKEN        || '',
    giteaUser:   process.env.GITEA_ADMIN_USER   || '',
    pgContainer: process.env.PG_CONTAINER       || 'postgres-keycloak',
    pgSuperUser: process.env.PG_SUPER_USER      || 'keycloak',
    pgSuperDb:   process.env.PG_SUPER_DB        || 'keycloak',
  },
  auth: {
    mode: process.env.AUTH_MODE || 'basic',         // 'none' | 'basic' | 'oidc'
    allowRegistration: process.env.ALLOW_REGISTRATION !== '0',  // open by default
    basic: {
      users: [],                                    // legacy — migrated to users.json on boot
    },
    oidc: {
      issuerUrl:    process.env.OIDC_ISSUER_URL    || 'https://keycloak.utopiaia.com/realms/kikocisbot',
      clientId:     process.env.OIDC_CLIENT_ID     || 'clonagent',
      clientSecret: process.env.OIDC_CLIENT_SECRET || '',
      redirectUri:  process.env.OIDC_REDIRECT_URI  || 'https://clonagent.utopiaia.com/api/auth/oidc/callback',
    },
  },
});

function read() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  const def = DEFAULTS();
  return {
    ...def,
    ...saved,
    integrations: { ...def.integrations, ...(saved.integrations || {}) },
    auth: {
      ...def.auth,
      ...(saved.auth || {}),
      basic: { ...def.auth.basic, ...(saved.auth?.basic || {}) },
      oidc:  { ...def.auth.oidc,  ...(saved.auth?.oidc  || {}) },
    },
  };
}

function write(patch) {
  const next = { ...read() };
  for (const k of Object.keys(patch)) {
    if (k === 'auth' && typeof patch.auth === 'object') {
      next.auth = {
        ...next.auth,
        ...patch.auth,
        basic: { ...next.auth.basic, ...(patch.auth.basic || {}) },
        oidc:  { ...next.auth.oidc,  ...(patch.auth.oidc  || {}) },
      };
    } else if (k === 'integrations' && typeof patch.integrations === 'object') {
      next.integrations = { ...next.integrations, ...patch.integrations };
    } else {
      next[k] = patch[k];
    }
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  // Propagate to env so other modules pick it up
  if (patch.relayUrl)  process.env.LITELLM_URL  = patch.relayUrl;
  if (patch.relayKey)  process.env.LITELLM_MASTER_KEY = patch.relayKey;
  if (patch.model)     process.env.CLONAGENT_MODEL = patch.model;
  if (patch.publicUrl) process.env.PUBLIC_URL = patch.publicUrl;
  if (patch.cron)      process.env.POLL_CRON = patch.cron;
  // Reset OIDC client on auth change
  if (patch.auth) {
    try { require('../lib/auth').resetOidc(); } catch {}
  }
  return next;
}

function maskSecrets(s) {
  if (!s) return s;
  return s.replace(/^(.{4}).*(.{2})$/, '$1…$2');
}

function safeView(s) {
  return {
    ...s,
    relayKey: maskSecrets(s.relayKey),
    integrations: {
      ...s.integrations,
      giteaToken: maskSecrets(s.integrations?.giteaToken),
    },
    auth: {
      ...s.auth,
      basic: {
        users: (s.auth?.basic?.users || []).map(u => ({
          username: u.username, name: u.name, email: u.email,
          // never expose passwordHash
        })),
      },
      oidc: {
        ...s.auth?.oidc,
        clientSecret: maskSecrets(s.auth?.oidc?.clientSecret),
      },
    },
  };
}

router.get('/', (req, res) => res.json(safeView(read())));

router.patch('/', (req, res) => {
  const patch = req.body || {};
  // Don't overwrite secrets with their masked values
  if (patch.relayKey && patch.relayKey.includes('…')) delete patch.relayKey;
  if (patch.auth?.oidc?.clientSecret && patch.auth.oidc.clientSecret.includes('…'))
    delete patch.auth.oidc.clientSecret;
  if (patch.integrations?.giteaToken && patch.integrations.giteaToken.includes('…'))
    delete patch.integrations.giteaToken;
  res.json(safeView(write(patch)));
});

module.exports = { router, read, write };

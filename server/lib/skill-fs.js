// Read/write Claude Code skills under ~/.claude/skills/<id>/
// Each ClonAgent is a skill folder with SKILL.md, gmail_client.py, config.json,
// credentials.json (user-supplied), token.json (after OAuth), .versions/ (history).
const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILLS_ROOT = path.join(os.homedir(), '.claude', 'skills');
const TEMPLATES_ROOT = path.resolve(__dirname, '..', '..', 'templates');
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const REGISTRY_FILE = path.join(DATA_DIR, 'agents.json');

const VERSIONABLE_FILES = ['SKILL.md', 'config.json', 'gmail_client.py'];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(REGISTRY_FILE)) fs.writeFileSync(REGISTRY_FILE, '[]');
}

function readRegistry() {
  ensureDataDir();
  try { return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')); }
  catch { return []; }
}

function writeRegistry(list) {
  ensureDataDir();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(list, null, 2));
}

function listAgents() {
  return readRegistry().map(a => {
    const dir = path.join(SKILLS_ROOT, a.id);
    const hasGmailCreds  = fs.existsSync(path.join(dir, 'credentials.json'));
    const hasGmailToken  = fs.existsSync(path.join(dir, 'token.json'));
    const hasImapCreds   = fs.existsSync(path.join(dir, 'imap-credentials.json'));
    const provider = a.mailProvider || 'gmail';
    const ready = provider === 'imap' ? hasImapCreds : (hasGmailCreds && hasGmailToken);
    return {
      ...a,
      authorizedSenders: normalizeSenders(a.authorizedSenders),
      skillPath: dir,
      hasCredentials:     hasGmailCreds,
      hasToken:           hasGmailToken,
      hasImapCredentials: hasImapCreds,
      ready,
    };
  });
}

// Walk ~/.claude/skills/ for any folder containing a ClonAgent-style config.json
// and reconcile with the registry. Skills that exist on disk but not in the
// registry are added; skills in the registry without a folder are left as-is
// (they may be in mid-creation). Returns a list of changes.
// Files that should be kept in sync with the latest template (script logic
// upgrades shouldn't require recreating the agent).
const TEMPLATE_TRACKED = ['mail_client.py', 'gmail_client.py', 'requirements.txt'];

function refreshSkillScripts(skillId) {
  const skillDir = path.join(SKILLS_ROOT, skillId);
  const cfgPath = path.join(skillDir, 'config.json');
  if (!fs.existsSync(cfgPath)) return false;
  let cfg; try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { return false; }
  const provider = cfg.mailProvider || ((cfg.botEmail || '').endsWith('@bot.utopiaia.com') ? 'imap' : 'gmail');
  const tplDir = path.join(TEMPLATES_ROOT, provider === 'imap' ? 'email-triage-imap' : 'email-triage');
  let updated = false;
  for (const f of TEMPLATE_TRACKED) {
    const src = path.join(tplDir, f);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(skillDir, f);
    const want = fs.readFileSync(src, 'utf8');
    let cur = '';
    try { cur = fs.readFileSync(dst, 'utf8'); } catch {}
    if (cur !== want) { fs.writeFileSync(dst, want); updated = true; }
  }
  return updated;
}

// Backfill missing IMAP fields in any skill's config.json + refresh tracked
// scripts from templates so old skills get logic upgrades. Idempotent.
function repairConfigs() {
  if (!fs.existsSync(SKILLS_ROOT)) return [];
  const repaired = [];
  for (const entry of fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const cfgPath = path.join(SKILLS_ROOT, entry.name, 'config.json');
    if (!fs.existsSync(cfgPath)) continue;
    let cfg; try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { continue; }
    let dirty = false;
    if (cfg.mailProvider === 'imap' || (cfg.botEmail || '').endsWith('@bot.utopiaia.com')) {
      if (!cfg.mailProvider) { cfg.mailProvider = 'imap'; dirty = true; }
      if (!cfg.imapHost)     { cfg.imapHost = 'bot.utopiaia.com'; dirty = true; }
      if (!cfg.imapPort)     { cfg.imapPort = 993; dirty = true; }
      if (cfg.imapSsl == null){ cfg.imapSsl = true; dirty = true; }
      if (!cfg.smtpHost)     { cfg.smtpHost = 'bot.utopiaia.com'; dirty = true; }
      if (!cfg.smtpPort)     { cfg.smtpPort = 587; dirty = true; }
      if (cfg.smtpSsl == null){ cfg.smtpSsl = false; dirty = true; }
    }
    if (dirty) fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    const scriptsUpdated = refreshSkillScripts(entry.name);
    if (dirty || scriptsUpdated) repaired.push(entry.name);
  }
  return repaired;
}

function discoverAgents() {
  if (!fs.existsSync(SKILLS_ROOT)) return [];
  const reg = readRegistry();
  const known = new Set(reg.map(a => a.id));
  const added = [];

  for (const entry of fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const cfgPath = path.join(SKILLS_ROOT, entry.name, 'config.json');
    if (!fs.existsSync(cfgPath)) continue;
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { continue; }
    if (!cfg.id || !cfg.botEmail) continue;
    if (known.has(cfg.id)) continue;
    const stat = fs.statSync(cfgPath);
    reg.push({
      id: cfg.id,
      name: cfg.name || cfg.id,
      description: cfg.description || '',
      botEmail: cfg.botEmail,
      authorizedSenders: cfg.authorizedSenders || [],
      projectPath: cfg.projectPath || '',
      deployHost: cfg.deployHost || '',
      deployUser: cfg.deployUser || '',
      deployDir:  cfg.deployDir  || '',
      sshKey:     cfg.sshKey     || '',
      mailProvider: cfg.mailProvider || 'gmail',
      enabled: false,
      pollMinutes: cfg.pollMinutes || 1,
      version: cfg.version || 1,
      createdAt: stat.birthtime?.toISOString() || new Date().toISOString(),
      updatedAt: stat.mtime?.toISOString() || new Date().toISOString(),
      imapHost: cfg.imapHost,
      imapPort: cfg.imapPort,
      imapSsl:  cfg.imapSsl,
      smtpHost: cfg.smtpHost,
      smtpPort: cfg.smtpPort,
      smtpSsl:  cfg.smtpSsl,
    });
    added.push(cfg.id);
  }
  if (added.length) writeRegistry(reg);
  return added;
}

function getAgent(id) {
  const agents = listAgents();
  return agents.find(a => a.id === id) || null;
}

function renderTemplate(str, vars) {
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    if (Array.isArray(v)) return JSON.stringify(v);
    return v == null ? '' : String(v);
  });
}

// ─── Versioning ────────────────────────────────────────────────────────────
// Every create/update snapshots the skill folder into .versions/v<N>/.
// Each version is an immutable folder copy of the relevant files.
// .versions/index.json keeps metadata (version, createdAt, reason).

function versionsDir(id)  { return path.join(SKILLS_ROOT, id, '.versions'); }
function versionsIndex(id) { return path.join(versionsDir(id), 'index.json'); }

function readVersionsIndex(id) {
  const p = versionsIndex(id);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

function writeVersionsIndex(id, list) {
  fs.mkdirSync(versionsDir(id), { recursive: true });
  fs.writeFileSync(versionsIndex(id), JSON.stringify(list, null, 2));
}

function nextVersionNumber(id) {
  const idx = readVersionsIndex(id);
  return idx.length === 0 ? 1 : idx[idx.length - 1].version + 1;
}

function snapshotVersion(id, reason = 'edit') {
  const skillDir = path.join(SKILLS_ROOT, id);
  if (!fs.existsSync(skillDir)) return null;
  const v = nextVersionNumber(id);
  const dst = path.join(versionsDir(id), `v${v}`);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of VERSIONABLE_FILES) {
    const src = path.join(skillDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dst, f));
  }
  const meta = {
    version:   v,
    createdAt: new Date().toISOString(),
    reason,
    files:     VERSIONABLE_FILES.filter(f => fs.existsSync(path.join(dst, f))),
  };
  const idx = readVersionsIndex(id);
  idx.push(meta);
  writeVersionsIndex(id, idx);
  return meta;
}

function listVersions(id) {
  return readVersionsIndex(id);
}

function rollbackVersion(id, targetVersion) {
  const skillDir = path.join(SKILLS_ROOT, id);
  const src = path.join(versionsDir(id), `v${targetVersion}`);
  if (!fs.existsSync(src)) throw new Error(`version ${targetVersion} not found for ${id}`);
  // Snapshot current state first as a "pre-rollback" version
  snapshotVersion(id, `pre-rollback-to-v${targetVersion}`);
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(skillDir, f));
  }
  // After rollback re-sync registry from config.json
  const cfgPath = path.join(skillDir, 'config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const reg = readRegistry();
    const i = reg.findIndex(a => a.id === id);
    if (i >= 0) {
      reg[i] = {
        ...reg[i],
        ...cfg,
        version:   nextVersionNumber(id) - 1,  // we just snapshotted
        updatedAt: new Date().toISOString(),
      };
      writeRegistry(reg);
    }
  }
  return snapshotVersion(id, `rollback-to-v${targetVersion}`);
}

// ─── CRUD ──────────────────────────────────────────────────────────────────

async function createAgent(spec) {
  // Auto-provision a mailbox in our docker-mailserver if mailProvider='imap'
  // and the user hasn't explicitly disabled it. Default mailProvider when
  // unspecified: 'imap' if the mail server is reachable, else 'gmail'.
  const mail = require('./mail-server');
  if (!spec.mailProvider) {
    spec.mailProvider = (await mail.isAvailable()) ? 'imap' : 'gmail';
  }
  let provisionedPassword = null;
  if (spec.mailProvider === 'imap' && spec.autoProvisionMailbox !== false) {
    if (!(await mail.isAvailable())) throw new Error('mail server not available — run scripts/setup-mailserver.sh first');
    const email = spec.botEmail && spec.botEmail.includes('@') ? spec.botEmail : mail.suggestEmailFor(spec.id);
    provisionedPassword = require('crypto').randomBytes(16).toString('base64').replace(/[+/=]/g, '');
    try { await mail.addMailbox(email, provisionedPassword); }
    catch (e) {
      // If the mailbox already exists treat as soft-fail and reuse without overwriting password
      if (!/already exists|exists/i.test(e.message)) throw e;
      provisionedPassword = null;
    }
    spec = {
      ...spec,
      botEmail:  email,
      imapHost:  mail.DOMAIN, imapPort: 993, imapSsl: true,
      smtpHost:  mail.DOMAIN, smtpPort: 587, smtpSsl: false,
    };
  }

  const errs = validateSpec(spec);
  if (errs.length) throw new Error(`invalid spec: ${errs.join('; ')}`);

  const reg = readRegistry();
  if (reg.some(a => a.id === spec.id)) throw new Error(`agent '${spec.id}' already exists`);

  const skillDir = path.join(SKILLS_ROOT, spec.id);
  if (fs.existsSync(skillDir)) throw new Error(`skill folder ${skillDir} already exists`);
  fs.mkdirSync(skillDir, { recursive: true });

  // Pick template based on mail provider
  const provider = spec.mailProvider || 'gmail';
  const tplName = provider === 'imap' ? 'email-triage-imap' : 'email-triage';
  const tplDir = path.join(TEMPLATES_ROOT, tplName);
  for (const f of fs.readdirSync(tplDir)) {
    const src = path.join(tplDir, f);
    const dst = path.join(skillDir, f.replace(/\.template$/, ''));
    const raw = fs.readFileSync(src, 'utf8');
    const rendered = renderTemplate(raw, {
      ID:           spec.id,
      NAME:         spec.name,
      DESCRIPTION:  spec.description || '',
      BOT_EMAIL:    spec.botEmail,
      AUTHORIZED_SENDERS: spec.authorizedSenders,
      AUTHORIZED_SENDERS_PYLIST: spec.authorizedSenders.map(s => `    '${s}',`).join('\n'),
      PROJECT_PATH: spec.projectPath || '',
      DEPLOY_HOST:  spec.deployHost  || '',
      DEPLOY_USER:  spec.deployUser  || '',
      DEPLOY_DIR:   spec.deployDir   || '',
      SSH_KEY:      spec.sshKey      || '',
      EXTRA_CONTEXT: spec.extraContext || '',
      VERSION:      'v1',
      PUBLIC_URL:   process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com',
      // IMAP fields (only used by email-triage-imap template)
      IMAP_HOST:    spec.imapHost || (provider === 'imap' ? extractMailHost(spec.botEmail) : ''),
      IMAP_PORT:    spec.imapPort || 993,
      SMTP_HOST:    spec.smtpHost || (provider === 'imap' ? extractMailHost(spec.botEmail) : ''),
      SMTP_PORT:    spec.smtpPort || 587,
    });
    fs.writeFileSync(dst, rendered);
  }

  const cfg = {
    id: spec.id, name: spec.name,
    botEmail: spec.botEmail, authorizedSenders: spec.authorizedSenders,
    projectPath: spec.projectPath, deployHost: spec.deployHost,
    deployUser: spec.deployUser, deployDir: spec.deployDir,
    sshKey: spec.sshKey,
    mailProvider: provider,
    version: 1,
    publicUrl: process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com',
  };
  if (provider === 'imap') {
    cfg.imapHost = spec.imapHost || extractMailHost(spec.botEmail);
    cfg.imapPort = spec.imapPort || 993;
    cfg.imapSsl  = spec.imapSsl  ?? true;
    cfg.smtpHost = spec.smtpHost || extractMailHost(spec.botEmail);
    cfg.smtpPort = spec.smtpPort || 587;
    cfg.smtpSsl  = spec.smtpSsl  ?? false;
  }
  fs.writeFileSync(path.join(skillDir, 'config.json'), JSON.stringify(cfg, null, 2));

  const entry = {
    id: spec.id, name: spec.name,
    description: spec.description || '',
    botEmail: spec.botEmail, authorizedSenders: spec.authorizedSenders,
    projectPath: spec.projectPath, deployHost: spec.deployHost,
    deployUser: spec.deployUser, deployDir: spec.deployDir, sshKey: spec.sshKey,
    mailProvider: provider,
    imapHost: spec.imapHost, imapPort: spec.imapPort, imapSsl: spec.imapSsl,
    smtpHost: spec.smtpHost, smtpPort: spec.smtpPort, smtpSsl: spec.smtpSsl,
    enabled: false,
    pollMinutes: spec.pollMinutes || 1,
    version:   1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  reg.push(entry);
  writeRegistry(reg);

  // Drop the IMAP password into the skill folder (mode 600) so mail_client.py
  // can use it. Never include it in the API response.
  if (provisionedPassword) {
    const credPath = path.join(skillDir, 'imap-credentials.json');
    fs.writeFileSync(credPath, JSON.stringify({ password: provisionedPassword }, null, 2));
    try { fs.chmodSync(credPath, 0o600); } catch {}
  }

  snapshotVersion(spec.id, 'create');
  return entry;
}

function updateAgent(id, patch) {
  const reg = readRegistry();
  const i = reg.findIndex(a => a.id === id);
  if (i < 0) throw new Error(`agent '${id}' not found`);

  const prev = reg[i];
  const newVersion = (prev.version || 1) + 1;
  if (patch.authorizedSenders) patch.authorizedSenders = normalizeSenders(patch.authorizedSenders);
  const next = { ...prev, ...patch, id, version: newVersion, updatedAt: new Date().toISOString() };
  reg[i] = next;
  writeRegistry(reg);

  // Rewrite config.json + re-render SKILL.md (using the right template per provider)
  const skillDir = path.join(SKILLS_ROOT, id);
  if (fs.existsSync(skillDir)) {
    const provider = next.mailProvider || 'gmail';
    const cfg = {
      id: next.id, name: next.name,
      botEmail: next.botEmail, authorizedSenders: next.authorizedSenders,
      projectPath: next.projectPath, deployHost: next.deployHost,
      deployUser: next.deployUser, deployDir: next.deployDir, sshKey: next.sshKey,
      mailProvider: provider,
      version: newVersion,
      spendingLimitMonthly: next.spendingLimitMonthly ?? null,
      publicUrl: process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com',
    };
    if (provider === 'imap') {
      cfg.imapHost = next.imapHost || 'bot.utopiaia.com';
      cfg.imapPort = next.imapPort || 993;
      cfg.imapSsl  = next.imapSsl  ?? true;
      cfg.smtpHost = next.smtpHost || 'bot.utopiaia.com';
      cfg.smtpPort = next.smtpPort || 587;
      cfg.smtpSsl  = next.smtpSsl  ?? false;
    }
    fs.writeFileSync(path.join(skillDir, 'config.json'), JSON.stringify(cfg, null, 2));

    const tplName = provider === 'imap' ? 'email-triage-imap' : 'email-triage';
    const tplPath = path.join(TEMPLATES_ROOT, tplName, 'SKILL.md');
    if (fs.existsSync(tplPath)) {
      const rendered = renderTemplate(fs.readFileSync(tplPath, 'utf8'), {
        ID:           next.id,
        NAME:         next.name,
        DESCRIPTION:  next.description || '',
        BOT_EMAIL:    next.botEmail,
        AUTHORIZED_SENDERS: next.authorizedSenders,
        PROJECT_PATH: next.projectPath || '',
        DEPLOY_HOST:  next.deployHost  || '',
        DEPLOY_USER:  next.deployUser  || '',
        DEPLOY_DIR:   next.deployDir   || '',
        SSH_KEY:      next.sshKey      || '',
        EXTRA_CONTEXT: next.extraContext || '',
        VERSION:      `v${newVersion}`,
        PUBLIC_URL:   process.env.PUBLIC_URL || 'https://clonagent.utopiaia.com',
        IMAP_HOST:    cfg.imapHost || '',
        IMAP_PORT:    cfg.imapPort || '',
        SMTP_HOST:    cfg.smtpHost || '',
        SMTP_PORT:    cfg.smtpPort || '',
      });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), rendered);
    }
  }

  const reason = patch.enabled !== undefined && Object.keys(patch).length === 1
    ? `toggle ${patch.enabled ? 'on' : 'off'}`
    : 'edit';
  snapshotVersion(id, reason);
  return next;
}

async function deleteAgent(id, { removeSkill = false, removeMailbox = false } = {}) {
  const reg = readRegistry();
  const target = reg.find(a => a.id === id);
  if (!target) throw new Error(`agent '${id}' not found`);
  const next = reg.filter(a => a.id !== id);
  writeRegistry(next);

  // Best-effort: remove the docker-mailserver mailbox so the address is freed
  if (removeMailbox && target.mailProvider === 'imap' && target.botEmail) {
    try {
      const mail = require('./mail-server');
      if (await mail.isAvailable()) await mail.deleteMailbox(target.botEmail);
    } catch (e) { /* swallow — best-effort */ }
  }
  if (removeSkill) {
    const skillDir = path.join(SKILLS_ROOT, id);
    if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
  }
}

function readSkillFile(id, file) {
  const p = path.join(SKILLS_ROOT, id, file);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function writeSkillFile(id, file, content) {
  const skillDir = path.join(SKILLS_ROOT, id);
  if (!fs.existsSync(skillDir)) throw new Error(`skill ${id} does not exist`);
  fs.writeFileSync(path.join(skillDir, file), content);
  if (VERSIONABLE_FILES.includes(file)) snapshotVersion(id, `manual-edit:${file}`);
}

function extractMailHost(email) {
  const dom = (email || '').split('@')[1] || '';
  return dom ? `mail.${dom}` : '';
}

// Sender roles:
//   owner     — created the agent. Can edit behavior, add/remove senders, delete.
//   cocreator — can edit behavior (rulebooks, config, deploys) but not sender list.
//   reader    — can only use the agent's skills via email; agent rejects any
//               request that would modify its behavior or configuration.
const ROLES = ['owner', 'cocreator', 'reader'];

function normalizeSenders(senders) {
  if (!Array.isArray(senders)) return [];
  return senders.map((s, i) => {
    if (typeof s === 'string') return { email: s.toLowerCase(), role: i === 0 ? 'owner' : 'reader' };
    if (s && typeof s === 'object' && s.email) {
      const role = ROLES.includes(s.role) ? s.role : 'reader';
      return { email: String(s.email).toLowerCase(), role };
    }
    return null;
  }).filter(Boolean);
}

function validateSpec(s) {
  const e = [];
  if (!s.id || !/^[a-z0-9-]+$/.test(s.id)) e.push('id must be lowercase-kebab');
  if (!s.name) e.push('name required');
  if (!s.botEmail || !/.+@.+/.test(s.botEmail)) e.push('botEmail invalid');
  const senders = normalizeSenders(s.authorizedSenders);
  if (senders.length === 0) e.push('authorizedSenders must be a non-empty array');
  s.authorizedSenders = senders;            // mutate to canonical form
  return e;
}

module.exports = {
  SKILLS_ROOT,
  listAgents, getAgent, createAgent, updateAgent, deleteAgent,
  readSkillFile, writeSkillFile, validateSpec,
  listVersions, rollbackVersion, snapshotVersion,
  discoverAgents, repairConfigs, refreshSkillScripts,
};

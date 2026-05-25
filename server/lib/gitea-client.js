// Wrapper around the local Gitea API. Used by the chat to:
//   - check whether a repo exists
//   - list repos (so the user can pick an existing one)
//   - create a new repo for a brand-new project
const settings = require('../routes/settings');

function cfg() {
  const s  = settings.read().integrations || {};
  return {
    url:   s.giteaUrl   || process.env.GITEA_URL_INTERNAL || 'http://localhost:3200',
    token: s.giteaToken || process.env.GITEA_TOKEN        || '',
    user:  s.giteaUser  || process.env.GITEA_ADMIN_USER   || '',
  };
}

function headers() {
  const c = cfg();
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (c.token) h['Authorization'] = `token ${c.token}`;
  return h;
}

async function status() {
  const c = cfg();
  if (!c.url) return { available: false, error: 'no Gitea URL configured' };
  try {
    const r = await fetch(`${c.url}/api/v1/version`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { available: false, error: `HTTP ${r.status}` };
    const j = await r.json();
    return { available: true, url: c.url, version: j.version, hasToken: !!c.token, user: c.user };
  } catch (e) { return { available: false, error: e.message }; }
}

async function listRepos() {
  const c = cfg();
  if (!c.token) throw new Error('Gitea token not configured (Settings → Integrations)');
  const r = await fetch(`${c.url}/api/v1/repos/search?limit=50`, { headers: headers() });
  if (!r.ok) throw new Error(`gitea ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return (j.data || []).map(repo => ({
    full_name: repo.full_name,
    name:      repo.name,
    owner:     repo.owner?.login,
    description: repo.description,
    private:   repo.private,
    clone_url: repo.clone_url,
    ssh_url:   repo.ssh_url,
    html_url:  repo.html_url,
    updated_at: repo.updated_at,
  }));
}

async function repoExists(fullName) {
  const c = cfg();
  const r = await fetch(`${c.url}/api/v1/repos/${fullName}`, { headers: headers() });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`gitea ${r.status}`);
  return true;
}

async function createRepo({ name, owner, description = '', private: priv = false, autoInit = true, defaultBranch = 'main' }) {
  const c = cfg();
  if (!c.token) throw new Error('Gitea token not configured (Settings → Integrations)');
  const targetOwner = owner || c.user;
  // POST /user/repos creates under the authenticated user; /orgs/{org}/repos creates under an org.
  const url = targetOwner === c.user
    ? `${c.url}/api/v1/user/repos`
    : `${c.url}/api/v1/orgs/${targetOwner}/repos`;
  const r = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ name, description, private: priv, auto_init: autoInit, default_branch: defaultBranch }),
  });
  if (!r.ok) throw new Error(`gitea ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return {
    full_name: j.full_name,
    clone_url: j.clone_url,
    ssh_url:   j.ssh_url,
    html_url:  j.html_url,
  };
}

module.exports = { cfg, status, listRepos, repoExists, createRepo };

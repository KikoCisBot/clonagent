// Curated registry of common MCP (Model Context Protocol) servers that
// agents can be equipped with from the chat builder. Each entry is a
// template — the user supplies the secrets/config; ClonAgent merges them
// into the agent's mcp.json which Claude Code loads on launch.
//
// Structure of an MCP server entry:
//   {
//     name:        machine name (string, used as key in mcp.json)
//     label:       human label
//     category:    'git' | 'docs' | 'comms' | 'data' | 'cloud' | 'ops' | 'custom'
//     description: 1-line description
//     command:     CLI command to spawn the server
//     args:        argv array (with optional ${VAR} placeholders)
//     env:         env vars expected (with optional ${VAR} placeholders)
//     fields:      [{key, label, secret, required, placeholder}] — UI form
//     docs:        URL to docs (optional)
//   }
const REGISTRY = [
  // ── Git / Code ─────────────────────────────────────────────────────────
  {
    name: 'github',
    label: 'GitHub',
    category: 'git',
    description: 'Issues, PRs, commits, code search, CI runs.',
    command: 'docker',
    args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' },
    fields: [
      { key: 'GITHUB_TOKEN', label: 'GitHub PAT', secret: true, required: true,
        placeholder: 'ghp_…', help: 'Crea en https://github.com/settings/tokens (scopes: repo, read:org)' },
    ],
    docs: 'https://github.com/github/github-mcp-server',
  },
  {
    name: 'gitlab',
    label: 'GitLab',
    category: 'git',
    description: 'Repos, MRs, issues, pipelines en GitLab.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    env: { GITLAB_PERSONAL_ACCESS_TOKEN: '${GITLAB_TOKEN}', GITLAB_API_URL: '${GITLAB_URL}' },
    fields: [
      { key: 'GITLAB_TOKEN', label: 'GitLab PAT', secret: true, required: true },
      { key: 'GITLAB_URL', label: 'GitLab URL', placeholder: 'https://gitlab.com/api/v4' },
    ],
  },
  {
    name: 'bitbucket',
    label: 'Bitbucket',
    category: 'git',
    description: 'Bitbucket Cloud / Server (repos, PRs, issues).',
    command: 'npx',
    args: ['-y', 'mcp-bitbucket'],
    env: { BITBUCKET_USERNAME: '${BB_USER}', BITBUCKET_APP_PASSWORD: '${BB_APP_PASSWORD}' },
    fields: [
      { key: 'BB_USER',         label: 'Bitbucket username', required: true },
      { key: 'BB_APP_PASSWORD', label: 'App password',       secret: true, required: true,
        help: 'Genera en https://bitbucket.org/account/settings/app-passwords/' },
    ],
  },
  {
    name: 'gitea',
    label: 'Gitea',
    category: 'git',
    description: 'Self-hosted Gitea (repos, issues, PRs).',
    command: 'npx',
    args: ['-y', 'mcp-gitea'],
    env: { GITEA_URL: '${GITEA_URL}', GITEA_TOKEN: '${GITEA_TOKEN}' },
    fields: [
      { key: 'GITEA_URL',   label: 'Gitea URL', placeholder: 'https://gitea.utopiaia.com' },
      { key: 'GITEA_TOKEN', label: 'Token',     secret: true, required: true },
    ],
  },

  // ── Comms ──────────────────────────────────────────────────────────────
  {
    name: 'slack',
    label: 'Slack',
    category: 'comms',
    description: 'Leer/enviar mensajes, listar canales y usuarios.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}', SLACK_TEAM_ID: '${SLACK_TEAM_ID}' },
    fields: [
      { key: 'SLACK_BOT_TOKEN', label: 'Bot token (xoxb-…)', secret: true, required: true },
      { key: 'SLACK_TEAM_ID',   label: 'Team ID',             required: true },
    ],
  },
  {
    name: 'teams',
    label: 'Microsoft Teams',
    category: 'comms',
    description: 'Mensajes y canales de MS Teams via Graph API.',
    command: 'npx',
    args: ['-y', 'mcp-teams'],
    env: { MS_TENANT_ID: '${MS_TENANT}', MS_CLIENT_ID: '${MS_CLIENT_ID}', MS_CLIENT_SECRET: '${MS_CLIENT_SECRET}' },
    fields: [
      { key: 'MS_TENANT',        label: 'Tenant ID',     required: true },
      { key: 'MS_CLIENT_ID',     label: 'App client ID', required: true },
      { key: 'MS_CLIENT_SECRET', label: 'Client secret', secret: true, required: true },
    ],
  },

  // ── Project tracking ────────────────────────────────────────────────────
  {
    name: 'jira',
    label: 'Jira',
    category: 'docs',
    description: 'Issues, sprints, comentarios, transiciones.',
    command: 'npx',
    args: ['-y', 'mcp-atlassian'],
    env: {
      ATLASSIAN_HOST: '${JIRA_HOST}',
      ATLASSIAN_EMAIL: '${JIRA_EMAIL}',
      ATLASSIAN_API_TOKEN: '${JIRA_TOKEN}',
    },
    fields: [
      { key: 'JIRA_HOST',  label: 'Host', placeholder: 'tuempresa.atlassian.net', required: true },
      { key: 'JIRA_EMAIL', label: 'Email',                                         required: true },
      { key: 'JIRA_TOKEN', label: 'API token', secret: true, required: true,
        help: 'https://id.atlassian.com/manage-profile/security/api-tokens' },
    ],
  },
  {
    name: 'azure-devops',
    label: 'Azure DevOps',
    category: 'docs',
    description: 'Repos, work items, builds, pipelines en Azure DevOps.',
    command: 'npx',
    args: ['-y', 'mcp-azure-devops'],
    env: { AZDO_ORG_URL: '${AZDO_ORG}', AZDO_PAT: '${AZDO_PAT}' },
    fields: [
      { key: 'AZDO_ORG', label: 'Org URL', placeholder: 'https://dev.azure.com/tuorg', required: true },
      { key: 'AZDO_PAT', label: 'Personal Access Token', secret: true, required: true },
    ],
  },
  {
    name: 'linear',
    label: 'Linear',
    category: 'docs',
    description: 'Issues y proyectos en Linear.',
    command: 'npx',
    args: ['-y', 'mcp-linear'],
    env: { LINEAR_API_KEY: '${LINEAR_KEY}' },
    fields: [
      { key: 'LINEAR_KEY', label: 'API key', secret: true, required: true },
    ],
  },
  {
    name: 'notion',
    label: 'Notion',
    category: 'docs',
    description: 'Lectura/escritura de páginas y databases en Notion.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-notion'],
    env: { NOTION_API_KEY: '${NOTION_KEY}' },
    fields: [
      { key: 'NOTION_KEY', label: 'Internal integration token', secret: true, required: true },
    ],
  },

  // ── Data ────────────────────────────────────────────────────────────────
  {
    name: 'postgres',
    label: 'PostgreSQL',
    category: 'data',
    description: 'Consulta SQL read-only sobre una base de datos PostgreSQL.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '${PG_URL}'],
    env: {},
    fields: [
      { key: 'PG_URL', label: 'Connection URL', secret: true, required: true,
        placeholder: 'postgresql://user:pass@host:5432/db' },
    ],
  },
  {
    name: 'sqlite',
    label: 'SQLite',
    category: 'data',
    description: 'Lectura de bases de datos SQLite locales.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '${DB_PATH}'],
    env: {},
    fields: [
      { key: 'DB_PATH', label: 'Path al .db', placeholder: '/path/to/data.db', required: true },
    ],
  },
  {
    name: 'elasticsearch',
    label: 'Elasticsearch / OpenSearch',
    category: 'data',
    description: 'Búsqueda en índices ES / OpenSearch (read-only).',
    command: 'npx',
    args: ['-y', '@elastic/mcp-server-elasticsearch'],
    env: { ELASTICSEARCH_URL: '${ES_URL}', ELASTICSEARCH_API_KEY: '${ES_KEY}' },
    fields: [
      { key: 'ES_URL', label: 'URL', placeholder: 'http://localhost:9200', required: true },
      { key: 'ES_KEY', label: 'API key (opcional)', secret: true },
    ],
  },

  // ── Cloud / Ops ─────────────────────────────────────────────────────────
  {
    name: 'kubernetes',
    label: 'Kubernetes',
    category: 'ops',
    description: 'Pods, events, logs, describe (lectura).',
    command: 'docker',
    args: ['run', '-i', '--rm', '-v', '${KUBECONFIG}:/root/.kube/config', 'ghcr.io/manusa/kubernetes-mcp-server:latest'],
    env: {},
    fields: [
      { key: 'KUBECONFIG', label: 'Path al kubeconfig', placeholder: '~/.kube/config', required: true },
    ],
  },
  {
    name: 'aws',
    label: 'AWS',
    category: 'cloud',
    description: 'API de AWS (S3, EC2, CloudWatch…) usando credenciales locales.',
    command: 'npx',
    args: ['-y', 'mcp-aws'],
    env: { AWS_PROFILE: '${AWS_PROFILE}', AWS_REGION: '${AWS_REGION}' },
    fields: [
      { key: 'AWS_PROFILE', label: 'AWS profile', placeholder: 'default' },
      { key: 'AWS_REGION',  label: 'Región',      placeholder: 'eu-west-1' },
    ],
  },

  // ── Filesystem ──────────────────────────────────────────────────────────
  {
    name: 'filesystem',
    label: 'Filesystem',
    category: 'data',
    description: 'Acceso a una carpeta local (lectura/escritura).',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '${ROOT_PATH}'],
    env: {},
    fields: [
      { key: 'ROOT_PATH', label: 'Carpeta raíz', placeholder: '/home/ubuntu/projects', required: true },
    ],
  },

  // ── Web search ──────────────────────────────────────────────────────────
  {
    name: 'brave-search',
    label: 'Brave Search',
    category: 'docs',
    description: 'Búsqueda web vía Brave Search API.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '${BRAVE_KEY}' },
    fields: [
      { key: 'BRAVE_KEY', label: 'API key', secret: true, required: true },
    ],
  },
];

function listRegistry() {
  return REGISTRY.map(({ command, args, env, ...meta }) => meta);
}

function getEntry(name) {
  return REGISTRY.find(e => e.name === name) || null;
}

function buildServerConfig(name, values = {}) {
  const e = getEntry(name);
  if (!e) throw new Error(`unknown MCP server '${name}'`);
  function expand(s) {
    if (typeof s !== 'string') return s;
    return s.replace(/\$\{(\w+)\}/g, (_, k) => values[k] ?? '');
  }
  return {
    command: e.command,
    args: (e.args || []).map(expand),
    env:  Object.fromEntries(Object.entries(e.env || {}).map(([k, v]) => [k, expand(v)])),
  };
}

module.exports = { listRegistry, getEntry, buildServerConfig };

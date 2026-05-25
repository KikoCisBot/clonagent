// Read/write per-agent MCP config (mcp.json) under ~/.claude/skills/<id>/mcp.json
// Format matches Claude Code's expected mcp.json:
//   { "mcpServers": { "<name>": { "command": "...", "args": [...], "env": {...} } } }
const fs = require('fs');
const path = require('path');
const { SKILLS_ROOT } = require('./skill-fs');
const { buildServerConfig } = require('./mcp-registry');

function mcpPath(agentId) {
  return path.join(SKILLS_ROOT, agentId, 'mcp.json');
}

function readMcp(agentId) {
  const p = mcpPath(agentId);
  if (!fs.existsSync(p)) return { mcpServers: {} };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { mcpServers: {} }; }
}

function writeMcp(agentId, mcp) {
  const skillDir = path.join(SKILLS_ROOT, agentId);
  if (!fs.existsSync(skillDir)) throw new Error(`skill ${agentId} does not exist`);
  fs.writeFileSync(mcpPath(agentId), JSON.stringify(mcp, null, 2));
}

function listAgentServers(agentId) {
  const cfg = readMcp(agentId);
  return Object.keys(cfg.mcpServers || {});
}

function addServer(agentId, registryName, values) {
  const built = buildServerConfig(registryName, values);
  const cfg = readMcp(agentId);
  cfg.mcpServers = cfg.mcpServers || {};
  cfg.mcpServers[registryName] = built;
  writeMcp(agentId, cfg);
  return cfg.mcpServers[registryName];
}

function removeServer(agentId, name) {
  const cfg = readMcp(agentId);
  if (cfg.mcpServers) delete cfg.mcpServers[name];
  writeMcp(agentId, cfg);
}

module.exports = { mcpPath, readMcp, writeMcp, listAgentServers, addServer, removeServer };

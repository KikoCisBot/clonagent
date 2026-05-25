// Chat backend — talks to LiteLLM/relay via OpenAI-compatible /v1/chat/completions.
// Per-user override: if the calling user has settings.anthropicApiKey or
// settings.relayKey configured, those are used instead of the system defaults.
const OpenAI = require('openai');
const settings = require('../routes/settings');
const users    = require('./users');

function resolveCreds(userSub) {
  const sys = settings.read();
  const userSettings = userSub ? users.getUserSettings(userSub) : {};
  const baseURL = (userSettings.relayUrl || sys.relayUrl || 'http://localhost:3201').replace(/\/$/, '') + '/v1';
  // Priority for the API key:
  //   1. user's anthropicApiKey (real Anthropic key — bypass relay)
  //   2. user's relayKey       (their token for the shared relay)
  //   3. system relayKey
  let apiKey = userSettings.anthropicApiKey || userSettings.relayKey || sys.relayKey || process.env.LITELLM_MASTER_KEY;
  let actualBaseURL = baseURL;
  if (userSettings.anthropicApiKey) {
    actualBaseURL = (userSettings.anthropicBaseUrl || 'https://api.anthropic.com').replace(/\/$/, '') + '/v1';
  }
  const model = userSettings.model || sys.model || 'claude-opus-4-7';
  if (!apiKey) throw new Error('No API key configured. Set one in Settings → Mi cuenta.');
  return { apiKey, baseURL: actualBaseURL, model };
}

async function chat({ system, messages, tools, userSub, toolChoice }) {
  const { apiKey, baseURL, model } = resolveCreds(userSub);
  const client = new OpenAI({ apiKey, baseURL });
  const fullMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;
  const useTools = tools && tools.length && toolChoice !== 'none';
  return client.chat.completions.create({
    model,
    max_tokens: 2048,
    messages: fullMessages,
    tools: useTools ? tools : undefined,
    tool_choice: useTools ? (toolChoice || 'auto') : undefined,
  });
}

module.exports = { chat };

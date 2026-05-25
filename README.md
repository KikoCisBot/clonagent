# ClonAgent

Builds and manages **email-triage agents** — Claude Code skills that watch a Gmail
inbox, fix bugs reported by authorized senders, deploy the fix, and reply to the
thread. Each "ClonAgent" is a clone of [`premeti-email-triage`](../../.claude/skills/premeti-email-triage/)
with its own inbox, sender list, project path and deployment target.

## What you get

- **Chat** — talk to the builder in natural language to create/edit agents
- **Dashboard** — live view of agents and recent runs
- **Agents** — list, edit authorized senders, toggle on/off, run manually
- **AgentHub** — live feed of every Claude Code session (assistant turns +
  tool calls + tool results), like the Activity page in agent-manager

## Architecture

```
                ┌─── ClonAgent (this) ───┐
Browser ── UI ──▶  client (Vite/React)   │
                │  server (Express)      │
                │  ├── /api/chat         │── Anthropic / LiteLLM
                │  ├── /api/agents       │── ~/.claude/skills/<id>/
                │  ├── /api/runs         │
                │  ├── /api/activity     │◀── host-relay POSTs events
                │  └── gmail-poller (1m) │── python3 gmail_client.py
                └────────────┬───────────┘
                             │
                             ▼ launchAgent()
                ┌── host-relay (agent-manager) ──┐
                │   spawns Claude CLI session    │
                │   with skill <id> loaded       │
                └────────────────────────────────┘
```

## Setup

```bash
cd clonagent
cp .env.example .env  # fill in ANTHROPIC_API_KEY (or LITELLM_* vars)

# Server
cd server && npm install && cd ..

# Client
cd client && npm install && cd ..

# Run dev (two terminals)
( cd server && npm run dev )           # → http://localhost:3300
( cd client && npm run dev )           # → http://localhost:3301
```

For production: `docker compose up -d` (builds client + serves it from server).

## Reusing the host-relay

ClonAgent does **not** spawn its own Claude CLI sessions; it delegates to the
host-relay that already lives in [`agent-manager/scripts/host-relay.js`](../agent-manager/scripts/host-relay.js).

Make sure the relay is running on the host:
```bash
cd ../agent-manager && node scripts/host-relay.js
```

If you want the AgentHub view to receive live events from the relay, run a
second relay instance pointing back to ClonAgent:
```bash
RELAY_PORT=3202 CONSOLE_URL=http://localhost:3300 \
  node ../agent-manager/scripts/host-relay.js
```
And set `AGENT_RELAY_URL=http://localhost:3202` in `.env`.

## Creating your first agent

1. Open http://localhost:3301 → **Chat**
2. Tell it what you want, e.g.:
   > Crea un agente para los bugs de MIA. El bot es `miabot@gmail.com`. Solo
   > carlos@miacompany.com puede reportar. Repo en `/Users/kiko/work2026/MIA`,
   > despliegue en `145.239.65.26` con la SSH key `~/.ssh/id_ed25519_kikocisbot`.
3. The chat will confirm, then create the skill at `~/.claude/skills/mia-email-triage/`.
4. Drop your `credentials.json` (Gmail OAuth client) into that folder.
5. Run the OAuth flow once:
   ```bash
   cd ~/.claude/skills/mia-email-triage
   python3 gmail_client.py auth
   ```
6. Back in **Agents**, flip the toggle to enable it. Polling starts every minute.

## Notes

- Skills are stored in `~/.claude/skills/<id>/` so Claude Code on the host can
  invoke them directly via `/<id>` in any project.
- `config.json` inside each skill is the **single source of truth** for the
  authorized senders list — edit it from the UI or by hand, the Python client
  re-reads it on every invocation.
- Sensitive files (`credentials.json`, `token.json`, `imap-credentials.json`)
  are never exposed via the API — manage them by hand in the skill folder.

## Optional: own mail server (one mailbox per agent)

ClonAgent ships with an optional `docker-mailserver` integration so each agent
can have its own mailbox at `<agent-id>@bot.utopiaia.com` (or any subdomain
you pick), without touching your existing corporate Outlook / Gmail.

### One-time setup on the host

```bash
ssh ubuntu@145.239.65.26
cd /home/ubuntu/clonagent
MAIL_DOMAIN=bot.utopiaia.com ./scripts/setup-mailserver.sh
```

The script:
1. Adds `bot IN A` and `bot IN MX 10 bot.utopiaia.com.` to the CoreDNS zone
2. Runs `certbot` to issue a TLS cert for `bot.utopiaia.com`
3. `docker compose -f docker-compose.mail.yml up -d` to start `mailserver`
4. Generates DKIM keys
5. Prints the SPF / DKIM / DMARC TXT records you must append to the zone:
   ```
   bot              IN  TXT  "v=spf1 mx ~all"
   mail._domainkey.bot  IN  TXT  "v=DKIM1; k=rsa; p=…"
   _dmarc.bot       IN  TXT  "v=DMARC1; p=quarantine; rua=mailto:postmaster@bot.utopiaia.com"
   ```
6. Bumps the zone serial and restarts CoreDNS

After this the **Mail** page in the UI is functional — list / create / delete
mailboxes from the browser, or via the chat (`provision_mailbox` tool).

### Per-agent mail

When you create an agent in the chat:
- *"crea un agente con mailProvider imap, dale un buzón en bot.utopiaia.com"*
  → the chat calls `provision_mailbox` to create `<agent-id>@bot.utopiaia.com`,
    then `save_agent` with `mailProvider: 'imap'`.
- The skill is rendered from `templates/email-triage-imap/` (uses
  `mail_client.py` instead of `gmail_client.py`).
- The IMAP password lives in `~/.claude/skills/<id>/imap-credentials.json`
  (mode 600); `config.json` only stores host/port/email.

### Adding a new mailbox by hand

```bash
docker exec mailserver setup email add bug@bot.utopiaia.com 'pa$$w0rd'
docker exec mailserver setup email del bug@bot.utopiaia.com
docker exec mailserver setup email list
```

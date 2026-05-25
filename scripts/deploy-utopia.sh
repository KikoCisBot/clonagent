#!/usr/bin/env bash
# Deploys ClonAgent to utopiaia.com (145.239.65.26)
# Usage: SSH_KEY=~/.ssh/id_xxx ./scripts/deploy-utopia.sh
set -euo pipefail

HOST="${HOST:-145.239.65.26}"
USER="${USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_kikocisbot}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/clonagent}"
SUBDOMAIN="${SUBDOMAIN:-clonagent.utopiaia.com}"
ANTHROPIC_KEY="${ANTHROPIC_API_KEY:-${ANTHROPIC_KEY:-}}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "→ project: $PROJECT_ROOT"
echo "→ remote:  $USER@$HOST:$REMOTE_DIR"
echo "→ domain:  https://$SUBDOMAIN"

SSH() { ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$USER@$HOST" "$@"; }
SCP() { scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$@"; }

# 1. Build the client locally so we don't need npm on the server
echo "→ building client..."
( cd "$PROJECT_ROOT/client" && npm install --no-audit --no-fund --silent && npm run build )

# 2. Tar up everything except node_modules
echo "→ packaging..."
TARBALL="/tmp/clonagent-$(date +%s).tgz"
tar --exclude='node_modules' --exclude='.git' --exclude='client/dist/.vite' \
    --exclude='server/data' --exclude='mail' \
    -czf "$TARBALL" -C "$PROJECT_ROOT" .

# 3. Ship it
echo "→ uploading..."
SSH "mkdir -p $REMOTE_DIR"
SCP "$TARBALL" "$USER@$HOST:/tmp/clonagent.tgz"
SSH "tar -xzf /tmp/clonagent.tgz -C $REMOTE_DIR && rm /tmp/clonagent.tgz"
rm "$TARBALL"

# 4. Write .env on the server
echo "→ writing .env..."
SSH "cat > $REMOTE_DIR/.env <<EOF
ANTHROPIC_API_KEY=$ANTHROPIC_KEY
PORT=3300
AGENT_RELAY_URL=http://host.docker.internal:3201
EOF"

# 5. Install server deps on the server (Node already there from agent-manager)
echo "→ installing server deps on server..."
SSH "cd $REMOTE_DIR/server && npm install --omit=dev --no-audit --no-fund"

# 6. Systemd unit
echo "→ installing systemd unit..."
SSH "sudo tee /etc/systemd/system/clonagent.service >/dev/null <<'EOF'
[Unit]
Description=ClonAgent server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/clonagent/server
EnvironmentFile=/home/ubuntu/clonagent/.env
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF"
SSH "sudo systemctl daemon-reload && sudo systemctl enable --now clonagent && sleep 2 && sudo systemctl status clonagent --no-pager | head -10"

# 7. Nginx subdomain (HTTP only — TLS via existing acme/letsencrypt setup)
echo "→ adding nginx config..."
SSH "sudo tee /etc/nginx/sites-available/clonagent >/dev/null <<'EOF'
server {
    listen 80;
    server_name $SUBDOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3300;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_buffering off;       # SSE streams
        proxy_read_timeout 3600s;  # SSE long connections
    }
}
EOF"
SSH "sudo ln -sf /etc/nginx/sites-available/clonagent /etc/nginx/sites-enabled/clonagent && sudo nginx -t && sudo systemctl reload nginx"

# 8. Smoke test
echo "→ smoke test..."
SSH "curl -sf http://localhost:3300/api/health" && echo
echo "✅ Done. Open https://$SUBDOMAIN"
echo "   (DNS already wildcard-resolves *.utopiaia.com → 145.239.65.26)"

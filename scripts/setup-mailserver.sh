#!/usr/bin/env bash
#
# One-shot setup for ClonAgent's optional mail server.
#
# Prepares:
#   1. DNS records (A, MX) on the subdomain
#   2. Issues a Let's Encrypt cert for the mail hostname (so STARTTLS works)
#   3. Brings up docker-mailserver
#   4. Generates DKIM keys
#   5. Prints the DKIM/SPF/DMARC TXT records you must add to the DNS zone
#
# Run on the host (as a user with sudo + docker access):
#   MAIL_DOMAIN=bot.utopiaia.com  ./scripts/setup-mailserver.sh
#
set -euo pipefail

MAIL_DOMAIN="${MAIL_DOMAIN:-bot.utopiaia.com}"
MAIL_HOSTNAME="${MAIL_HOSTNAME:-$MAIL_DOMAIN}"
PARENT_ZONE="${PARENT_ZONE:-utopiaia.com}"
# CoreDNS reads from project-manager (legacy path); fall back to agent-manager.
ZONE_FILE="${ZONE_FILE:-/home/ubuntu/project-manager/dns/zones/${PARENT_ZONE}.zone}"
[[ -f "$ZONE_FILE" ]] || ZONE_FILE="/home/ubuntu/agent-manager/dns/zones/${PARENT_ZONE}.zone"
SERVER_IP="${SERVER_IP:-145.239.65.26}"
LE_EMAIL="${LE_EMAIL:-admin@${PARENT_ZONE}}"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.mail.yml}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Subdomain part — bot.utopiaia.com → "bot"
SUB="${MAIL_DOMAIN%.${PARENT_ZONE}}"

say() { printf "\n\033[1;36m→ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$*" >&2; }

# ── 1. DNS records ────────────────────────────────────────────────────────
say "1. DNS records in $ZONE_FILE"
if [[ ! -f "$ZONE_FILE" ]]; then
  warn "Zone file not found at $ZONE_FILE — skipping (edit DNS by hand)."
else
  if grep -qE "^${SUB}\\s+IN\\s+A\\s+${SERVER_IP}" "$ZONE_FILE"; then
    say "   A record already present — skipping."
  else
    sudo cp "$ZONE_FILE" "${ZONE_FILE}.bak.$(date +%Y%m%d%H%M%S)"
    sudo bash -c "cat >> '$ZONE_FILE' <<EOF

; ─── ClonAgent mail server (added by setup-mailserver.sh) ───
${SUB}        IN  A     ${SERVER_IP}
${SUB}        IN  MX    10 ${MAIL_HOSTNAME}.
EOF"
    # bump zone serial (YYYYMMDDNN format → +1)
    sudo sed -i -E "s/([0-9]{10}) ; serial.*/\$(date +%Y%m%d)01 ; serial (bumped by setup-mailserver.sh)/" "$ZONE_FILE" || true
    say "   Added A + MX records."
    if docker ps --format '{{.Names}}' | grep -q '^coredns$'; then
      docker restart coredns >/dev/null && say "   Restarted CoreDNS."
    fi
  fi
fi

# ── 2. Let's Encrypt cert for mail hostname ───────────────────────────────
say "2. TLS cert for $MAIL_HOSTNAME"
if [[ -d "/etc/letsencrypt/live/$MAIL_HOSTNAME" ]]; then
  say "   Cert already exists."
else
  if command -v certbot >/dev/null; then
    sudo certbot certonly --nginx -d "$MAIL_HOSTNAME" --non-interactive --agree-tos --email "$LE_EMAIL" || \
      warn "certbot failed — run manually: sudo certbot certonly --nginx -d $MAIL_HOSTNAME"
  else
    warn "certbot not installed — install with: sudo apt-get install -y certbot python3-certbot-nginx"
  fi
fi

# ── 3. Bring up docker-mailserver ─────────────────────────────────────────
say "3. Bringing up docker-mailserver"
mkdir -p mail/mail-data mail/mail-state mail/mail-logs mail/config
MAIL_DOMAIN="$MAIL_DOMAIN" MAIL_HOSTNAME="$MAIL_HOSTNAME" $COMPOSE up -d
sleep 5

# ── 4. Generate DKIM keys ──────────────────────────────────────────────────
say "4. Generating DKIM keys"
docker exec mailserver setup config dkim domain "$MAIL_DOMAIN" || warn "DKIM setup failed — try again after the container has stabilized."

# ── 5. Print the TXT records you must add to the DNS zone ──────────────────
say "5. TXT records for SPF, DKIM, DMARC — append these to $ZONE_FILE"
echo
echo "; ── SPF (sender policy) ──"
echo "${SUB}              IN  TXT  \"v=spf1 mx ~all\""
echo
echo "; ── DKIM ──"
DKIM_FILE="mail/config/opendkim/keys/${MAIL_DOMAIN}/mail.txt"
if [[ -f "$DKIM_FILE" ]]; then
  cat "$DKIM_FILE"
else
  warn "DKIM key file not found yet ($DKIM_FILE). Re-run after the mailserver is fully up:"
  echo "   docker exec mailserver setup config dkim domain $MAIL_DOMAIN"
fi
echo
echo "; ── DMARC ──"
echo "_dmarc.${SUB}     IN  TXT  \"v=DMARC1; p=quarantine; rua=mailto:postmaster@${MAIL_DOMAIN}\""
echo
say "Add the three TXT records above to $ZONE_FILE, bump the serial, and restart coredns."

# ── 6. Test mailbox ───────────────────────────────────────────────────────
say "6. Creating a test mailbox: postmaster@${MAIL_DOMAIN}"
docker exec mailserver setup email add "postmaster@${MAIL_DOMAIN}" "$(openssl rand -base64 16)" || warn "Mailbox creation failed — run manually."

echo
say "Done. ClonAgent's UI (Mail page) can now provision per-agent mailboxes."

#!/usr/bin/env bash
# nginx + Let's Encrypt pour CONDUCTOR sur Vultr.
# Usage (sur le VPS, en root ou sudo) :
#   curl -fsSL .../setup-https-vultr.sh | bash
#   ou : bash scripts/setup-https-vultr.sh [domaine]
#
# Sans domaine custom : utilise sslip.io (ex. 78-141-244-231.sslip.io → ton IP).
set -euo pipefail

PORT="${CONDUCTOR_PORT:-3000}"
IP="$(curl -fsSL -4 --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
DOMAIN="${1:-${CONDUCTOR_DOMAIN:-}}"
if [[ -z "$DOMAIN" && -n "$IP" ]]; then
  DOMAIN="${IP//./-}.sslip.io"
fi
EMAIL="${CONDUCTOR_LE_EMAIL:-admin@${DOMAIN}}"

if [[ -z "$DOMAIN" ]]; then
  echo "❌ Impossible de déduire le domaine. Usage: $0 mon-domaine.com"
  exit 1
fi

echo "→ Domaine : $DOMAIN"
echo "→ Backend : 127.0.0.1:${PORT}"
echo "→ Email LE : $EMAIL"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx

cat > "/etc/nginx/sites-available/conductor" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/conductor /etc/nginx/sites-enabled/conductor
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx

if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH || true
  ufw allow 'Nginx Full' || ufw allow 80/tcp && ufw allow 443/tcp
  ufw --force enable || true
fi

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo ""
echo "✅ HTTPS prêt"
echo "   PWA : https://${DOMAIN}/"
echo "   Health : https://${DOMAIN}/health"
echo ""
echo "Vérifie : curl -s https://${DOMAIN}/health"

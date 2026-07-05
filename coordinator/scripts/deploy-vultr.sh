#!/usr/bin/env bash
# Sync CONDUCTOR to Vultr and restart pm2.
# Prereq: SSH key to root@VULTR_IP (see add-ssh-vultr.sh).
#
# Usage (from repo root):
#   bash coordinator/scripts/deploy-vultr.sh
#   VULTR_IP=78.141.244.231 bash coordinator/scripts/deploy-vultr.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IP="${VULTR_IP:-78.141.244.231}"
REMOTE="${VULTR_REMOTE:-/opt/conductor}"
DOMAIN="${VULTR_DOMAIN:-${IP//./-}.sslip.io}"

echo "→ Build simulateur 3D"
(cd "$ROOT/simulator" && npm install --silent && npm run build)

echo "→ Sync $ROOT → root@${IP}:${REMOTE}"
rsync -az --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude '*/node_modules' \
  --exclude coordinator/.env \
  --exclude coordinator/tts-cache \
  --exclude coordinator/logs \
  --exclude coordinator/data/*.sqlite \
  --exclude .cache_ggshield \
  "$ROOT/" "root@${IP}:${REMOTE}/"

echo "→ Install deps + restart on VPS"
ssh "root@${IP}" bash -s <<REMOTE_EOF
set -euo pipefail
cd ${REMOTE}/coordinator
npm install --omit=dev --silent
if [[ -f .env ]]; then
  if grep -q '^CRUSOE_MODEL=' .env; then
    sed -i 's|^CRUSOE_MODEL=.*|CRUSOE_MODEL=nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B|' .env
  else
    echo 'CRUSOE_MODEL=nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B' >> .env
  fi
  if grep -q '^CRUSOE_MODEL_FALLBACK=' .env; then
    sed -i 's|^CRUSOE_MODEL_FALLBACK=.*|CRUSOE_MODEL_FALLBACK=deepseek-ai/Deepseek-V4-Flash|' .env
  else
    echo 'CRUSOE_MODEL_FALLBACK=deepseek-ai/Deepseek-V4-Flash' >> .env
  fi
fi
pm2 restart conductor || pm2 start src/server.js --name conductor --cwd ${REMOTE}/coordinator
pm2 save
REMOTE_EOF

echo ""
echo "✅ Deploy terminé"
echo "   Staff   : https://${DOMAIN}/index.html?agent=A7"
echo "   Console : https://${DOMAIN}/operator.html"
echo "   Sim 3D  : https://${DOMAIN}/sim/"
echo "   Crowd   : https://${DOMAIN}/crowd/"
echo "   Health  : https://${DOMAIN}/health"
echo ""
echo "Vérif : cd coordinator && PROD_URL=https://${DOMAIN} node scripts/prod-smoke.js"

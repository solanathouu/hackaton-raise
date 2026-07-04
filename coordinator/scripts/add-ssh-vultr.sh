#!/usr/bin/env bash
# Ajoute ~/.ssh/id_ed25519.pub sur un VPS Vultr déjà déployé (sans réinstall).
# Usage : VULTR_ROOT_PASSWORD='<root-password>' bash scripts/add-ssh-vultr.sh [IP]
set -euo pipefail
IP="${1:-78.141.244.231}"
PUB="${HOME}/.ssh/id_ed25519.pub"
PASS="${VULTR_ROOT_PASSWORD:-}"

if [[ ! -f "$PUB" ]]; then
  echo "❌ Clé manquante : $PUB — lance d'abord ssh-keygen -t ed25519"
  exit 1
fi

if ssh -o BatchMode=yes -o ConnectTimeout=5 -i "${PUB%.pub}" "root@${IP}" 'echo ok' 2>/dev/null; then
  echo "✅ SSH par clé déjà actif sur root@${IP}"
  exit 0
fi

if [[ -z "$PASS" ]]; then
  echo "Mot de passe root requis (email Vultr à la création du serveur)."
  echo "Usage : VULTR_ROOT_PASSWORD='<root-password>' bash scripts/add-ssh-vultr.sh ${IP}"
  echo "Ou    : ssh-copy-id -i ${PUB} root@${IP}"
  exit 2
fi

if ! command -v expect >/dev/null; then
  echo "❌ 'expect' requis. Sur Mac : déjà installé. Sinon : brew install expect"
  exit 1
fi

export VULTR_ROOT_PASSWORD="$PASS"
export VULTR_SSH_IP="$IP"
export VULTR_SSH_PUB="$PUB"

expect <<'EXPECT_EOF'
set timeout 30
set pass $env(VULTR_ROOT_PASSWORD)
set ip $env(VULTR_SSH_IP)
set pub $env(VULTR_SSH_PUB)
spawn ssh-copy-id -i $pub -o StrictHostKeyChecking=accept-new root@$ip
expect {
  -re "(?i)password:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF

ssh -o BatchMode=yes -i "${PUB%.pub}" "root@${IP}" 'echo "✅ SSH OK — $(hostname)"'

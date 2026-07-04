#!/usr/bin/env bash
# Génère les certs HTTPS locaux avec mkcert (débloque le micro sur les téléphones du LAN).
# Prérequis : brew install mkcert nss
set -euo pipefail
cd "$(dirname "$0")/.."   # coordinator/

if ! command -v mkcert >/dev/null 2>&1; then
  echo "❌ mkcert absent. Installe : brew install mkcert nss" >&2
  exit 1
fi

# CA locale : ne bloque pas si déjà trustée (le -install exige sudo/terminal ;
# après changement de réseau on ne régénère que le cert feuille, la CA ne change pas).
mkcert -install 2>/dev/null || echo "⚠ CA non (ré)installée — OK si déjà trustée, sinon lance à la main : sudo mkcert -install"

# Détection de l'IP LAN (macOS en0/en1, sinon fallback)
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo '')"
mkdir -p certs
echo "→ IP LAN détectée : ${LAN_IP:-'(aucune, WiFi coupé ?)'}"

mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1 ${LAN_IP:-}

echo ""
echo "✅ Certs générés dans coordinator/certs/ (cert.pem + key.pem)"
[ -n "$LAN_IP" ] && echo "   Les téléphones sur le même WiFi ouvrent : https://${LAN_IP}:${PORT:-3000}"
echo "   (installe la CA mkcert sur les tel : mkcert -CAROOT -> partage rootCA.pem, ou accepte l'avertissement)"

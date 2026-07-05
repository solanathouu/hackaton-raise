# CONDUCTOR — Vultr deployment (English demo branch)

Public demo instance for the RAISE Summit 2026 jury. This branch ships **GPS repositioning**, **English voice (Gradium STT/TTS)**, and **NVIDIA Nemotron** as the primary Crusoe brain.

## Live URLs

| Surface | URL |
|---------|-----|
| **Base** | https://78-141-244-231.sslip.io/ |
| **Staff app** | https://78-141-244-231.sslip.io/index.html?agent=A7 |
| **Operator console** | https://78-141-244-231.sslip.io/operator.html |
| **3D simulator** | https://78-141-244-231.sslip.io/sim/ |
| **Crowd density** | https://78-141-244-231.sslip.io/crowd/ |
| **Health** | https://78-141-244-231.sslip.io/health |

### Staff phone links by profile

- Medic: `?agent=A10`
- Security: `?agent=A6`
- Hero S2: `?agent=A7`

## Deploy from this branch

```bash
# From repo root, on feature/gps-guidance-en-deploy (or ops/vultr-deploy)
bash coordinator/scripts/deploy-vultr.sh

# Optional overrides
VULTR_IP=78.141.244.231 bash coordinator/scripts/deploy-vultr.sh
```

The script:

1. Builds the 3D simulator (`simulator/`)
2. Rsyncs the full stack to `/opt/conductor` on the VPS
3. Runs `npm install` in `coordinator/`
4. Sets `CRUSOE_MODEL=nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B` in `.env`
5. Restarts via `pm2`

Post-deploy smoke test:

```bash
cd coordinator && PROD_URL=https://78-141-244-231.sslip.io node scripts/prod-smoke.js
```

## What's on this branch

- **GPS repositioning** — staff app sends `gps_position` / manual zone tap; server resolves nearest zone, logs to `/api/position-logs`, emits proactive `guidance` hints when surplus agents can cover understaffed zones.
- **English voice** — Gradium `GRADIUM_VOICE_EN` for TTS; `detectLang` routes English incidents; dispatch templates in `agent.js` include `en`.
- **NVIDIA Nemotron primary** — `CRUSOE_MODEL=nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B`, fallback DeepSeek V4 Flash.
- **English UI** — staff app labels and operator-facing strings translated for jury demo.

## Server env (Vultr)

Ensure `coordinator/.env` on the VPS has real keys (never commit):

- `CRUSOE_API_KEY`, `MOCK_CRUSOE=false`
- `GRADIUM_API_KEY`, `GRADIUM_VOICE_EN=YTpq7expH9539ERJ`, `MOCK_GRADIUM=false`
- Optional GPS anchor for a real venue: `PARK_LAT`, `PARK_LON`

## Local test before deploy

```bash
cd coordinator && npm install
MOCK_CRUSOE=true MOCK_GRADIUM=true npm start   # or real keys in .env

node test/engine.selftest.js
node --test test/guidance.test.js test/crusoe-models.test.js
```

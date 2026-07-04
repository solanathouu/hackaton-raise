# CLAUDE.md — CONDUCTOR (guide de reprise)

> Agent de dispatch d'urgence temps réel. Hackathon RAISE Summit 2026, track **Crusoe**.
> Repo public : https://github.com/solanathouu/hackaton-raise · branche `main`.
> Spec = `docs/conductor-PRD.md`. Contrats = `CONTRACTS.md`. Détails = `README.md`.

## Bilan (audit Fable 2026-07-04 soir) : code ~90% (testé, réel) · **rendu final ~65%**
Le logiciel est prêt et solide. Le rendu se joue maintenant sur la **scène** (vidéo, répétitions, réseau) — voir Next Immediate Action. « Le risque n'est pas le code, c'est ce qui n'a jamais été répété. »

## Current Project State
| Aspect | Statut |
|--------|--------|
| Moteur cascade surplus-aware + F8 (`coordinator/src/engine.js`) | ✅ 47/47 |
| Coordinateur temps réel (`server.js` : WS + accusé/re-route + REST + reconnexion + SQLite) | ✅ e2e 22/22 |
| Cerveau **Crusoe RÉEL** (DeepSeek V4 Flash + fallback + prewarm + validation/repair) | ✅ (~3,5-4 s/appel) |
| Voix **Gradium RÉELLE** (STT + TTS fr/en/es, crédits 144k/145k) | ✅ validée en réel |
| PWA staff (`app/public/index.html` : PTT, dispatch, accusé, badge dégradé, **carte SVG + itinéraire**) | ✅ |
| Console opérateur (`app/public/operator.html` : alertes F5 Accepter/Réassigner + override + densité) | ✅ |
| **Simulateur 3D branché LIVE** (`simulator/`, servi `/sim`, vue read-only du cerveau) | ✅ |
| Capteur densité BLE + simulateur d'échelle (bonus, F5 proactif) | ✅ |
| Robustesse P4 (file TTS + retry-1008, témoins text-only, zone-prime) | ✅ |
| **Répétitions + vidéo 1 min + réseau de démo + latence mesurée** | ❌ **à faire (humain) — le vrai reste** |

## Surfaces (toutes servies par le coordinateur)
- `/index.html` — app staff (téléphones) : PTT + dispatch vocal + accusé + carte.
- `/operator.html` — console opérateur (PC/tablette) : alertes F5, override, journal.
- `/sim` — simulateur 3D **live** (grand écran). `?mode=demo` = scripté offline.

## Comment lancer / tester
```bash
cd coordinator && npm install
# .env existe déjà (gitignored) : Crusoe + Gradium RÉELS (MOCK_CRUSOE=false, MOCK_GRADIUM=false)
npm run certs            # certs mkcert (+ `mkcert -install` en sudo = À FAIRE À LA MAIN)
npm start                # https://localhost:3000 + LAN
cd ../simulator && npm install && npm run build   # -> /sim

# Tests (tout vert, revérifié) :
node test/engine.selftest.js   # 47/47
node --test test/persistence.test.js test/gradium.mock.test.js test/crusoe-validate.test.js test/crusoe-models.test.js  # 17/17
ACK_TIMEOUT_MS=2500 MOCK_CRUSOE=true MOCK_GRADIUM=true npm start & node test/ws.e2e.js  # 22/22
npm run smoke:crusoe · npm run smoke:gradium · node scripts/smoke-pipeline.js · npm run smoke:prod
```

## Réel vs Mock
- **Crusoe = RÉEL** (DeepSeek V4 Flash). **Gradium = RÉEL** (voice_ids fr/en/es). Clés dans `coordinator/.env` (**gitignored, jamais commité**).
- Mock/offline dispo (fixtures + `deterministicDecide`) = résilience F9 (badge « MODE DÉGRADÉ »).

## Rôles (P) — état
- **P1 (Nathan/Lead)** ✅ moteur + coordinateur + intégration + cap.
- **P2** ✅ backend/WS/fallback — apports (SQLite, REST, reconnexion) réconciliés dans main.
- **P3** ✅ Gradium STT/TTS + whisper (codé, binaire local non provisionné) — voix réelle validée.
- **P4** ✅ carte **adaptée** dans le staff (SVG + itinéraire Dijkstra) ; robustesse TTS cherry-pické. Reste : gestion démo (humain).
- **P5** ✅ Crusoe (prompt/hardening) + console opérateur.

## Branches (⚠ discipline : main = seule base ; pas de fork, pas de rebrand)
- `main` = **canonique** (tout réel/testé).
- `codex/backend`, `3dSimulator`, `conductor-app-p4`, `cursor/realtime-position-guidance` (PR#3) = **NE PAS MERGER**. Leur valeur a été **portée dans main** (SQLite/REST, 3D live, carte, robustesse TTS). Rebrand « Weave » de la PR#3 = **rejeté** (nom acté = CONDUCTOR).

## Next Immediate Action (rendu final — quasi zéro code, ~4 h, ce soir/demain)
1. **`mkcert -install`** (sudo) sur le laptop + truster le rootCA sur 1 iPhone + 1 Android. Bloqueur humain de tout le reste.
2. **Monter le réseau réel** : hotspot + 2-3 téléphones sur `https://<IP-LAN>:3000/index.html`, PC sur `/operator.html`. **Dérouler S1→S4 à la voix, chronomètre en main** → mesurer micro→audio (la donnée manquante).
3. **Staging** selon la mesure : pré-générer les TTS des 4 scénarios si >5 s (cache `/tts` existant), baisser `ACK_TIMEOUT_MS` à ~8000 (flourish re-route), trancher la langue (dispatch ES = flourish, narration EN).
4. **Filmer la répétition** = vidéo de secours + rushes → monter la **vidéo d'1 min** (livrable OBLIGATOIRE, actuellement 0%).
5. Répéter ×5, dont **une avec Crusoe coupé** (badge MODE DÉGRADÉ = argument résilience).

**Si reprise côté CODE** : bumper `CONTRACTS.md` en v2 (events additifs `sim_incident`/`reset`/`crowd_density`/`operator_action`, rôle `witness`, champs `nearby_notice`/`transcript_analysis`/`source`/`degraded`) ; optionnel : GPS coarse→zone + `guidance.js` (PR#3) mais nécessite le bump de contrat.

## Notation : Demo 50% · Impact 25% · Créativité 15% · Pitch 10%.

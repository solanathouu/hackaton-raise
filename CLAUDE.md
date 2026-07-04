# CLAUDE.md — CONDUCTOR (guide de reprise)

> Agent de dispatch d'urgence temps réel. Hackathon RAISE Summit 2026, track **Crusoe**.
> Repo public : https://github.com/solanathouu/hackaton-raise · branche `main`.
> Spec = `docs/conductor-PRD.md`. Contrats = `CONTRACTS.md`. Détails = `README.md`.

## Current Project State
| Aspect | Statut |
|--------|--------|
| Moteur cascade surplus-aware (`coordinator/src/engine.js`) | ✅ 47/47 |
| Coordinateur temps réel (`server.js` : WS + accusé/re-route + REST + reconnexion + SQLite) | ✅ e2e 22/22 |
| Cerveau **Crusoe RÉEL** (DeepSeek V4 Flash + fallback + prewarm + validation/repair) | ✅ |
| Voix **Gradium RÉELLE** (STT + TTS fr/en/es, clé posée, crédits 145k) | ✅ validée |
| Console opérateur (`app/public/operator.html` : alertes F5 Accepter/Réassigner + override + densité BLE) | ✅ |
| PWA staff (`app/public/index.html` : PTT, dispatch, accusé, badge F8/dégradé) | ✅ harnais fonctionnel |
| Capteur densité BLE + simulateur d'échelle (bonus, F5 proactif) | ✅ |
| **Carte de décision (Leaflet)** — P4 | 🔄 en cours (autre personne) |
| Répétitions démo + vidéo de secours | ❌ à faire (humain) |

## Comment lancer / tester
```bash
cd coordinator && npm install
# .env existe déjà (gitignored) : Crusoe + Gradium RÉELS (MOCK_CRUSOE=false, MOCK_GRADIUM=false)
npm run certs            # certs mkcert (+ `mkcert -install` en sudo, à faire à la main)
npm start                # https://localhost:3000  ·  /index.html (staff)  ·  /operator.html (opérateur)

# Tests (tout doit être vert) :
node test/engine.selftest.js                                          # 47/47
node --test test/persistence.test.js test/gradium.mock.test.js test/crusoe-validate.test.js test/crusoe-models.test.js  # 17/17
ACK_TIMEOUT_MS=2500 MOCK_CRUSOE=true MOCK_GRADIUM=true npm start &    # puis :
node test/ws.e2e.js                                                  # 22/22
# Smokes réels (clés posées) :
npm run smoke:crusoe · npm run smoke:gradium · node scripts/smoke-pipeline.js
```

## Réel vs Mock
- **Crusoe = RÉEL** (`MOCK_CRUSOE=false`, DeepSeek V4 Flash). **Gradium = RÉEL** (`MOCK_GRADIUM=false`, clé + voice_ids).
- Mock/offline reste dispo (fixtures + `deterministicDecide`) = résilience F9 (badge « MODE DÉGRADÉ »).
- Clés dans `coordinator/.env` (**gitignored, jamais commité**).

## Rôles (P) — état
- **P1 (Nathan/Lead)** ✅ moteur + coordinateur + intégration + cap.
- **P2** ✅ backend/WS/fallback — apports (SQLite, REST, reconnexion) **réconciliés dans `server.js`**.
- **P3** ✅ Gradium STT/TTS + whisper (codé) — voix réelle validée.
- **P4** 🔄 carte Leaflet (en cours, autre personne).
- **P5** ✅ Crusoe (prompt/hardening) + **console opérateur** livrée.

## Branches (⚠ discipline anti-fork / anti-dashboard)
- `main` = **canonique** (P1+P2+P3+P5, tout réel/testé).
- `codex/backend` = **NE PAS MERGER** (2ᵉ coordinateur parallèle, deps `better-sqlite3` KO sur Node 26 ; valeur déjà portée).
- `cursor/p5-full-work` = **déjà mergée** dans main.
- `3dSimulator` = **NE PAS MERGER** (viz Three.js standalone = risque DQ anti-dashboard ; garder en **B-roll vidéo** au mieux, jamais la démo live).

## Next Immediate Action
**Faire une 1re répétition chronométrée du script démo 5 min sur le VRAI réseau**, pour mesurer la latence réelle (~6-8 s boucle voix) et décider la mitigation :
1. `mkcert -install` (sudo, humain) sur le laptop de démo.
2. Hotspot laptop + 3-4 téléphones → ouvrir `https://<IP-LAN>:3000/index.html` (agents) et `/operator.html` (PC).
3. Dérouler S1→S2→S3→S4 + couper Crusoe (badge dégradé). Chronométrer. Si trop lent → **pré-générer les TTS des scénarios scriptés**.

**Si reprise côté CODE** (P4 pas dispo) : bumper `CONTRACTS.md` en v2 (documenter events additifs `operator_action`, `crowd_density`, rôle `witness`, champs `nearby_notice`/`transcript_analysis`), ou aider la carte Leaflet (support, pas dashboard).

## Notation (rappel) : Demo 50% · Impact 25% · Créativité 15% · Pitch 10%. Le risque n'est pas le code (fait/testé) — c'est ce qui n'a jamais été répété sur scène.

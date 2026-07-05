# CLAUDE.md — CONDUCTOR (guide de reprise)

> Agent de dispatch d'urgence temps réel. Hackathon RAISE Summit 2026, track **Crusoe**.
> Repo public : https://github.com/solanathouu/hackaton-raise · branche `main`.
> Spec = `docs/conductor-PRD.md`. Contrats = `CONTRACTS.md`. Détails = `README.md`.

## Bilan (checkpoint 2026-07-05) : code ~95% (testé, réel, designé) · **rendu final ~75%**
Tout le logiciel est prêt : 3 surfaces refaites sous charte commune, sim 3D v2, routage téléphones
prouvé en test croisé, caméra crowd intégrée au cerveau. Le reste est **100 % humain** : trust CA
sur les téléphones, répétitions chrono en main, vidéo 1 min. « Le risque n'est pas le code, c'est
ce qui n'a jamais été répété. »

## Current Project State
| Aspect | Statut |
|--------|--------|
| Moteur cascade surplus-aware + F8 (`coordinator/src/engine.js`) | ✅ 47/47 |
| Coordinateur temps réel (`server.js` : WS + accusé/re-route + REST + reconnexion + SQLite) | ✅ e2e 22/22 |
| Cerveau **Crusoe RÉEL** (DeepSeek V4 Flash + fallback + prewarm + validation/repair) | ✅ (~3,5-4 s/appel) |
| Voix **Gradium RÉELLE** (STT + TTS fr/en/es, crédits 144k/145k) | ✅ validée en réel |
| PWA staff (`app/public/index.html` : PTT, dispatch, accusé, badge dégradé, **carte SVG + itinéraire**) | ✅ |
| Console opérateur (`app/public/operator.html` : alertes F5 Accepter/Réassigner + override + densité) | ✅ |
| **Simulateur 3D v2** (`simulator/`, servi `/sim`, vue live read-only : parc volumétrique animé, agents qui se déplacent le long des allées, balises incident ∝ sévérité, badges modèle/dégradé, feed justification Crusoe, demo offline `?mode=demo`, verify:visual cross-platform) | ✅ (réécrit + vérifié live 2026-07-04) |
| Capteur densité BLE + simulateur d'échelle (bonus, F5 proactif) | ✅ |
| **Détecteur densité caméra** (`crowd-density/`, PR#4 Prakash mergée + branchée : `/crowd`, COCO-SSD vendoré offline, upload vidéo → niveau → émission `crowd_density` → heat 3D + advisory F5) | ✅ (intégré + vérifié 2026-07-05) |
| Robustesse P4 (file TTS + retry-1008, témoins text-only, zone-prime) | ✅ |
| **Latence mesurée** (~6 s bouton / ~8-9 s micro) · CA mkcert laptop OK | ✅ (2026-07-04, `docs/repetition-runbook.md`) |
| **Charte graphique commune** (`docs/charte-graphique.md`) + refonte des 3 surfaces (staff talkie-walkie 3 vues, console dashboard, HUD 3D) | ✅ (vérifié Playwright 2026-07-05) |
| **Routage téléphones par profil** (`?agent=`, rooms nettoyées au hello, test croisé médic/sécu : seul le bon tel sonne) | ✅ (2026-07-05) |
| **Répétitions physiques + vidéo 1 min + trust CA sur téléphones** | ❌ **à faire (humain) — le vrai reste** |

## Surfaces (toutes servies par le coordinateur)
- `/index.html` — app staff (téléphones) : PTT + dispatch vocal + accusé + carte.
- `/operator.html` — console opérateur (PC/tablette) : alertes F5, override, journal.
- `/sim` — simulateur 3D **live** (grand écran). `?mode=demo` = scripté offline.
- `/crowd` — détecteur densité caméra (upload footage → niveau → signal `crowd_density` au cerveau).

## Comment lancer / tester
```bash
cd coordinator && npm install
# .env existe déjà (gitignored) : Crusoe + Gradium RÉELS (MOCK_CRUSOE=false, MOCK_GRADIUM=false)
npm run certs            # cert feuille (CA mkcert déjà trustée ; À REFAIRE à chaque changement de réseau/IP)
npm start                # https://localhost:3000 — la ligne « LAN (en0): https://<IP>:3000 » donne l'URL téléphones
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
- `camera_crowd_detector` (PR#4 Prakash) = **MERGÉE** le 05/07 puis branchée au cerveau (`/crowd`).
- `codex/backend`, `3dSimulator`, `conductor-app-p4`, `cursor/realtime-position-guidance` (PR#3) = **NE PAS MERGER**. Leur valeur a été **portée dans main** (SQLite/REST, 3D live, carte, robustesse TTS). Rebrand « Weave » de la PR#3 = **rejeté** (nom acté = CONDUCTOR).

## ⚠ DEBUG EN COURS (2026-07-05 matin) : STT iPhone → « transcription vide »
Test talkie réel avec 3 iPhones (A10/A6/A7, CA trustée, IP `192.168.8.91`) : **routage/témoins/re-routes
PARFAITS**, mais le PTT iPhone → Gradium STT répond « transcription vide » → fallback silencieux sur la
fixture S2 (l'utilisateur croit parler, le système joue le scénario mock). Audio iOS Safari = MP4/AAC,
`audio.js` le convertit via ffmpeg — le maillon défaillant est inconnu.
**Sondes posées** (commit) : taille audio reçue (`server.js` incident_audio), format+tailles avant/après
conversion (`gradium.js`), réponse brute Gradium si vide. Serveur relancé avec sondes.
**REPRENDRE ICI** : 1) Nathan refait UN appel PTT (2-3 s de parole claire) ; 2) lire
`grep -E "incident_audio|gradium" <log serveur>` (session précédente :
`/private/tmp/claude-501/-Users-nathan-Code-hackaton-hackaton-raise/231389a5-2a51-4e5a-9c2f-1d175400adc6/scratchpad/server-diag.log`
— sinon relancer `npm start` avec un log et refaire le test) ; 3) diagnostiquer : audio ~0 Ko = micro
Safari n'enregistre pas (MediaRecorder iOS) · audio plein + wav converti + réponse vide = pb Gradium/format ;
4) fixer, retester, PUIS valider l'animation 3D (`/sim` ouvert pendant un appel).
Note : `/ca.crt` servi par le coordinateur (gitignoré) = install CA en 1 clic sur les téléphones.

## Next Immediate Action (100 % humain, ~3 h — tout le guide est dans `docs/repetition-runbook.md`)
1. **Truster la CA mkcert sur les téléphones** (une fois par tel, procédure §3 du runbook) puis ouvrir
   les liens par profil : `https://<IP-LAN>:3000/index.html?agent=A10` (médic) / `?agent=A6` (sécu) /
   `?agent=A7` (héros S2). ⚠ à chaque **changement de réseau** : `npm run certs && npm start` et lire
   la nouvelle IP dans la ligne « LAN (en0) ».
2. **Répéter S1→S4 à la voix, chronomètre en main** (attendu micro→audio ~8-9 s ; accuser dans les
   15 s sinon re-route F6 — feature à montrer une fois exprès). ×5, dont **une avec Crusoe coupé**
   (`MOCK_CRUSOE=true npm start` → badge MODE DÉGRADÉ = argument résilience).
3. **Filmer + monter la vidéo d'1 min** (livrable OBLIGATOIRE, actuellement 0 %). Structure suggérée §7.
4. Scène bonus caméra : `/crowd` avec une vidéo CCTV de foule → « Envoyer au cerveau » → heat 3D +
   advisory « Pré-positionner un renfort ? ». Tester avec la vidéo de Prakash avant.

**Si reprise côté CODE** (rien de bloquant) : bumper `CONTRACTS.md` en v2 (events additifs
`sim_incident`/`reset`/`crowd_density`/`operator_action`, rôle `witness`, champs `nearby_notice`/
`transcript_analysis`/`source`/`degraded`) ; optionnel : GPS coarse→zone + `guidance.js` (PR#3).

## Notation : Demo 50% · Impact 25% · Créativité 15% · Pitch 10%.

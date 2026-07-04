# 🎛️ CONDUCTOR

> **Le contrôle aérien des secours humains.**
> Agent de dispatch d'urgence pour environnements physiques (parcs, festivals, stades).
> Hackathon **RAISE Summit 2026**, track **Crusoe**. Repo public, *new work only*.

Un agent de terrain **parle** en langage naturel ("il est par terre au grand huit, il respire plus"),
CONDUCTOR **comprend** l'incident (type, zone, compétence, urgence, n'importe quelle langue),
envoie **UNE** alerte ciblée au plus proche **et** qualifié, et surtout **re-couvre automatiquement**
le poste vacant (*backfill surplus-aware*) pour qu'aucune zone ne devienne aveugle.
**Le backfill est le héros, pas le dispatch.**

---

## Démarrer en 2 min

```bash
# 1. Coordinateur
cd coordinator
npm install
cp .env.example .env          # USE_MOCKS=true par défaut : tout marche SANS clé

# 2. HTTPS local (débloque le micro sur les téléphones du LAN)
npm run certs                 # génère coordinator/certs/*.pem (mkcert)
#   ⚠ lance AUSSI `mkcert -install` (demande ton mot de passe) pour supprimer
#     l'avertissement navigateur. Sur le laptop, http://localhost marche déjà (contexte sécurisé).

# 3. Lancer
npm start                     # https://localhost:3000  +  https://<ton-IP-LAN>:3000
```

Ouvre l'URL sur ton téléphone (même WiFi), choisis ton agent, **maintiens pour parler**.
Sans micro : les boutons **Démo (S1–S4)** rejouent les scénarios.

### Tests
```bash
npm run engine:selftest       # 35 checks : graphe, snapshot, cascade S1–S4, invariant couverture
# e2e coordinateur (2 shells) :
ACK_TIMEOUT_MS=1500 npm start &
node test/ws.e2e.js           # 13 checks : WS, cascade, accusé, re-route, override, warning
```

### Brancher le réel (mock par intégration)
`MOCK_CRUSOE` / `MOCK_GRADIUM` surchargent `USE_MOCKS` → on branche une brique à la fois.
```bash
# .env : MOCK_CRUSOE=false (cerveau réel), MOCK_GRADIUM=true (voix mockée)
npm run smoke:crusoe            # décision JSON + latence (défaut : DeepSeek V4 Flash, ~2.5s)
node scripts/compare-models.js  # benchmark des 5 modèles autorisés du endpoint
# serveur en marche, puis :
node scripts/smoke-pipeline.js  # S1/S2/S4 end-to-end avec le vrai LLM (gate H+7 ✅)
# quand la clé Gradium arrive : MOCK_GRADIUM=false + npm run smoke:gradium
```

---

## Comment ça marche (le pipeline)

```
Voix (PTT) → STT (Gradium) → detectZone → buildSnapshot → decide (LLM Crusoe)
           → applyDecision (moteur : valide + cascade backfill) → dispatch vocal ciblé (TTS traduit)
           → accusé (sinon re-route 15s) → coverage_warning si trou non résolu
```

**Split déterministe / LLM.** Le **moteur** (`engine.js`) garantit la math de couverture
(surplus, trajets Floyd-Warshall, cascade 2-hop, accusés). Le **LLM** fait le jugement
(parse voix multilingue, contraintes opérateur NL). *Le LLM ne peut jamais violer le minimum* :
`applyDecision` re-valide et répare toute décision qui découvrirait une zone.

**Résilience (F9).** En `USE_MOCKS=true` **et** si Crusoe est injoignable, `decide()` bascule sur
`deterministicDecide` (piloté par le transcript) → tout le pipeline tourne **offline**. Jamais d'écran figé.

---

## Structure

```
data/            zones.json · roster.json (seed) · mock-fixtures.json (fixtures kickoff §4)
CONTRACTS.md     🔒 les 6 contrats gelés (A→F) — source de vérité des interfaces
coordinator/
  src/
    engine.js         ⭐ moteur cascade surplus-aware (PUR) — buildSnapshot/applyDecision/cascadeBackfill
    agent.js          orchestration du pipeline d'incident
    server.js         coordinateur temps réel (Socket.io + HTTPS + accusé + API REST + replay reconnexion)
    state.js          store d'état vivant + sérialisation
    persistence.js    log SQLite (node:sqlite NATIF, zéro compilation) — dégrade en no-op si absent
    prompt.js         prompt système Crusoe (PRD §12)
    integrations/
      crusoe.js       decide() — Crusoe (OpenAI-compat) + fallback déterministe
      gradium.js      transcribe()/speak() — endpoints RÉELS + fallback whisper.cpp (P3)
  scripts/       make-certs.sh · smoke-crusoe.js · smoke-gradium.js · compare-models.js · smoke-pipeline.js
  test/          engine.selftest.js · ws.e2e.js · persistence.test.js
app/public/      PWA staff (harnais de test fonctionnel — P4 étend/remplace)
```

## Répartition (5) — voir `docs/conductor-team-kickoff.md`
- **Lead (Nathan)** — moteur (`engine.js`) + coordinateur + cap. ✅ *chemin critique livré et testé.*
- **P2** — coordinateur/WS : apports **réconciliés dans `server.js`** (log SQLite, API REST de démo, replay reconnexion) — voir note ci-dessous.
- **P3** — Gradium : interface + endpoints réels câblés dans `gradium.js`, à finaliser (voice_ids, S2S live).
- **P4** — PWA : `app/public/index.html` fonctionne (état, PTT, dispatch, accusé, carte à ajouter — Leaflet).
- **P5** — Crusoe : `prompt.js` + `crusoe.js` prêts ; brancher la vraie clé + console opérateur.

## État kickoff (checklist)
- [x] Repo public *new work only* · seed committé · 6 contrats gelés (`CONTRACTS.md`)
- [x] Moteur cascade surplus-aware — **35/35** · Coordinateur WS e2e — **13/13**
- [x] HTTPS mkcert (certs générés ; `mkcert -install` = à faire toi, sudo)
- [x] `USE_MOCKS=true` par défaut, pipeline offline de bout en bout
- [x] **Crusoe branché** (clé posée, DeepSeek V4 Flash) — pipeline réel S1/S2/S4 validé, **gate H+7 ✅**
- [x] **Robustesse P2 réconciliée** : log SQLite (natif), API REST de démo (curl), replay des dispatchs à la reconnexion — moteur **47/47** · e2e **22/22** · persist **2/2**
- [ ] **Gradium** : clé à récupérer (coupon `RAISE-2026`) → `MOCK_GRADIUM=false` + voice_ids + `npm run smoke:gradium`

### Note réconciliation (branche `codex/backend`)
La branche `codex/backend` est un **2ᵉ coordinateur parallèle** (sous `src/p2/`) : bon code, mais **non intégré** au vrai Crusoe/Gradium, avec un défaut modèle obsolète et `better-sqlite3` qui **ne compile pas sur Node 26**. **Ne pas la merger.** Ses 3 vraies valeurs (SQLite, API REST, reconnexion) ont été **portées** dans le coordinateur intégré via `node:sqlite` (zéro compilation). Détail : `curl -X POST http://localhost:3000/api/demo/sim_incident -d '{"scenario":"S2"}' -H 'content-type: application/json'`.

Spec complète : `docs/conductor-PRD.md`. Contexte : `docs/conductor-context-brief.md`. Kit équipe : `docs/conductor-team-kickoff.md`.

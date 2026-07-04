# CONDUCTOR - Kit de démarrage équipe

> À partager aux 5. Contient tout pour commencer à coder en parallèle immédiatement :
> contrats gelés, données seed, données mockées au format exact, et la 1re tâche de chacun.
> Spec complète : `conductor-PRD.md`. Ici = le strict nécessaire pour démarrer.

**Principe :** chaque brique consomme un MOCK au bon format tout de suite, et branche le vrai plus tard. Un flag `USE_MOCKS=true` fait retourner les fixtures ci-dessous. Personne n'attend personne.

---

## 1. Setup commun (10 min, chacun de son côté)

```
Repo public : conductor/
Node 20+.  cd coordinator && npm i express socket.io openai dotenv
           cd app && npm create vite@latest (React) && npm i socket.io-client leaflet

.env (coordinator) :
  CRUSOE_API_KEY=...
  CRUSOE_BASE_URL=https://api.inference.crusoecloud.com/v1
  CRUSOE_MODEL=openai/gpt-oss-120b
  GRADIUM_API_KEY=...          # coupon RAISE-2026 pour +100k crédits
  PORT=3000
  USE_MOCKS=true               # passe à false quand la vraie intégration est prête

HTTPS local (sinon le micro est bloqué sur les tel) :
  brew install mkcert && mkcert -install && mkcert 192.168.x.x localhost
  -> servir le coordinateur en https avec ces certs.
```

---

## 2. Les 6 contrats gelés (ne pas changer sans prévenir tout le monde)

### Contrat A - WS events (app <-> coordinateur)

```
client -> serveur :
  hello            { "agentId": "A1" }
  position         { "agentId": "A1", "zoneId": "Z2" }
  incident_audio   { "agentId": "A2", "audio": "<blob/base64>", "ts": 1720000000 }
  ack              { "assignmentId": "as_1" }
  operator_override{ "incidentId": "inc_1", "newAgentId": "A4", "reason": "A1 en pause" }

serveur -> client :
  state            { "agents": [...], "zones": [...] }        # snapshot d'état complet
  dispatch         { "assignmentId":"as_1", "incidentId":"inc_1", "role":"primary",
                     "targetZone":"Z8", "text":"Arrêt cardiaque Manège Extrême, tu es le plus proche. Vas-y.",
                     "audioUrl":"/tts/as_1.mp3", "lang":"fr" }
  coverage_warning { "zoneId":"Z8", "etaSec":240,
                     "message":"Manège Extrême tombera sous le minimum ~4 min. Accepter / réassigner ?" }
```

### Contrat B - Snapshot JSON (moteur -> LLM)  [voir exemple concret en section 4]
### Contrat C - Decision JSON (LLM -> moteur)   [voir exemple concret en section 4]

### Contrat D - Interface voix (Gradium)
```
transcribe(audioBlob) -> Promise<{ text: string, lang: "fr"|"en"|"es" }>
speak(text: string, lang: string) -> Promise<{ audioUrl: string }>
```

### Contrat E - Interface cerveau (Crusoe)
```
decide(snapshot, transcript) -> Promise<Decision>   # Decision = Contrat C
```

### Contrat F - Fonctions moteur (déterministe)
```
buildSnapshot(state, incidentZoneId) -> Snapshot     # calcule headcount/surplus + pools candidats
applyDecision(decision, state) -> Assignment[]        # valide (jamais sous le min) + produit les appels
cascadeBackfill(state, vacatedAgent, depth) -> ...    # 2 hops max
```

---

## 3. Les données SEED (le vrai point de départ, à committer dans les 15 premières min)

### `data/zones.json`
```json
[
 {"id":"Z1","name":"Entrée","required_min":1,"required_skills":[],"adjacency":[{"z":"Z5","t":60},{"z":"Z10","t":70}]},
 {"id":"Z2","name":"Grand Huit","required_min":2,"required_skills":["RCP"],"adjacency":[{"z":"Z5","t":90},{"z":"Z8","t":60}]},
 {"id":"Z3","name":"Grande Roue","required_min":1,"required_skills":[],"adjacency":[{"z":"Z5","t":75},{"z":"Z4","t":85}]},
 {"id":"Z4","name":"Rivière Sauvage","required_min":1,"required_skills":["RCP"],"adjacency":[{"z":"Z3","t":85},{"z":"Z8","t":70}]},
 {"id":"Z5","name":"Place Centrale","required_min":2,"required_skills":[],"adjacency":[{"z":"Z1","t":60},{"z":"Z2","t":90},{"z":"Z3","t":75},{"z":"Z6","t":80},{"z":"Z7","t":50},{"z":"Z9","t":55}]},
 {"id":"Z6","name":"Zone Enfants","required_min":2,"required_skills":[],"adjacency":[{"z":"Z5","t":80},{"z":"Z7","t":65}]},
 {"id":"Z7","name":"Food Court","required_min":1,"required_skills":[],"adjacency":[{"z":"Z5","t":50},{"z":"Z6","t":65},{"z":"Z9","t":40}]},
 {"id":"Z8","name":"Manège Extrême","required_min":2,"required_skills":["RCP"],"adjacency":[{"z":"Z2","t":60},{"z":"Z4","t":70}]},
 {"id":"Z9","name":"Boutiques","required_min":0,"required_skills":[],"adjacency":[{"z":"Z5","t":55},{"z":"Z7","t":40}]},
 {"id":"Z10","name":"Parking","required_min":0,"required_skills":[],"adjacency":[{"z":"Z1","t":70}]}
]
```

### `data/roster.json`
```json
[
 {"id":"A1","name":"Marco","skills":["RCP","DAE"],"languages":["fr","en"],"current_zone":"Z2","home_zone":"Z2","is_reserve":false,"status":"available"},
 {"id":"A2","name":"Ana","skills":["RCP"],"languages":["fr","es"],"current_zone":"Z2","home_zone":"Z2","is_reserve":false,"status":"available"},
 {"id":"A3","name":"Karim","skills":["secu"],"languages":["fr"],"current_zone":"Z2","home_zone":"Z2","is_reserve":false,"status":"available"},
 {"id":"A4","name":"Léa","skills":["RCP","medic"],"languages":["fr","en"],"current_zone":"Z5","home_zone":"Z5","is_reserve":false,"status":"available"},
 {"id":"A5","name":"Tom","skills":["DAE","first-aid"],"languages":["fr"],"current_zone":"Z5","home_zone":"Z5","is_reserve":false,"status":"available"},
 {"id":"A6","name":"Sofia","skills":["secu"],"languages":["fr","es"],"current_zone":"Z5","home_zone":"Z5","is_reserve":false,"status":"available"},
 {"id":"A7","name":"Hugo","skills":["RCP"],"languages":["fr"],"current_zone":"Z8","home_zone":"Z8","is_reserve":false,"status":"available"},
 {"id":"A8","name":"Nadia","skills":["secu"],"languages":["fr","en"],"current_zone":"Z8","home_zone":"Z8","is_reserve":false,"status":"available"},
 {"id":"A9","name":"Yanis","skills":["first-aid"],"languages":["fr"],"current_zone":"Z6","home_zone":"Z6","is_reserve":false,"status":"available"},
 {"id":"A10","name":"Emma","skills":["RCP","medic"],"languages":["fr","en"],"current_zone":"Z6","home_zone":"Z6","is_reserve":false,"status":"available"},
 {"id":"A11","name":"Louis","skills":["RCP"],"languages":["fr"],"current_zone":"Z4","home_zone":"Z4","is_reserve":false,"status":"available"},
 {"id":"A12","name":"Chloé","skills":["first-aid"],"languages":["fr"],"current_zone":"Z7","home_zone":"Z7","is_reserve":false,"status":"available"},
 {"id":"A13","name":"Sami","skills":["secu"],"languages":["fr","en"],"current_zone":"Z1","home_zone":"Z1","is_reserve":false,"status":"available"},
 {"id":"A14","name":"Inès","skills":["first-aid"],"languages":["fr"],"current_zone":"Z3","home_zone":"Z3","is_reserve":false,"status":"available"},
 {"id":"R1","name":"Paul","skills":["RCP","DAE","secu"],"languages":["fr","en"],"current_zone":"Z9","home_zone":null,"is_reserve":true,"status":"available"},
 {"id":"R2","name":"Lucia","skills":["RCP","medic"],"languages":["fr","es"],"current_zone":"Z7","home_zone":null,"is_reserve":true,"status":"available"}
]
```

État de départ : toutes zones couvrent leur min. Surplus : Z2 (+1), Z5 (+1). Réservistes : Paul, Lucia.

---

## 4. Les données MOCKÉES (à retourner quand USE_MOCKS=true)

Scénario mock de référence : **arrêt cardiaque au Manège Extrême (Z8)**. Hugo (RCP, sur zone) intervient, Marco (RCP, surplus Z2) backfill Z8.

### Mock `transcribe()` -> renvoie toujours, quel que soit l'audio :
```json
{ "text": "arrêt cardiaque au manège extrême, il ne respire plus", "lang": "fr" }
```
Variante espagnole (scénario multilingue) :
```json
{ "text": "un hombre se desplomó en la entrada, no respira", "lang": "es" }
```

### Mock Snapshot (`buildSnapshot` -> passé à `decide`) - Contrat B
```json
{
  "incident": { "transcript": "arrêt cardiaque au manège extrême, il ne respire plus", "lang": "fr", "zone_id": "Z8" },
  "zones": [
    { "id":"Z8","name":"Manège Extrême","headcount":2,"required_min":2,"surplus":0,"required_skills":["RCP"] },
    { "id":"Z2","name":"Grand Huit","headcount":3,"required_min":2,"surplus":1,"required_skills":["RCP"] },
    { "id":"Z5","name":"Place Centrale","headcount":3,"required_min":2,"surplus":1,"required_skills":[] },
    { "id":"Z4","name":"Rivière Sauvage","headcount":1,"required_min":1,"surplus":0,"required_skills":["RCP"] }
  ],
  "constraints": [],
  "candidates_primary": [
    { "id":"A7","name":"Hugo","skills":["RCP"],"current_zone":"Z8","travel_time_s":0,"is_reserve":false },
    { "id":"A1","name":"Marco","skills":["RCP","DAE"],"current_zone":"Z2","travel_time_s":60,"is_reserve":false }
  ],
  "candidates_backfill_by_zone": {
    "Z8": [
      { "id":"A1","name":"Marco","skills":["RCP","DAE"],"current_zone":"Z2","travel_time_s":60,"is_reserve":false,"safe":true },
      { "id":"R1","name":"Paul","skills":["RCP","DAE","secu"],"current_zone":"Z9","travel_time_s":130,"is_reserve":true,"safe":true }
    ]
  }
}
```

### Mock Decision (`decide()` -> consommé par le moteur) - Contrat C
```json
{
  "incident_type": "arret_cardiaque",
  "zone_id": "Z8",
  "skills_needed": ["RCP"],
  "severity": 5,
  "primary_id": "A7",
  "backfills": [ { "agent_id": "A1", "target_zone": "Z8" } ],
  "warning": null,
  "justification": "Hugo (RCP) est sur zone au Manège Extrême, il intervient. Marco (RCP) vient du Grand Huit en surplus pour maintenir la couverture.",
  "constraints_applied": []
}
```

### Mock `speak()` :
```json
{ "audioUrl": "/mock/tts-sample.mp3" }
```

### Mock events WS (ce que le coordinateur émet en mode mock, ce que l'app doit savoir afficher)
```json
// dispatch (au primary A7 puis au backfill A1)
{ "assignmentId":"as_1","incidentId":"inc_1","role":"primary","targetZone":"Z8","text":"Arrêt cardiaque au Manège Extrême, tu es le plus proche. Vas-y.","audioUrl":"/mock/tts-sample.mp3","lang":"fr" }
{ "assignmentId":"as_2","incidentId":"inc_1","role":"backfill","targetZone":"Z8","text":"Rejoins le Manège Extrême pour maintenir la couverture.","audioUrl":"/mock/tts-sample.mp3","lang":"fr" }
// coverage_warning (scénario S3)
{ "zoneId":"Z6","etaSec":180,"message":"Zone Enfants tombera sous le minimum ~3 min. Accepter / réassigner ?" }
```

---

## 5. Par personne : ta 1re tâche + ton mock

**Lead (Nathan) - `engine.js` + `agent.js`**
- Tu consommes : rien (le moteur est pur, tourne sur `zones.json`/`roster.json`).
- Tu fournis : `buildSnapshot`, `applyDecision`, `cascade` (Contrat F).
- 1re tâche : Floyd-Warshall sur les 10 zones (matrice de trajets) + `headcount`/`surplus` + `safeToPull` + `candidatesFor`. Test : sur le seed, un incident Z8 doit produire le Mock Snapshot de la section 4.

**P2 - `server.js` (coordinateur)**
- Tu consommes : rien. Tu STANDS UP le hub le plus vite possible (WS + charge le seed + HTTPS mkcert).
- Tu fournis : les WS events (Contrat A) dès H+1:30 pour que P4 branche le vrai.
- 1re tâche : Socket.io up, `hello`/`position` mettent à jour l'état, un `incident_audio` déclenche (en mock) un `dispatch`. Sert la PWA en HTTPS.

**P3 - `integrations/gradium.js`**
- Tu consommes : rien (API Gradium + un audio sample). **Vérifie les endpoints exacts sur docs.gradium.ai.**
- Tu fournis : `transcribe`/`speak` (Contrat D) + leurs mocks (section 4).
- 1re tâche : livrer les 2 fonctions derrière l'interface, avec le mock qui renvoie les fixtures. Puis le vrai STT/TTS.

**P4 - app PWA**
- Tu consommes : les WS events (Contrat A). En attendant P2, un **mock socket** qui émet les events de la section 4.
- Tu fournis : l'app (PTT via MediaRecorder, carte Leaflet + labels headcount, panneau alertes qui joue `audioUrl`, bouton accusé qui émet `ack`).
- 1re tâche : carte + zones + PTT qui enregistre, et affiche un `dispatch` mocké + joue son audio. Bascule sur le vrai coordinateur à H+1:30.

**P5 - `integrations/crusoe.js` + prompt + console opérateur**
- Tu consommes : le Mock Snapshot (section 4). API Crusoe (SDK openai).
- Tu fournis : `decide(snapshot, transcript)` (Contrat E) + son mock (renvoie le Mock Decision).
- 1re tâche : le prompt système (PRD section 12) + l'appel SDK `response_format:json_object`, testé sur le Mock Snapshot -> doit sortir le Mock Decision. Puis la vue opérateur (feed + accept/override).

---

## 6. Checklist kickoff (les 45 premières min, ensemble puis parallèle)

- [ ] 15 min TOUS : geler les 6 contrats, committer `zones.json` + `roster.json`.
- [ ] Repo public créé, `.env` partagé (clés Crusoe + Gradium récupérées).
- [ ] `USE_MOCKS=true` par défaut ; chacun code contre les fixtures.
- [ ] mkcert / HTTPS décidé (sinon micro bloqué sur tel).
- [ ] Chacun part sur sa 1re tâche (section 5).
- [ ] Gate H+2 : flux complet sur mocks. Gate H+7 : flux réel + cascade sur le seed.
```

# CONDUCTOR — simulateur 3D (vue live)

Visualisation Three.js du site. **Mode LIVE (défaut)** : le 3D est une *vue* du VRAI coordinateur
(le cerveau) via WebSocket — il reflète les incidents, dispatchs, backfills et alertes réels.
**Mode DEMO** : moteur scripté autonome (offline / dev / fallback résilience).

## Lancer

Servi par le coordinateur (recommandé, une seule origine) :
```bash
# 1. builder le 3D
cd simulator && npm install && npm run build     # -> simulator/dist (base /sim/)
# 2. lancer le coordinateur (il sert /sim)
cd ../coordinator && npm start
# 3. ouvrir
#    https://localhost:3000/sim            (vue LIVE du cerveau)
#    https://localhost:3000/sim?mode=demo  (moteur scripté offline)
```

Dev standalone (Vite) pointé sur un coordinateur distant :
```bash
SIM_BASE=/ npm run dev     # http://127.0.0.1:5173/?coordinator=https://localhost:3000
```

## Architecture — comment c'est branché (contrat stable)

Le 3D reste une **vue seule** (il n'émet rien vers le cerveau ; le contrôle passe par la console
opérateur / les téléphones). Le point de branchement est un **moteur interchangeable** :

- `src/engineFactory.js` choisit `LiveCoordinatorEngine` (live) ou `DispatchEngine` (demo).
- `src/liveEngine.js` = l'adaptateur read-only : il écoute le Contrat A (WS) et émet les MÊMES
  events que le moteur scripté vers le renderer (`incident`, `move`, `coverage`, `decision`, `speak`).
- `src/main.js` (le rendu) et `src/data.js` (zones/agents, **mêmes IDs que le seed réel**) sont le
  **contrat stable** : on peut améliorer librement les visuels sans casser le branchement, tant que
  `data.js` garde les mêmes IDs/variables et que `main.js` continue de consommer ce bus d'events.

Mapping WS → bus 3D : `state`→`coverage` (chiffres autoritaires du cerveau) · `incident`→`incident` ·
`dispatch_log`→`move`+`speak` (les témoins ne bougent pas) · `coverage_warning`→`decision(danger)` ·
`ack_log`→`decision(ack)`.

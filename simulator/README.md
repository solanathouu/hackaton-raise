# CONDUCTOR — simulateur 3D (vue live)

Vue « tour de contrôle » Three.js du site, pensée grand écran. **Mode LIVE (défaut)** : le 3D est
une *vue read-only* du VRAI coordinateur (le cerveau) via WebSocket — incidents, dispatchs,
backfills, accusés et alertes réels, avec les agents qui se déplacent le long des allées.
**Mode DEMO** (`?mode=demo`) : cerveau local scripté, 100 % offline (dev / fallback résilience).

## Lancer

Servi par le coordinateur (recommandé, une seule origine) :
```bash
# 1. builder le 3D
cd simulator && npm install && npm run build     # -> simulator/dist (base /sim/)
# 2. lancer le coordinateur (il sert /sim)
cd ../coordinator && npm start
# 3. ouvrir
#    https://localhost:3000/sim            (vue LIVE du cerveau)
#    https://localhost:3000/sim?mode=demo  (cerveau local scripté offline)
```

Dev standalone (Vite) pointé sur un coordinateur distant :
```bash
SIM_BASE=/ npm run dev     # http://127.0.0.1:5173/?coordinator=https://localhost:3000
```

Vérification visuelle headless (offline, Chrome système requis) :
```bash
npm run build && npm run verify:visual   # screenshots dans artifacts/
```

## Architecture — comment c'est branché (contrat stable)

Le 3D reste une **vue seule** (il n'émet rien vers le cerveau ; le contrôle passe par la console
opérateur / les téléphones). Le point de branchement est un **moteur interchangeable** :

- `src/engineFactory.js` choisit `LiveCoordinatorEngine` (live) ou `DispatchEngine` (demo).
- `src/liveEngine.js` = adaptateur read-only : il écoute le Contrat A (WS) et émet les MÊMES events
  que le moteur scripté vers le renderer.
- `src/data.js` : zones/agents, **mêmes IDs que le seed réel** (noms français = ceux du `state`).

Mapping WS → bus 3D : `state`→`coverage` (chiffres autoritaires, resync douce des positions) ·
`incident`→`incident`+`brain` (badge modèle / mode dégradé) · `dispatch_log`→`move`+`speak`
(les témoins ne bougent pas) · `coverage_warning`→`decision(danger)`+pulsation de zone ·
`ack_log`→`ack` (flash vert) · `crowd_density`→`density` (heat sur zone) · connect/disconnect→badge.

## Rendu (réécrit, modulaire)

| Module | Rôle |
|--------|------|
| `src/main.js` | orchestration : moteur → scène, interactions, boucle |
| `src/scene.js` | renderer ACES + ombres, caméra auto-orbite + focus incident |
| `src/graph.js` | allées **courbes** (déterministes) + échantillonnage des trajets — les agents suivent exactement les allées dessinées |
| `src/park.js` | sol, allées, plateformes + **anneaux de statut couverture**, 10 attractions procédurales animées (roue, coaster + train, carrousel…), arbres, foule ambiante instancée, heat densité |
| `src/agents.js` | figurines (couleur compétence, anneau statut), déplacements interpolés + orientation, agents dynamiques du live |
| `src/effects.js` | balise incident (pilier + ondes ∝ sévérité), beams de dispatch par rôle, flash d'ack |
| `src/hud.js` + `src/styles.css` | HUD DOM : badges LIVE/DÉMO/CONNECTÉ/DÉGRADÉ/modèle, feed décisions (justification Crusoe), bandeau couverture, contrôles demo |
| `src/labels.js` | étiquettes sprites canvas (nettes, **zéro réseau** — fiable sur hotspot sans internet) |

Tout l'aléatoire visuel est **déterministe** (PRNG seedé, offsets par hash) : plusieurs écrans
connectés au même cerveau affichent exactement la même scène.

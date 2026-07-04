# sim3d — Intégration simulation 3D (P2)

## Checkout depuis la branche P2

```bash
git fetch origin 3dSimulator
# Copier les fichiers sim dans ce dossier (sans écraser bridge.js)
git show origin/3dSimulator:package.json > package.json
git show origin/3dSimulator:index.html > index.html
mkdir -p src scripts
git show origin/3dSimulator:src/main.js > src/main.js
git show origin/3dSimulator:src/engine.js > src/engine.js
git show origin/3dSimulator:src/data.js > src/data.js
git show origin/3dSimulator:src/styles.css > src/styles.css
npm install
```

## Patch minimal main.js (mode bridge)

1. Importer le bridge :

```javascript
import { initWeaveBridge, isBridgeMode, requestIncident } from './bridge.js';
```

2. Dans `init()`, avant `bindUi()` :

```javascript
if (isBridgeMode()) {
  initWeaveBridge({
    applyState: (st) => { /* repositionner agentVisuals depuis st.agents */ },
    applyIncident: (inc) => { createIncidentVisual({ zoneId: inc.zone_id, ...inc }); },
    applyDispatch: (d) => { /* startVisualMove depuis d */ },
    applyReset: () => resetSimulation(),
  });
}
```

3. Dans `triggerCollapse` :

```javascript
function triggerCollapse(zoneId, options = {}) {
  if (requestIncident(zoneId, options)) return;
  engine.triggerIncident(zoneId, options);
  updateMetrics();
}
```

4. Lancer en mode bridge : `http://127.0.0.1:5173/?bridge=1`

## Lien avec demo.html

Parent Weave : `https://localhost:3000/demo`  
Console : `window.P2_SIM_URL = 'http://127.0.0.1:5173/?bridge=1'`

Voir `docs/architecture-demo-3d.md`.

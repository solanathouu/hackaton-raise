# Camera Crowd Detector

Standalone footage upload prototype for CONDUCTOR. It samples uploaded video/image frames, detects people in each sample, and returns a crowd-density level.

## Intent

This is meant to become a camera signal for resource allocation. The idea is simple: upload or ingest camera footage, estimate how crowded a location is, and later feed that signal into CONDUCTOR so areas with high crowd density can receive more staff or faster coverage.

For the current demo, this is intentionally standalone. The main CONDUCTOR demo still uses a simulation for dispatch and backfill. This tool is shown as an extra capability: "given footage, can we estimate crowd density and identify a location of interest?" It does not yet trigger dispatch, rebalance agents, or modify coordinator state.

Original build request:

> upload footage then detect crowd level. Later, when there is a good number of crowd or based on crowd density, funnel more resources to the location of interest. For now, just look at the footage and tell me crowd density.

## Run

Servi par le coordinateur (recommandé, liaison cerveau active) :

```bash
cd coordinator && npm start
# -> https://localhost:3000/crowd (ou https://<IP-LAN>:3000/crowd)
```

Standalone (sans liaison cerveau) :

```bash
cd crowd-density
python -m http.server 5177   # http://localhost:5177
```

TensorFlow.js + COCO-SSD + les poids du modèle sont VENDORÉS (`vendor/`, ~19 Mo) :
la page fonctionne **sans internet** (contrainte démo hotspot). Fallback CDN si le vendor
manque, fallback heuristique si aucun modèle ne charge.

## Intégration cerveau (faite)

Après analyse : choisir la zone filmée -> « Envoyer au cerveau » publie sur le canal
`crowd_density` (Contrat A, identique au capteur BLE) : `{ zoneId, deviceCount: pic de
personnes, ratio: Low 0.8 / Moderate 1.2 / High 1.7 / Critical 2.3, source: "camera" }`.
Le coordinateur rebroadcast (chips staff/console + heat 3D sur /sim) et lève une advisory
F5 proactive (« Pré-positionner un renfort ? ») si ratio >= 1.5 sur une zone sans marge.

## Output

- `Low`, `Moderate`, `High`, or `Critical`
- estimated people count across sampled frames
- occupied frame ratio
- detection confidence
- annotated evidence frames

## Current Scope

Included:

- local browser upload for videos/images
- frame sampling
- browser-side person detection
- stronger tiled detector pass for CCTV-style overhead footage
- false-positive cleanup for huge plaza-sized person boxes
- density summary and annotated frames

Not included yet:

- live camera stream ingestion
- zone mapping from camera to CONDUCTOR zones
- automatic staff dispatch or resource funneling
- persistence or operator console integration

## Tests

```bash
npm test
```

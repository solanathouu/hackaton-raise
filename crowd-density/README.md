# Camera Crowd Detector

Standalone footage upload prototype for CONDUCTOR. It samples uploaded video/image frames, detects people in each sample, and returns a crowd-density level.

## Intent

This is meant to become a camera signal for resource allocation. The idea is simple: upload or ingest camera footage, estimate how crowded a location is, and later feed that signal into CONDUCTOR so areas with high crowd density can receive more staff or faster coverage.

For the current demo, this is intentionally standalone. The main CONDUCTOR demo still uses a simulation for dispatch and backfill. This tool is shown as an extra capability: "given footage, can we estimate crowd density and identify a location of interest?" It does not yet trigger dispatch, rebalance agents, or modify coordinator state.

Original build request:

> upload footage then detect crowd level. Later, when there is a good number of crowd or based on crowd density, funnel more resources to the location of interest. For now, just look at the footage and tell me crowd density.

## Run

```bash
cd crowd-density
python -m http.server 5177
```

Open `http://localhost:5177`.

The page loads TensorFlow.js COCO-SSD from a CDN, then runs a stronger post-processor for overhead CCTV footage:

- full-frame plus overlapping tiled detection so small people are easier to catch
- lower tile threshold for distant subjects
- sanity filters that reject huge plaza-sized false person boxes
- non-max suppression and container-box removal

If the model cannot load, it falls back to a visual-complexity estimate and marks the result as heuristic.

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

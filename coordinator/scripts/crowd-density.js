// Pont capteur BLE -> coordinateur. Spawn scripts/ble-density.py (bleak),
// lit les comptes NDJSON, calcule une baseline (médiane d'amorçage + EMA lente),
// et streame au serveur :  crowd_density { zoneId, deviceCount, baseline, ratio, ts }
//
// Usage :  node scripts/crowd-density.js
//   CROWD_ZONE=Z5            zone du site que "couvre" ce capteur (défaut Z5)
//   COORD_URL=https://localhost:3000
//   BLE_BASELINE=150         baseline forcée (démo répétable) — sinon auto-apprise
//   BLE_WINDOW_S=30  BLE_INTERVAL_S=5
//
// Le count BLE n'est PAS un comptage de personnes (rotation MAC) : c'est une
// JAUGE relative. Le serveur ne réagit qu'au RATIO count/baseline.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { io } from 'socket.io-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COORD_ROOT = resolve(__dirname, '..');

const ZONE = process.env.CROWD_ZONE || 'Z5';
const URL = process.env.COORD_URL || `https://localhost:${process.env.PORT || 3000}`;
const WINDOW_S = process.env.BLE_WINDOW_S || '30';
const INTERVAL_S = process.env.BLE_INTERVAL_S || '5';
const FORCED_BASELINE = Number(process.env.BLE_BASELINE || 0) || null;
const PYTHON = process.env.PYTHON_BIN || 'python';

const WARMUP_SAMPLES = 6;   // médiane des N premiers ticks = baseline initiale
const EMA_ALPHA = 0.03;     // baseline qui suit lentement la dérive ambiante

const socket = io(URL, { rejectUnauthorized: false, transports: ['websocket'] });
socket.on('connect', () => console.log(`[crowd] connecté à ${URL} (zone ${ZONE})`));
socket.on('connect_error', (e) => console.warn(`[crowd] connexion: ${e.message}`));

const warmup = [];
let baseline = FORCED_BASELINE;

function updateBaseline(count) {
  if (FORCED_BASELINE) return;
  if (baseline === null) {
    warmup.push(count);
    if (warmup.length >= WARMUP_SAMPLES) {
      const sorted = [...warmup].sort((a, b) => a - b);
      baseline = sorted[Math.floor(sorted.length / 2)];
      console.log(`[crowd] baseline apprise: ${baseline} appareils`);
    }
    return;
  }
  baseline = (1 - EMA_ALPHA) * baseline + EMA_ALPHA * count;
}

const py = spawn(PYTHON, ['scripts/ble-density.py', '--window', WINDOW_S, '--interval', INTERVAL_S], {
  cwd: COORD_ROOT,
});
py.stderr.on('data', (c) => process.stderr.write(`[ble] ${c}`));
py.on('exit', (code) => { console.error(`[crowd] scanner BLE terminé (${code})`); process.exit(code ?? 1); });

let buf = '';
py.stdout.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    updateBaseline(msg.count);
    const ratio = baseline ? msg.count / baseline : null;
    const payload = {
      zoneId: ZONE,
      deviceCount: msg.count,
      baseline: baseline ? Math.round(baseline) : null,
      ratio: ratio ? Number(ratio.toFixed(2)) : null,
      ts: msg.ts,
    };
    socket.emit('crowd_density', payload);
    console.log(`[crowd] ${msg.count} appareils (baseline ${payload.baseline ?? '…'} · ratio ${payload.ratio ?? 'warmup'})`);
  }
});

// Simulateur d'échelle déterministe — fait "respirer" la carte entre les scénarios.
// Se connecte comme des clients fantômes et émet des check-ins `position` (Contrat A,
// événements existants, rien de nouveau) pour les agents du roster, avec des
// déplacements SÛRS : jamais une zone sous required_min, jamais un skill requis découvert.
//
// Usage :  node scripts/sim-agents.js
//   COORD_URL=https://localhost:3000
//   SIM_SEED=42          même seed = même film (démo répétable)
//   SIM_TICK_MS=2500     cadence des événements
//   SIM_EXCLUDE=R1,R2    agents à ne pas bouger (défaut : réservistes, pour S4)
//
// AVANT un scénario S1-S4 : bouton Reset (ou event `reset`) -> état seed propre.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { io } from 'socket.io-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = process.env.COORD_URL || `https://localhost:${process.env.PORT || 3000}`;
const TICK_MS = Number(process.env.SIM_TICK_MS || 2500);
const SEED = Number(process.env.SIM_SEED || 42);
const EXCLUDE = (process.env.SIM_EXCLUDE ?? 'R1,R2').split(',').filter(Boolean);

const zones = JSON.parse(readFileSync(resolve(__dirname, '../../data/zones.json'), 'utf8'));
const roster = JSON.parse(readFileSync(resolve(__dirname, '../../data/roster.json'), 'utf8'));

// RNG déterministe (mulberry32)
let s = SEED >>> 0;
const rand = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// Vue locale des positions (la vérité reste côté serveur ; reset = on se resynchronise).
const pos = new Map(roster.map((a) => [a.id, a.current_zone]));
const byZone = (zid) => roster.filter((a) => pos.get(a.id) === zid);
const zoneOf = (zid) => zones.find((z) => z.id === zid);

// Déplacement sûr : la zone quittée garde son min ET ses skills requis couverts.
function canLeave(agent) {
  const z = zoneOf(pos.get(agent.id));
  if (!z) return true;
  const stay = byZone(z.id).filter((a) => a.id !== agent.id);
  if (stay.length < z.required_min) return false;
  return (z.required_skills || []).every((sk) => stay.some((a) => (a.skills || []).includes(sk)));
}

const sockets = new Map();
for (const a of roster) {
  const sock = io(URL, { rejectUnauthorized: false, transports: ['websocket'] });
  sock.on('connect', () => sock.emit('hello', { agentId: a.id }));
  sockets.set(a.id, sock);
}

const movable = roster.filter((a) => !EXCLUDE.includes(a.id));
console.log(`[sim] ${roster.length} agents connectés à ${URL} · seed ${SEED} · tick ${TICK_MS}ms`);
console.log(`[sim] mobiles: ${movable.map((a) => a.id).join(',')} (exclus: ${EXCLUDE.join(',') || 'aucun'})`);

setInterval(() => {
  const a = pick(movable);
  const current = pos.get(a.id);
  const z = zoneOf(current);
  const adjacent = (z?.adjacency || []).map((e) => e.z);

  // 60% : simple re-check-in (activité visible). 40% : tentative de déplacement.
  if (rand() < 0.6 || adjacent.length === 0) {
    sockets.get(a.id).emit('position', { agentId: a.id, zoneId: current });
    return;
  }
  // biais retour maison : si loin de home, 50% de viser home (évite la dérive)
  let target = pick(adjacent);
  if (a.home_zone && current !== a.home_zone && adjacent.includes(a.home_zone) && rand() < 0.5) {
    target = a.home_zone;
  }
  if (!canLeave(a)) {
    sockets.get(a.id).emit('position', { agentId: a.id, zoneId: current });
    return;
  }
  pos.set(a.id, target);
  sockets.get(a.id).emit('position', { agentId: a.id, zoneId: target });
  console.log(`[sim] ${a.id} ${current} -> ${target}`);
}, TICK_MS);

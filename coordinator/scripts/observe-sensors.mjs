// Observe crowd_density + coverage_warning pendant N secondes (debug démo capteurs).
// Usage : node scripts/observe-sensors.mjs   OBS_S=60 COORD_URL=https://localhost:3000
import { io } from 'socket.io-client';

const URL = process.env.COORD_URL || 'https://localhost:3000';
const DURATION = Number(process.env.OBS_S || 30) * 1000;
const sock = io(URL, { rejectUnauthorized: false, transports: ['websocket'] });

let stateCount = 0;
let lastHeadcounts = '';
sock.on('state', (st) => {
  stateCount++;
  lastHeadcounts = st.zones.map((z) => `${z.id}:${z.headcount}`).join(' ');
});
sock.on('crowd_density', (p) => console.log(`[obs] crowd_density ${p.zoneId} count=${p.deviceCount} ratio=${p.ratio}`));
sock.on('coverage_warning', (w) => console.log(`[obs] ⚠ coverage_warning ${w.zoneId}: ${w.message}`));

sock.on('connect', () => console.log('[obs] connecté'));
setTimeout(() => {
  console.log(`[obs] ${stateCount} broadcasts state en ${DURATION / 1000}s`);
  console.log(`[obs] headcounts finaux: ${lastHeadcounts}`);
  process.exit(0);
}, DURATION);

// Smoke end-to-end du pipeline RÉEL contre un serveur en marche (gate H+7).
// Démarre le serveur (MOCK_CRUSOE=false), puis : node scripts/smoke-pipeline.js
// Tire des incidents via sim_incident et affiche incident (source LLM) + dispatchs + warnings.
import { io } from 'socket.io-client';

const URL = `${process.env.E2E_PROTO || 'https'}://localhost:${process.env.PORT || 3000}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const op = io(URL, { rejectUnauthorized: false, transports: ['websocket'], forceNew: true });

const buf = { incident: [], dispatch_log: [], coverage_warning: [] };
for (const ev of Object.keys(buf)) op.on(ev, (p) => buf[ev].push(p));

await new Promise((res, rej) => { op.on('connect', res); setTimeout(() => rej(new Error('connexion KO')), 5000); });
console.log(`\nConnecté à ${URL}\n`);

const SCENARIOS = [
  { name: 'S1 surplus Z2', tr: 'malaise au grand huit, une personne au sol', lang: 'fr' },
  { name: 'S2 cascade Z8', tr: 'arrêt cardiaque au manège extrême, il ne respire plus', lang: 'fr' },
  { name: 'S4 réserviste ES', tr: 'un hombre se desplomó en la entrada, no respira', lang: 'es' },
];

let fail = 0;
for (const s of SCENARIOS) {
  op.emit('reset'); await sleep(200);
  for (const k of Object.keys(buf)) buf[k] = [];
  const t0 = Date.now();
  op.emit('sim_incident', { transcript: s.tr, lang: s.lang });
  const t0w = Date.now();
  while (Date.now() - t0w < 12000 && buf.incident.length === 0) await sleep(50);
  await sleep(600); // laisse arriver dispatchs + warnings
  const inc = buf.incident[0];
  if (!inc) { console.log(`❌ ${s.name} : aucun incident (timeout LLM ?)`); fail++; continue; }
  const disp = buf.dispatch_log.map((d) => `${d.role}:${d.agentId}->${d.targetZone}`).join('  ');
  const primaryInDisp = buf.dispatch_log.some((d) => d.role === 'primary' && d.agentId === inc.primary_id);
  console.log(`▎ ${s.name}  (${Date.now() - t0}ms, source=${inc.source})`);
  console.log(`   incident : ${inc.type} · ${inc.zone_id} · sev ${inc.severity} · primary ${inc.primary_id}`);
  console.log(`   dispatchs: ${disp || '∅'}`);
  if (inc.warning) console.log(`   ⚠ ${inc.warning}`);
  if (inc.justification) console.log(`   « ${inc.justification.slice(0, 120)}${inc.justification.length > 120 ? '…' : ''} »`);
  if (!inc.primary_id) { console.log('   ❌ pas de primary'); fail++; }
  else if (!primaryInDisp) { console.log('   ❌ primary sans dispatch'); fail++; }
  else console.log('   ✅ OK');
  console.log('');
}

console.log(fail === 0 ? '===== PIPELINE RÉEL OK =====\n' : `===== ${fail} scénario(s) KO =====\n`);
op.close();
process.exit(fail === 0 ? 0 : 1);

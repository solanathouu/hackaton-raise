// Rejoue les scénarios démo S1–S4 via WebSocket (serveur déjà lancé).
//   npm start &
//   node scripts/sim-demo.js
import { io } from 'socket.io-client';

const URL = `http://127.0.0.1:${process.env.PORT || 3000}`;
const WAIT = Number(process.env.E2E_LLM_WAIT_MS || 12000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = io(URL, { transports: ['websocket'], forceNew: true });
const log = { incident: [], dispatch: [], warning: [] };
client.on('incident', (p) => { log.incident.push(p); console.log(`  🧠 incident ${p.id} · ${p.zone_id} · primary ${p.primary_id} (${p.source}${p.model ? ` / ${p.model}` : ''})`); });
client.on('dispatch_log', (d) => { log.dispatch.push(d); console.log(`  📣 ${d.role} → ${d.agentId} @ ${d.targetZone}`); });
client.on('coverage_warning', (w) => { log.warning.push(w); console.log(`  ⚠ ${w.message}`); });

await new Promise((res, rej) => {
  client.on('connect', res);
  client.on('connect_error', rej);
  setTimeout(() => rej(new Error('connexion timeout')), 5000);
});
console.log(`\n✅ Connecté à ${URL}\n`);

async function reset() {
  client.emit('reset');
  log.incident.length = 0;
  log.dispatch.length = 0;
  log.warning.length = 0;
  await sleep(200);
}

async function sim(label, transcript, lang) {
  console.log(`\n── ${label} ──`);
  await reset();
  const t0 = Date.now();
  client.emit('sim_incident', { transcript, lang });
  while (Date.now() - t0 < WAIT && log.incident.length === 0) await sleep(100);
  if (!log.incident.length) console.log('  ✗ timeout (augmente E2E_LLM_WAIT_MS)');
  else console.log(`  ⏱ ${Date.now() - t0} ms · ${log.dispatch.length} dispatch(s)`);
}

await sim('S1 · surplus Z2', 'malaise au grand huit, une personne au sol', 'fr');
await sim('S2 · cascade Z8', 'arrêt cardiaque au manège extrême, il ne respire plus', 'fr');
await sim('S4 · réserviste ES', 'un hombre se desplomó en la entrada, no respira', 'es');

console.log('\n── S3 · warning (dépletion surplus) ──');
await reset();
for (let i = 0; i < 8 && log.warning.length === 0; i++) {
  client.emit('sim_incident', {
    transcript: i % 2 ? 'arrêt cardiaque à la rivière sauvage' : 'arrêt cardiaque au manège extrême, il ne respire plus',
    lang: 'fr',
  });
  await sleep(WAIT / 2);
}
console.log(log.warning.length ? `  ⚠ ${log.warning[0].message}` : '  ✗ pas de warning (surplus pas assez épuisé)');

console.log('\n✅ Simulation terminée — ouvre http://127.0.0.1:3000 pour la UI\n');
client.close();
process.exit(0);

// E2E du coordinateur (WS Contrat A). Démarre le serveur séparément puis lance ce client.
//   ACK_TIMEOUT_MS=1500 USE_MOCKS=true npm start &   # dans un shell
//   node test/ws.e2e.js
import { io } from 'socket.io-client';

const PORT = process.env.PORT || 3000;
const HOST = process.env.E2E_HOST || '127.0.0.1';
const PROTO = process.env.E2E_PROTO || 'http';
const URL = `${PROTO}://${HOST}:${PORT}`;
const LLM_WAIT_MS = Number(process.env.E2E_LLM_WAIT_MS || 12000);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const op = io(URL, { rejectUnauthorized: false, transports: ['websocket'], forceNew: true });

// Buffers d'events
const buf = { state: [], incident: [], dispatch_log: [], coverage_warning: [], ack_log: [], override_log: [] };
for (const ev of Object.keys(buf)) op.on(ev, (p) => buf[ev].push(p));
const clear = () => { for (const k of Object.keys(buf)) buf[k] = []; };
const lastState = () => buf.state[buf.state.length - 1];
const waitFor = async (pred, ms = 2500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(40); } return false; };

await new Promise((res, rej) => { op.on('connect', res); op.on('connect_error', rej); setTimeout(() => rej(new Error('timeout connexion')), 4000); });
console.log(`\nConnecté à ${URL}\n`);

// --- 0) État initial ---
console.log('[0] État initial');
await waitFor(() => buf.state.length > 0);
{
  const st = lastState();
  ok(!!st && st.zones.length === 10 && st.agents.length === 16, 'snapshot état reçu (10 zones, 16 agents)');
  const z8 = st.zones.find((z) => z.id === 'Z8');
  ok(z8.headcount === 2 && z8.surplus === 0, 'Z8 = 2/min2 surplus0');
}

const resetAndClear = async () => { op.emit('reset'); await sleep(150); clear(); };

// --- S2 : cascade Z8 (primary Hugo + backfill Marco) ---
console.log('\n[S2] Cascade Z8 : dispatch primary + backfill via WS');
await resetAndClear();
op.emit('sim_incident', { transcript: 'arrêt cardiaque au manège extrême, il ne respire plus', lang: 'fr' });
await waitFor(() => buf.incident.length > 0 && buf.dispatch_log.length >= 2, LLM_WAIT_MS);
{
  const inc = buf.incident[0];
  ok(inc?.primary_id === 'A7', `incident.primary_id = A7 (Hugo) [reçu ${inc?.primary_id}]`);
  const prim = buf.dispatch_log.find((d) => d.role === 'primary');
  const back = buf.dispatch_log.find((d) => d.role === 'backfill');
  ok(prim?.agentId === 'A7' && prim?.targetZone === 'Z8', 'dispatch primary -> A7 @Z8');
  ok(!!back && back.agentId === 'A1' && back.targetZone === 'Z8', `dispatch backfill -> A1 @Z8 [reçu ${back?.agentId}]`);
  ok(!!prim?.audioUrl, 'dispatch primary a un audioUrl (TTS mock)');
  // accusé du backfill -> l'agent arrive, la zone se recouvre
  op.emit('ack', { assignmentId: back.assignmentId });
  op.emit('ack', { assignmentId: prim.assignmentId });
  const acked = await waitFor(() => buf.ack_log.length >= 2);
  ok(acked, '2 accusés traités');
}

// --- S1 : surplus Z2, zéro backfill, zéro warning ---
console.log('\n[S1] Surplus Grand Huit : un seul appel, aucune cascade');
await resetAndClear();
op.emit('sim_incident', { transcript: 'malaise au grand huit, une personne au sol', lang: 'fr' });
await waitFor(() => buf.incident.length > 0, LLM_WAIT_MS);
await sleep(400);
{
  const inc = buf.incident[0];
  ok(inc?.zone_id === 'Z2', `incident zone = Z2 [reçu ${inc?.zone_id}]`);
  ok(buf.dispatch_log.filter((d) => d.role === 'backfill').length === 0, 'aucun backfill (Z2 en surplus)');
  ok(buf.coverage_warning.length === 0, 'aucun coverage_warning');
  const prim = buf.dispatch_log.find((d) => d.role === 'primary');
  op.emit('ack', { assignmentId: prim.assignmentId });
}

// --- Override opérateur ---
console.log('\n[Override] operator_override réassigne + enregistre une contrainte');
await resetAndClear();
op.emit('sim_incident', { transcript: 'arrêt cardiaque au manège extrême', lang: 'fr' });
await waitFor(() => buf.incident.length > 0 && buf.dispatch_log.length >= 1, LLM_WAIT_MS);
{
  const incId = buf.incident[0].id;
  clear();
  op.emit('operator_override', { incidentId: incId, newAgentId: 'A4', reason: 'protège les médics de la scène A' });
  const got = await waitFor(() => buf.dispatch_log.some((d) => d.agentId === 'A4') && buf.override_log.length > 0);
  ok(got, 'override -> nouveau dispatch vers A4 + override_log émis');
}

// --- Re-route sur non-accusé (F6) ---  (nécessite ACK_TIMEOUT_MS bas)
console.log('\n[Re-route] dispatch non acquitté -> re-route auto');
await resetAndClear();
op.emit('sim_incident', { transcript: 'malaise au grand huit', lang: 'fr' });
await waitFor(() => buf.dispatch_log.length >= 1, LLM_WAIT_MS);
{
  const before = buf.dispatch_log.length;
  const rerouted = await waitFor(() => buf.dispatch_log.some((d) => /re-route/.test(d.text || '')), Number(process.env.ACK_TIMEOUT_MS || 1500) + 2500);
  ok(rerouted, 'un dispatch re-routé est apparu (aucun accusé) — incident jamais perdu');
  if (rerouted) { const r = buf.dispatch_log.find((d) => /re-route/.test(d.text)); op.emit('ack', { assignmentId: r.assignmentId }); }
}

// --- Warning : dépléter le RCP jusqu'à l'alerte proactive ---
console.log('\n[Warning] surplus + réserves épuisés -> coverage_warning proactif');
await resetAndClear();
for (let i = 0; i < 10 && buf.coverage_warning.length === 0; i++) {
  op.emit('sim_incident', { transcript: i % 2 ? 'arrêt cardiaque à la rivière sauvage, il ne respire plus' : 'arrêt cardiaque au manège extrême, il ne respire plus', lang: 'fr' });
  await sleep(220);
}
ok(buf.coverage_warning.length > 0, `coverage_warning émis après dépletion [${buf.coverage_warning.length} warning(s)]`);
if (buf.coverage_warning[0]) console.log(`     → "${buf.coverage_warning[0].message}"`);

// --- F8 : override "protège Marco" appris -> l'incident suivant ne ponctionne plus Marco ---
console.log('\n[F8] Override appris via WS -> incident suivant respecte la contrainte');
await resetAndClear();
op.emit('operator_override', { incidentId: 'standing', newAgentId: null, reason: 'protège Marco' });
await sleep(200);
clear();
op.emit('sim_incident', { transcript: 'arrêt cardiaque au manège extrême, il ne respire plus', lang: 'fr' });
await waitFor(() => buf.incident.length > 0 && buf.dispatch_log.some((d) => d.role === 'backfill'), LLM_WAIT_MS);
{
  const back = buf.dispatch_log.find((d) => d.role === 'backfill');
  ok(back && back.agentId !== 'A1', `backfill n'est PAS Marco (A1) [reçu ${back?.agentId}]`);
  ok(buf.incident[0]?.constraints_applied?.includes('protège Marco'), 'incident.constraints_applied propagé au client');
}

// --- Badge résilience : en mock, source déterministe (non dégradé) ---
console.log('\n[Résilience] le champ source/degraded arrive au client');
const src = buf.incident[0]?.source || '';
ok(!!src, `incident.source renseigné [${src}]`);
ok(src.startsWith('crusoe') || src === 'mock:deterministic', 'source = crusoe ou mock déterministe');

console.log(`\n===== E2E ${pass} OK / ${fail} KO =====\n`);
op.close();
process.exit(fail === 0 ? 0 : 1);

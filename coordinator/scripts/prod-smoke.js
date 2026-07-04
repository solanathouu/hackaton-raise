// Smoke prod strict — reset + S1/S2 + TTS + health. URL sans :443 explicite.
import { io } from 'socket.io-client';

const BASE = process.env.PROD_URL || 'https://78-141-244-231.sslip.io';
const WAIT = Number(process.env.E2E_LLM_WAIT_MS || 25000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

console.log(`\n→ Prod smoke : ${BASE}\n`);

const health = await fetch(`${BASE}/health`).then((r) => r.json());
ok(health.ok && health.mockCrusoe === false && health.mockGradium === false, 'health live Crusoe+Gradium');
ok(health.crusoe?.liveReady === true, 'crusoe.liveReady');

const op = io(BASE, { rejectUnauthorized: false, transports: ['websocket'], forceNew: true });
const buf = { state: [], incident: [], dispatch_log: [], coverage_warning: [] };
for (const k of Object.keys(buf)) op.on(k, (p) => buf[k].push(p));
await new Promise((res, rej) => { op.on('connect', res); op.on('connect_error', rej); setTimeout(() => rej(new Error('timeout')), 8000); });

op.emit('reset');
await sleep(600);
for (const k of Object.keys(buf)) buf[k] = [];

const st = buf.state.at(-1) || await fetch(`${BASE}/api/state`).then((r) => r.json());
const z8 = st.zones?.find((z) => z.id === 'Z8');
ok(z8?.headcount === 2 && z8?.surplus === 0, `Z8 seed ${z8?.headcount}/${z8?.required_min}`);

console.log('\n[S2] cascade Z8');
op.emit('sim_incident', { transcript: 'arrêt cardiaque au manège extrême, il ne respire plus', lang: 'fr' });
for (let t = 0; t < WAIT && buf.incident.length === 0; t += 100) await sleep(100);
await sleep(2000);
{
  const inc = buf.incident[0];
  ok(inc?.primary_id === 'A7', `primary A7 [${inc?.primary_id}]`);
  ok(inc?.source?.startsWith('crusoe'), `source ${inc?.source}`);
  const prim = buf.dispatch_log.find((d) => d.role === 'primary');
  const back = buf.dispatch_log.find((d) => d.role === 'backfill');
  ok(prim?.agentId === 'A7', 'dispatch primary A7');
  ok(back?.agentId === 'A1', `backfill A1 [${back?.agentId}]`);
  ok(!!prim?.audioUrl, `primary audioUrl [${prim?.audioUrl || 'none'}]`);
  if (prim?.audioUrl) {
    const ar = await fetch(`${BASE}${prim.audioUrl}`);
    ok(ar.ok && (Number(ar.headers.get('content-length')) || 0) > 500, 'TTS fichier servi (>500o)');
  }
}

console.log('\n[S1] surplus Z2');
op.emit('reset');
await sleep(400);
for (const k of Object.keys(buf)) buf[k] = [];
op.emit('sim_incident', { transcript: 'malaise au grand huit, une personne au sol', lang: 'fr' });
for (let t = 0; t < WAIT && buf.incident.length === 0; t += 100) await sleep(100);
await sleep(800);
ok(buf.incident[0]?.zone_id === 'Z2', `zone Z2 [${buf.incident[0]?.zone_id}]`);
ok(buf.dispatch_log.filter((d) => d.role === 'backfill').length === 0, 'aucun backfill S1');

console.log(`\n===== PROD ${pass} OK / ${fail} KO =====\n`);
op.close();
process.exit(fail === 0 ? 0 : 1);

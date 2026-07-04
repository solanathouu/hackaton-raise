// Audit exhaustif backend — unit + smoke API + WS E2E (local ou prod).
// Usage:
//   node scripts/audit-backend.js                    # local http://127.0.0.1:3000
//   E2E_PROTO=https E2E_HOST=78-141-244-231.sslip.io PORT=443 node scripts/audit-backend.js
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const HOST = process.env.E2E_HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const PROTO = process.env.E2E_PROTO || 'http';
const BASE = PROTO === 'https' && PORT === 443
  ? `https://${HOST}`
  : `${PROTO}://${HOST}:${PORT}`;

const LLM_WAIT = Number(process.env.E2E_LLM_WAIT_MS || 20000);
const SKIP_SPAWN = process.env.AUDIT_NO_SPAWN === '1' || HOST !== '127.0.0.1';

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) { pass++; console.log(`  ✓ ${m}`); }
  else { fail++; console.log(`  ✗ ${m}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...opts.env } });
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} → ${code}`))));
  });
}

async function fetchJson(path) {
  const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

// --- Phase 1 : unit tests ---
console.log('\n═══ [1/5] Tests unitaires ═══');
try {
  await run('node', ['--test', 'test/guidance.test.js', 'test/crusoe-validate.test.js', 'test/crusoe-models.test.js']);
  ok(true, '12 tests unitaires passent');
} catch {
  ok(false, 'tests unitaires KO');
}

// --- Phase 2 : smoke API directe (local only — clés dans .env) ---
if (HOST === '127.0.0.1') {
  console.log('\n═══ [2/5] Smoke Crusoe + Gradium (API directe) ═══');
  try { await run('node', ['scripts/smoke-crusoe.js']); ok(true, 'smoke Crusoe OK'); }
  catch { ok(false, 'smoke Crusoe KO'); }
  try { await run('node', ['scripts/smoke-gradium.js']); ok(true, 'smoke Gradium STT+TTS OK'); }
  catch { ok(false, 'smoke Gradium KO'); }
} else {
  console.log('\n═══ [2/5] Smoke API directe — skip (prod, clés sur VPS) ═══');
}

// --- Phase 3 : démarrer serveur local si besoin ---
let serverProc = null;
if (!SKIP_SPAWN) {
  console.log('\n═══ [3/5] Démarrage serveur local ═══');
  serverProc = spawn('node', ['src/server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  let booted = false;
  await Promise.race([
    new Promise((res) => {
      serverProc.stdout.on('data', (d) => {
        process.stdout.write(d);
        if (/Weave coordinateur/.test(d.toString())) booted = true;
      });
      serverProc.stderr.on('data', (d) => process.stderr.write(d));
      const poll = async () => {
        for (let i = 0; i < 30; i++) {
          try { await fetchJson('/health'); booted = true; res(); return; } catch { await sleep(300); }
        }
        res();
      };
      poll();
    }),
    sleep(15000),
  ]);
  ok(booted, 'serveur démarré et /health répond');
} else {
  console.log('\n═══ [3/5] Serveur externe — pas de spawn ═══');
}

try {
  // --- Phase 4 : /health strict ---
  console.log('\n═══ [4/5] /health + /api/state strict ═══');
  const health = await fetchJson('/health');
  ok(health.ok === true, '/health ok=true');
  ok(health.mockCrusoe === false, 'mockCrusoe=false (Crusoe live)');
  ok(health.mockGradium === false, 'mockGradium=false (Gradium live)');
  ok(health.crusoe?.liveReady === true, 'crusoe.liveReady=true');
  ok(Array.isArray(health.crusoe?.allowedModels) && health.crusoe.allowedModels.length === 5, 'allowlist 5 modèles');
  ok(!health.crusoe?.errors?.length, 'aucune erreur config Crusoe');

  const st = await fetchJson('/api/state');
  ok(st.zones?.length === 10, '10 zones dans /api/state');
  ok(st.agents?.length === 16, '16 agents dans /api/state');
  const z8 = st.zones.find((z) => z.id === 'Z8');
  ok(z8?.map_x != null && z8?.lat != null, 'zones enrichies map_x/lat (position guidance)');

  // --- Phase 5 : WS E2E ---
  console.log('\n═══ [5/5] WebSocket E2E (incidents + position/guidance) ═══');
  const op = io(BASE, { rejectUnauthorized: false, transports: ['websocket'], forceNew: true });
  const buf = {
    state: [], incident: [], dispatch_log: [], coverage_warning: [],
    guidance: [], guidance_log: [], position_log: [],
  };
  for (const k of Object.keys(buf)) op.on(k, (p) => buf[k].push(p));
  const waitFor = async (pred, ms = LLM_WAIT) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(50); }
    return false;
  };
  await new Promise((res, rej) => {
    op.on('connect', res);
    op.on('connect_error', (e) => rej(e));
    setTimeout(() => rej(new Error('WS timeout')), 8000);
  });
  ok(true, `WS connecté à ${BASE}`);

  op.emit('reset');
  await sleep(200);
  for (const k of Object.keys(buf)) buf[k] = [];

  // Position + guidance
  const r1 = io(BASE, { rejectUnauthorized: false, transports: ['websocket'], forceNew: true });
  const r1buf = { guidance: [] };
  r1.on('guidance', (g) => r1buf.guidance.push(g));
  await new Promise((res) => r1.on('connect', res));
  r1.emit('hello', { agentId: 'R1' });
  await sleep(100);
  // Vider Z8 sauf A8
  op.emit('position', { agentId: 'A7', zoneId: 'Z2' });
  await waitFor(() => buf.state.length > 0, 2000);
  op.emit('position', { agentId: 'R1', zoneId: 'Z9' });
  await waitFor(() => buf.position_log.some((p) => p.agentId === 'R1'), 2000);
  ok(buf.position_log.some((p) => p.agentId === 'R1' && p.zoneId === 'Z9'), 'position_log après check-in R1→Z9');
  op.emit('scan_reposition');
  await waitFor(() => buf.guidance_log.length > 0, 3000);
  ok(buf.guidance_log.length > 0, 'scan_reposition émet guidance_log');
  await waitFor(() => r1buf.guidance.some((g) => g.agentId === 'R1'), 3000);
  ok(r1buf.guidance.some((g) => g.targetZone && g.message), 'R1 reçoit guidance ciblée avec targetZone');
  r1.close();

  // S2 cascade
  op.emit('reset');
  await sleep(200);
  for (const k of Object.keys(buf)) buf[k] = [];
  op.emit('sim_incident', { transcript: 'arrêt cardiaque au manège extrême, il ne respire plus', lang: 'fr' });
  await waitFor(() => buf.incident.length > 0 && buf.dispatch_log.length >= 1, LLM_WAIT);
  {
    const inc = buf.incident[0];
    ok(!!inc?.primary_id, `incident primary_id=${inc?.primary_id}`);
    ok(inc?.source?.startsWith('crusoe') || inc?.source === 'mock:deterministic', `source=${inc?.source}`);
    const prim = buf.dispatch_log.find((d) => d.role === 'primary');
    ok(!!prim?.agentId, `dispatch primary → ${prim?.agentId}`);
    ok(!!prim?.audioUrl, `TTS audioUrl présent (${prim?.audioUrl?.slice(0, 30)}…)`);
    if (prim?.audioUrl && !String(prim.audioUrl).includes('/mock/')) {
      const audioRes = await fetch(`${BASE}${prim.audioUrl}`, { signal: AbortSignal.timeout(10000) });
      ok(audioRes.ok && Number(audioRes.headers.get('content-length') || 1) > 100, 'fichier TTS Gradium servi et non vide');
    }
    await waitFor(() => buf.guidance_log.length > 0, 3000);
    ok(buf.guidance_log.length > 0, 'guidance auto après incident');
  }

  // S1 pas de backfill
  op.emit('reset');
  await sleep(600);
  for (const k of Object.keys(buf)) buf[k] = [];
  op.emit('sim_incident', { transcript: 'malaise au grand huit, une personne au sol', lang: 'fr' });
  await waitFor(() => buf.incident.length > 0, LLM_WAIT);
  await sleep(800);
  const s1 = buf.incident[buf.incident.length - 1];
  ok(s1?.zone_id === 'Z2', `S1 zone Z2 [${s1?.zone_id}]`);
  ok(buf.dispatch_log.filter((d) => d.role === 'backfill').length === 0, 'S1 aucun backfill');

  op.close();
} catch (e) {
  ok(false, `audit runtime: ${e.message}`);
}

if (serverProc) {
  serverProc.kill('SIGTERM');
  await sleep(300);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`AUDIT ${pass} OK / ${fail} KO`);
console.log(`${'='.repeat(50)}\n`);
process.exit(fail === 0 ? 0 : 1);

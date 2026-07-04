// server.js — Coordinateur temps réel. Détient l'état, orchestre le pipeline, sert la PWA.
// Local-first : tourne sur un laptop, HTTPS mkcert (micro mobile), tout sur réseau local.
// Réconcilie les apports P2 : persistance SQLite (node:sqlite), replay des dispatchs à la
// reconnexion, et API REST de démo (curl) — sans casser l'intégration réelle Crusoe/Gradium.
import http from 'node:http';
import https from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import os from 'node:os';
import express from 'express';
import { Server as SocketServer } from 'socket.io';

import { config, loadSeed } from './config.js';
import { buildState, serializeState, setPosition, setStatus, commitAgents, nextIncidentId, addConstraint } from './state.js';
import { candidatesPrimary, candidatesBackfill, zoneById } from './engine.js';
import { handleIncident } from './agent.js';
import { createStore } from './persistence.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let state = buildState(loadSeed());
const store = createStore(config.persist ? config.sqlitePath : null);

// Contexte runtime des incidents (timers d'accusé + re-route + replay reconnexion).
const ackTimers = new Map();       // assignmentId -> timeout
const incidentCtx = new Map();     // incidentId -> { zoneId, skills, used:Set, rerouteCount:Map }
const pendingByAgent = new Map();  // agentId -> Map(assignmentId -> dispatch)  (dispatchs non acquittés)

// --- Express : PWA + assets audio + API REST ------------------------------
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(resolve(ROOT, '../app/public')));               // PWA staff
app.use('/mock', express.static(resolve(ROOT, '../app/public/mock'))); // /mock/tts-sample.mp3
app.use('/tts', express.static(resolve(ROOT, 'tts-cache')));           // TTS générés

app.get('/health', (_req, res) => res.json({ ok: true, useMocks: config.useMocks, persist: store.enabled }));
app.get('/api/state', (_req, res) => res.json(serializeState(state)));
app.get('/api/incidents', (req, res) => res.json({ incidents: store.listIncidents(Number(req.query.limit) || 50) }));

// API REST de démo (répétitions au curl, sans micro) — miroir des events WS.
app.post('/api/demo/sim_incident', async (req, res) => {
  try {
    const sc = scenarioPayload(req.body?.scenario);
    const r = await runIncident({ transcript: req.body?.transcript || sc.transcript, langHint: req.body?.lang || sc.lang });
    res.json({ ok: true, incident: r.incident, dispatches: r.dispatches });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/demo/reset', (_req, res) => { doReset(); res.json({ ok: true, state: serializeState(state) }); });
app.post('/api/assignments/:id/ack', (req, res) => res.json({ ok: ackAssignment(req.params.id) }));
app.post('/api/operator/override', (req, res) => { applyOverride(req.body || {}); res.json({ ok: true }); });

// --- HTTP(S) server + Socket.io -------------------------------------------
const server = createHttpServer(app);
const io = new SocketServer(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e7 });

function createHttpServer(expressApp) {
  const certPath = resolve(ROOT, config.tls.cert);
  const keyPath = resolve(ROOT, config.tls.key);
  if (existsSync(certPath) && existsSync(keyPath)) {
    console.log('[tls] HTTPS activé (certs mkcert trouvés)');
    return https.createServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, expressApp);
  }
  console.warn('[tls] ⚠ certs absents -> HTTP (le micro sera bloqué sur mobile). Lance: npm run certs');
  return http.createServer(expressApp);
}

const broadcastState = () => io.emit('state', serializeState(state));

// --- Dispatchs en attente (replay à la reconnexion, F9 résilience réseau) ---
function trackPending(d) {
  if (!d.agentId) return;
  if (!pendingByAgent.has(d.agentId)) pendingByAgent.set(d.agentId, new Map());
  pendingByAgent.get(d.agentId).set(d.assignmentId, d);
}
function clearPending(agentId, assignmentId) {
  pendingByAgent.get(agentId)?.delete(assignmentId);
}

// --- Émission d'un dispatch + accusé + persistance + suivi replay ----------
function emitDispatch(d) {
  io.to(`agent:${d.agentId}`).emit('dispatch', d);
  io.emit('dispatch_log', d); // console opérateur (feed)
  trackPending(d);
  store.logEvent('dispatch', d);
  armAck(d);
}

function armAck(dispatch) {
  clearTimeout(ackTimers.get(dispatch.assignmentId));
  ackTimers.set(dispatch.assignmentId, setTimeout(() => onAckTimeout(dispatch), config.ackTimeoutMs));
}

// --- Re-route sur timeout (boucle d'accusé, F6) ----------------------------
function onAckTimeout(dispatch) {
  ackTimers.delete(dispatch.assignmentId);
  const ctx = incidentCtx.get(dispatch.incidentId);
  const asRec = state.assignments.find((a) => a.id === dispatch.assignmentId);
  if (!asRec || asRec.status === 'ack') return;
  asRec.status = 'timeout';
  clearPending(dispatch.agentId, dispatch.assignmentId);
  store.setAssignmentStatus(dispatch.assignmentId, 'timeout');

  const rc = ctx?.rerouteCount || new Map();
  const count = (rc.get(dispatch.role + dispatch.targetZone) || 0) + 1;
  if (!ctx || count > 2) {
    io.emit('coverage_warning', { zoneId: dispatch.targetZone, etaSec: 0, message: `Aucun accusé pour ${dispatch.targetZone} après re-routes. Intervention opérateur requise.` });
    return;
  }
  rc.set(dispatch.role + dispatch.targetZone, count);

  setStatus(state, dispatch.agentId, 'available'); // libère l'agent muet
  ctx.used.delete(dispatch.agentId);
  const excl = [...ctx.used];
  const next =
    dispatch.role === 'primary'
      ? candidatesPrimary(state, ctx.zoneId, ctx.skills).find((c) => !excl.includes(c.id))
      : candidatesBackfill(state, dispatch.targetZone, excl)[0];
  if (!next) {
    io.emit('coverage_warning', { zoneId: dispatch.targetZone, etaSec: 0, message: `Plus de candidat pour ${dispatch.targetZone}.` });
    return;
  }
  ctx.used.add(next.id);
  setStatus(state, next.id, dispatch.role === 'primary' ? 'responding' : 'backfilling');
  const newAs = { id: `as_r${state.assignments.length + 1}`, incident_id: dispatch.incidentId, agent_id: next.id, role: dispatch.role, target_zone: dispatch.targetZone, status: 'sent', sent_at: Date.now() };
  state.assignments.push(newAs);
  store.logAssignment(newAs);
  broadcastState();
  emitDispatch({ assignmentId: newAs.id, incidentId: dispatch.incidentId, role: dispatch.role, targetZone: dispatch.targetZone, agentId: next.id, text: `${dispatch.text} (re-route)`, audioUrl: dispatch.audioUrl, lang: dispatch.lang });
  console.log(`[reroute] ${dispatch.assignmentId} -> ${next.id} (${dispatch.role} ${dispatch.targetZone})`);
}

// --- Pipeline incident partagé (audio réel OU transcript simulé) -----------
async function runIncident({ audio, transcript, langHint }) {
  const incidentId = nextIncidentId(state);
  const res = await handleIncident({ state, audio, transcript, langHint, incidentId, now: Date.now() });
  commitAgents(state, res.nextState);
  state.incidents.push(res.incident);
  state.assignments.push(...res.assignments);

  incidentCtx.set(incidentId, {
    zoneId: res.incident.zone_id,
    skills: res.incident.skills_needed,
    used: new Set(res.assignments.map((a) => a.agent_id)),
    rerouteCount: new Map(),
  });

  store.logIncident(res.incident);
  for (const a of res.assignments) store.logAssignment(a);

  broadcastState();
  io.emit('incident', res.incident); // console opérateur : feed + justification
  for (const d of res.dispatches) emitDispatch(d);
  for (const w of res.warnings) io.emit('coverage_warning', w);
  console.log(`[incident ${incidentId}] "${res.incident.transcript}" -> primary ${res.incident.primary_id}` +
    `, ${res.dispatches.filter((d) => d.role === 'backfill').length} backfill, ${res.warnings.length} warning (LLM: ${res.decision._source})`);
  return res;
}

// --- Actions partagées WS <-> REST -----------------------------------------
function ackAssignment(assignmentId) {
  clearTimeout(ackTimers.get(assignmentId));
  ackTimers.delete(assignmentId);
  const as = state.assignments.find((a) => a.id === assignmentId);
  if (!as) return false;
  as.status = 'ack';
  clearPending(as.agent_id, assignmentId);
  store.setAssignmentStatus(assignmentId, 'ack');
  store.logEvent('ack', { assignmentId, agentId: as.agent_id });
  if (as.role === 'backfill') { setPosition(state, as.agent_id, as.target_zone); setStatus(state, as.agent_id, 'available'); }
  else setStatus(state, as.agent_id, 'responding');
  broadcastState();
  io.emit('ack_log', { assignmentId, agentId: as.agent_id });
  return true;
}

function applyOverride({ incidentId, newAgentId, reason }) {
  if (reason) addConstraint(state, { scope: 'global', rule_text: reason, source_override: incidentId });
  const inc = state.incidents.find((i) => i.id === incidentId);
  if (inc && newAgentId) {
    if (inc.primary_id) setStatus(state, inc.primary_id, 'available');
    inc.primary_id = newAgentId;
    setStatus(state, newAgentId, 'responding');
    const zoneName = zoneById(state, inc.zone_id)?.name || inc.zone_id;
    const as = { id: `as_ov${state.assignments.length + 1}`, incident_id: incidentId, agent_id: newAgentId, role: 'primary', target_zone: inc.zone_id, status: 'sent', sent_at: Date.now() };
    state.assignments.push(as);
    store.logAssignment(as);
    broadcastState();
    emitDispatch({ assignmentId: as.id, incidentId, role: 'primary', targetZone: inc.zone_id, agentId: newAgentId, text: `Override opérateur : ${zoneName}. Vas-y.`, audioUrl: null, lang: 'fr' });
  }
  store.logEvent('override', { incidentId, newAgentId, reason });
  io.emit('override_log', { incidentId, newAgentId, reason });
}

function doReset() {
  for (const t of ackTimers.values()) clearTimeout(t);
  ackTimers.clear();
  incidentCtx.clear();
  pendingByAgent.clear();
  state = buildState(loadSeed());
  store.logEvent('reset', {});
  broadcastState();
  console.log('[reset] état rechargé depuis le seed');
}

// Scénarios de démo pour l'API REST (miroir des boutons de la PWA).
function scenarioPayload(name = 'S2') {
  const S = {
    S1: { transcript: 'malaise au grand huit, une personne au sol', lang: 'fr' },
    S2: { transcript: 'arrêt cardiaque au manège extrême, il ne respire plus', lang: 'fr' },
    S3: { transcript: 'malaise à la zone enfants, personne inconsciente', lang: 'fr' },
    S4: { transcript: 'un hombre se desplomó en la entrada, no respira', lang: 'es' },
  };
  return S[String(name || 'S2').toUpperCase()] || S.S2;
}

// --- WS (Contrat A) --------------------------------------------------------
io.on('connection', (socket) => {
  socket.emit('state', serializeState(state));

  socket.on('hello', ({ agentId }) => {
    if (!agentId) return;
    socket.data.agentId = agentId;
    socket.join(`agent:${agentId}`);
    setStatus(state, agentId, 'available');
    broadcastState();
    // Replay des dispatchs non acquittés (téléphone qui a perdu le réseau puis revenu).
    const pend = pendingByAgent.get(agentId);
    if (pend?.size) {
      for (const d of pend.values()) socket.emit('dispatch', d);
      console.log(`[reconnect] replay ${pend.size} dispatch(s) -> ${agentId}`);
    }
  });

  socket.on('position', ({ agentId, zoneId }) => {
    if (setPosition(state, agentId, zoneId)) broadcastState();
  });

  socket.on('incident_audio', async ({ agentId, audio, ts, lang }) => {
    try { await runIncident({ audio, langHint: lang }); }
    catch (e) { console.error('[incident_audio] erreur', e); socket.emit('error_msg', { message: 'Traitement incident échoué', detail: String(e.message) }); }
  });

  socket.on('sim_incident', async ({ transcript, lang }) => {
    try { await runIncident({ transcript, langHint: lang }); }
    catch (e) { console.error('[sim_incident]', e); }
  });

  socket.on('ack', ({ assignmentId }) => ackAssignment(assignmentId));
  socket.on('operator_override', (payload) => applyOverride(payload || {}));
  socket.on('reset', () => doReset());

  socket.on('disconnect', () => { /* on garde l'agent dans l'état + ses dispatchs en attente (replay au retour) */ });
});

// --- Boot ------------------------------------------------------------------
server.listen(config.port, '0.0.0.0', () => {
  const proto = server instanceof https.Server ? 'https' : 'http';
  console.log(`\n🎛  CONDUCTOR coordinateur — ${proto}://localhost:${config.port}`);
  console.log(`   cerveau: ${config.mockCrusoe ? 'mock' : `Crusoe(${config.crusoe.model})`} · voix: ${config.mockGradium ? 'mock' : 'Gradium'} · log SQLite: ${store.enabled ? 'on' : 'off'}`);
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) console.log(`   LAN (${name}) : ${proto}://${a.address}:${config.port}`);
  }
  console.log('   REST: /health /api/state /api/incidents /api/demo/{sim_incident,reset} · WS Socket.io\n');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { store.close(); } catch {} server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500); });
}

export { app, io, server };

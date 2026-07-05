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

import { config, loadSeed, assertCrusoeLiveWorkflowOrExit, validateCrusoeLiveWorkflow } from './config.js';
import { buildState, serializeState, setPosition, setStatus, commitAgents, nextIncidentId, addConstraint } from './state.js';
import { candidatesPrimary, candidatesBackfill, zoneById, agentById } from './engine.js';
import { handleIncident } from './agent.js';
import { createStore } from './persistence.js';
import { prewarmCrusoe } from './integrations/crusoe.js';
import { speak } from './integrations/gradium.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let state = buildState(loadSeed());
const store = createStore(config.persist ? config.sqlitePath : null);

// Contexte runtime des incidents (timers d'accusé + re-route + replay reconnexion).
const ackTimers = new Map();       // assignmentId -> timeout
const incidentCtx = new Map();     // incidentId -> { zoneId, skills, used:Set, rerouteCount:Map }
const pendingByAgent = new Map();  // agentId -> Map(assignmentId -> dispatch)  (dispatchs non acquittés)
const pendingBackfills = new Map(); // incidentId -> [dispatch backfill] retenus jusqu'à l'accusé du primaire

// Densité de foule par zone (capteur BLE, scripts/crowd-density.js). Hors state :
// c'est de la télémétrie ambiante, pas du roster. zoneId -> dernier payload.
const crowdDensity = new Map();
const densityWarnedAt = new Map(); // zoneId -> ts (anti-spam)
const DENSITY_RATIO_ALERT = Number(process.env.DENSITY_RATIO_ALERT || 1.5);
const DENSITY_WARN_COOLDOWN_MS = Number(process.env.DENSITY_WARN_COOLDOWN_MS || 120000);

// --- Express : PWA + assets audio + API REST ------------------------------
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(resolve(ROOT, '../app/public')));               // PWA staff
app.use('/mock', express.static(resolve(ROOT, '../app/public/mock'))); // /mock/tts-sample.mp3
app.use('/tts', express.static(resolve(ROOT, 'tts-cache')));           // TTS générés
app.use('/sim', express.static(resolve(ROOT, '../simulator/dist')));   // simulateur 3D (vue live), build Vite base /sim/
app.use('/crowd', express.static(resolve(ROOT, '../crowd-density')));  // détecteur densité caméra (PR#4 Prakash, branché crowd_density)
app.get('/health', (_req, res) => {
  const crusoeLive = validateCrusoeLiveWorkflow();
  res.json({
    ok: true,
    useMocks: config.useMocks,
    mockCrusoe: config.mockCrusoe,
    mockGradium: config.mockGradium,
    persist: store.enabled,
    crusoe: {
      liveReady: crusoeLive.ok,
      model: config.crusoe.model,
      modelFallback: config.crusoe.modelFallback,
      allowedModels: config.crusoe.allowedModels,
      errors: crusoeLive.errors,
    },
  });
});
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
  store.logEvent('dispatch', d);
  // Les témoins (witness) ne sont ni acquittés ni ré-routés : pas de tracking/timer.
  if (d.role !== 'witness') { trackPending(d); armAck(d); }
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
    io.emit('coverage_warning', { zoneId: dispatch.targetZone, etaSec: 0, message: `No acknowledgement for ${dispatch.targetZone} after re-routes. Operator action required.` });
    return;
  }
  rc.set(dispatch.role + dispatch.targetZone, count);

  setStatus(state, dispatch.agentId, 'available'); // libère l'agent muet (redevient dispo pour d'AUTRES incidents)
  // On le GARDE dans ctx.used : le re-route doit viser un AUTRE agent, jamais rappeler le même
  // téléphone (sinon un primaire sur zone, trajet 0, serait re-sélectionné en boucle).
  const excl = [...ctx.used];
  const next =
    dispatch.role === 'primary'
      ? candidatesPrimary(state, ctx.zoneId, ctx.skills).find((c) => !excl.includes(c.id))
      : candidatesBackfill(state, dispatch.targetZone, excl)[0];
  if (!next) {
    io.emit('coverage_warning', { zoneId: dispatch.targetZone, etaSec: 0, message: `No more candidates for ${dispatch.targetZone}.` });
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
  // Backfill « post-accusé » : on émet le primaire + les témoins tout de suite, mais on RETIENT
  // les renforts jusqu'à ce que le primaire clique « je m'en occupe » (ou qu'un re-routé accuse).
  for (const d of res.dispatches) if (d.role !== 'backfill') emitDispatch(d);
  const heldBackfills = res.dispatches.filter((d) => d.role === 'backfill');
  if (heldBackfills.length) {
    pendingBackfills.set(incidentId, heldBackfills);
    // Le renfort reste 'available' (pas encore appelé) — sinon il « bougerait » avant de sonner.
    for (const d of heldBackfills) setStatus(state, d.agentId, 'available');
    broadcastState();
  }
  for (const w of res.warnings) io.emit('coverage_warning', w);
  const nWitness = res.dispatches.filter((d) => d.role === 'witness').length;
  console.log(`[incident ${incidentId}] "${res.incident.transcript}" -> primary ${res.incident.primary_id}` +
    `, ${res.dispatches.filter((d) => d.role === 'backfill').length} backfill, ${nWitness} témoin(s), ${res.warnings.length} warning` +
    ` (LLM: ${res.decision._source}${res.decision._model ? ` / ${res.decision._model}` : ''})`);
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
  // Un primaire (initial OU re-routé) qui accuse déclenche l'appel du/des renfort(s) retenu(s).
  if (as.role === 'primary') releasePendingBackfills(as.incident_id);
  broadcastState();
  io.emit('ack_log', { assignmentId, agentId: as.agent_id });
  return true;
}

// Le primaire a accusé -> on appelle maintenant le(s) renfort(s) pré-calculé(s) et retenu(s).
// emitDispatch arme leur propre timer d'accusé (le renfort peut lui aussi être re-routé s'il ne répond pas).
function releasePendingBackfills(incidentId) {
  const held = pendingBackfills.get(incidentId);
  if (!held?.length) return;
  pendingBackfills.delete(incidentId);
  for (const d of held) {
    setStatus(state, d.agentId, 'backfilling');
    emitDispatch(d);
  }
  broadcastState();
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

// Dispatch manuel opérateur : envoie un agent choisi vers une zone (renfort). Réutilise emitDispatch (accusé + TTS + persistance).
async function dispatchAgentToZone({ agentId, zoneId, reason, textOverride }) {
  const agent = agentById(state, agentId);
  if (!agent || !zoneById(state, zoneId)) return false;
  if (reason) addConstraint(state, { scope: 'zone', rule_text: reason, source_override: zoneId });
  setStatus(state, agentId, 'backfilling');
  const as = { id: `as_op${state.assignments.length + 1}`, incident_id: null, agent_id: agentId, role: 'backfill', target_zone: zoneId, status: 'sent', sent_at: Date.now() };
  state.assignments.push(as);
  store.logAssignment(as);
  broadcastState();
  const zoneName = zoneById(state, zoneId)?.name || zoneId;
  const lang = agent.languages?.[0] || 'fr';
  const text = textOverride || `Backfill requested: move to ${zoneName} to keep coverage.`;
  let audioUrl = null;
  try { audioUrl = (await speak(text, lang, { id: as.id })).audioUrl; } catch (e) { console.warn(`[operator] TTS KO ${e.message}`); }
  emitDispatch({ assignmentId: as.id, incidentId: null, role: 'backfill', targetZone: zoneId, agentId, text, audioUrl, lang });
  return true;
}

function doReset() {
  for (const t of ackTimers.values()) clearTimeout(t);
  ackTimers.clear();
  incidentCtx.clear();
  pendingByAgent.clear();
  pendingBackfills.clear();
  densityWarnedAt.clear();
  crowdDensity.clear();
  state = buildState(loadSeed());
  store.logEvent('reset', {});
  broadcastState();
  console.log('[reset] état rechargé depuis le seed');
}

// Scénarios de démo pour l'API REST (miroir des boutons de la PWA).
function scenarioPayload(name = 'S2') {
  const S = {
    S1: { transcript: 'someone feeling faint at the roller coaster, a person on the ground', lang: 'en' },
    S2: { transcript: 'cardiac arrest at the extreme ride, he is not breathing', lang: 'en' },
    S3: { transcript: 'medical emergency at the kids zone, person unconscious', lang: 'en' },
    S4: { transcript: 'a man collapsed at the entrance, he is not breathing', lang: 'en' },
  };
  return S[String(name || 'S2').toUpperCase()] || S.S2;
}

// --- WS (Contrat A) --------------------------------------------------------
io.on('connection', (socket) => {
  socket.emit('state', serializeState(state));

  socket.on('hello', ({ agentId }) => {
    if (!agentId) return;
    // Changement de profil sur un téléphone : quitter l'ancienne room agent:* sinon le
    // téléphone continue de recevoir les dispatchs de l'ancien profil (défaut A7 inclus).
    for (const r of socket.rooms) if (r.startsWith('agent:') && r !== `agent:${agentId}`) socket.leave(r);
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

  // Capteur de densité (BLE) — télémétrie ambiante rebroadcastée à tous (carte +
  // console op). Si densité anormale (ratio vs baseline) SUR une zone sans marge
  // de couverture -> advisory proactive (même canal que F5, aucun nouveau contrat).
  socket.on('crowd_density', (payload) => {
    if (!payload?.zoneId || typeof payload.deviceCount !== 'number') return;
    crowdDensity.set(payload.zoneId, payload);
    io.emit('crowd_density', payload);

    const z = zoneById(state, payload.zoneId);
    if (!z || !payload.ratio || payload.ratio < DENSITY_RATIO_ALERT) return;
    const zoneAgents = state.agents.filter((a) => a.current_zone === z.id && a.status === 'available');
    const surplus = zoneAgents.length - z.required_min;
    const last = densityWarnedAt.get(z.id) || 0;
    if (surplus <= 0 && Date.now() - last > DENSITY_WARN_COOLDOWN_MS) {
      densityWarnedAt.set(z.id, Date.now());
      io.emit('coverage_warning', {
        zoneId: z.id,
        etaSec: 0,
        message: `Unusual density at ${z.name} (x${payload.ratio} vs normal, ${payload.deviceCount} devices) with no coverage margin. Pre-position a backfill?`,
      });
      console.log(`[density] alerte ${z.id} ratio=${payload.ratio} count=${payload.deviceCount}`);
    }
  });

  socket.on('incident_audio', async ({ agentId, audio, ts, lang }) => {
    console.log(`[incident_audio] de ${agentId} : ${audio ? Math.round(audio.length / 1024) : 0} Ko (b64), lang=${lang}`);
    try { await runIncident({ audio, langHint: lang }); }
    catch (e) {
      console.error('[incident_audio] erreur', e);
      const empty = /STT vide|transcription vide/i.test(String(e.message));
      socket.emit('error_msg', { message: empty ? "Didn't catch that — tap, speak ~2s, then tap again." : 'Incident processing failed', detail: String(e.message) });
    }
  });

  socket.on('sim_incident', async ({ transcript, lang }) => {
    try { await runIncident({ transcript, langHint: lang }); }
    catch (e) { console.error('[sim_incident]', e); }
  });

  socket.on('ack', ({ assignmentId }) => ackAssignment(assignmentId));
  socket.on('operator_override', (payload) => applyOverride(payload || {}));

  // Console opérateur : réponse à une alerte de couverture (F5). accepter = on assume le
  // trou (log) ; réassigner = on envoie un agent choisi combler la zone.
  socket.on('operator_action', async ({ action, zoneId, agentId, reason }) => {
    try {
      if (action === 'accept') {
        store.logEvent('operator_accept', { zoneId, reason });
        io.emit('operator_log', { action: 'accept', zoneId, reason });
      } else if (action === 'reassign' && agentId && zoneId) {
        const ok = await dispatchAgentToZone({ agentId, zoneId, reason });
        io.emit('operator_log', { action: 'reassign', zoneId, agentId, reason, ok });
      }
    } catch (e) { console.error('[operator_action]', e); }
  });

  socket.on('reset', () => doReset());

  socket.on('disconnect', () => { /* on garde l'agent dans l'état + ses dispatchs en attente (replay au retour) */ });
});

// Filet anti-crash démo : un appel foireux (audio corrompu, ffmpeg, etc.) ne doit JAMAIS tuer
// le serveur et laisser tous les téléphones tourner à l'infini. On log et on continue.
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.stack || e?.message || e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.stack || e?.message || e));

// --- Boot ------------------------------------------------------------------
assertCrusoeLiveWorkflowOrExit();

server.listen(config.port, '0.0.0.0', () => {
  const proto = server instanceof https.Server ? 'https' : 'http';
  console.log(`\n🎛  CONDUCTOR coordinateur — ${proto}://localhost:${config.port}`);
  console.log(`   cerveau: ${config.mockCrusoe ? 'mock' : `Crusoe(${config.crusoe.model})`} · voix: ${config.mockGradium ? 'mock' : 'Gradium'} · log SQLite: ${store.enabled ? 'on' : 'off'}`);
  if (!config.mockCrusoe) {
    console.log(`   [crusoe] fallback: ${config.crusoe.modelFallback} · allowlist: ${config.crusoe.allowedModels.length} modèles`);
    prewarmCrusoe()
      .then((ms) => ms != null && console.log(`   [crusoe] pré-chauffe OK (${ms} ms)`))
      .catch((e) => console.warn(`   [crusoe] pré-chauffe échouée: ${e.message}`));
  }
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) console.log(`   LAN (${name}) : ${proto}://${a.address}:${config.port}`);
  }
  console.log('   REST: /health /api/state /api/incidents /api/demo/{sim_incident,reset} · WS Socket.io\n');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { store.close(); } catch {} server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500); });
}

export { app, io, server };

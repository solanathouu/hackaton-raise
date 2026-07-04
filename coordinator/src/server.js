// server.js — Coordinateur temps réel. Détient l'état, orchestre le pipeline, sert la PWA.
// Local-first : tourne sur un laptop, HTTPS mkcert (micro mobile), tout sur réseau local.
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
import { candidatesPrimary, candidatesBackfill, zoneById } from './engine.js';
import { computeRepositionHints, hintForAgentId, resolveGpsZone } from './guidance.js';
import { logPosition } from './position-log.js';
import { handleIncident } from './agent.js';
import { prewarmCrusoe } from './integrations/crusoe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let state = buildState(loadSeed());

// Contexte runtime des incidents (timers d'accusé + re-route).
const ackTimers = new Map();       // assignmentId -> timeout
const incidentCtx = new Map();     // incidentId -> { zoneId, skills, used:Set, rerouteCount:Map }

// --- Express : PWA + assets audio -----------------------------------------
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(resolve(ROOT, '../app/public')));           // PWA staff
app.use('/mock', express.static(resolve(ROOT, '../app/public/mock'))); // /mock/tts-sample.mp3
app.use('/tts', express.static(resolve(ROOT, 'tts-cache')));       // TTS générés
app.get('/health', (_req, res) => {
  const crusoeLive = validateCrusoeLiveWorkflow();
  res.json({
    ok: true,
    useMocks: config.useMocks,
    mockCrusoe: config.mockCrusoe,
    mockGradium: config.mockGradium,
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
app.get('/api/position-logs', (_req, res) => {
  const limit = Math.min(Number(_req.query.limit) || 50, 200);
  const path = resolve(ROOT, config.gps.logPath);
  if (!existsSync(path)) return res.json([]);
  try {
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
    res.json(lines.slice(-limit).map((l) => JSON.parse(l)).reverse());
  } catch {
    res.json([]);
  }
});

// --- HTTP(S) server + Socket.io -------------------------------------------
const server = createServer(app);
const io = new SocketServer(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e7 });

function createServer(expressApp) {
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

function emitGuidance(hint) {
  if (!hint) return;
  io.to(`agent:${hint.agentId}`).emit('guidance', hint);
  io.emit('guidance_log', hint);
}

function emitRepositionGuidance(agentId = null) {
  if (agentId) {
    emitGuidance(hintForAgentId(state, agentId));
    return;
  }
  for (const h of computeRepositionHints(state)) emitGuidance(h);
}

function applyPositionUpdate(agentId, zoneId, meta = {}) {
  if (!setPosition(state, agentId, zoneId, meta)) return false;
  broadcastState();
  emitRepositionGuidance(agentId);
  const payload = {
    agentId,
    zoneId,
    lat: meta.lat ?? null,
    lon: meta.lon ?? null,
    accuracy: meta.accuracy ?? null,
    distanceM: meta.distanceM ?? null,
    source: meta.source || 'manual',
    at: Date.now(),
  };
  logPosition(payload);
  io.emit('position_log', payload);
  return true;
}

// --- Émission d'un dispatch + armement de l'accusé -------------------------
function emitDispatch(d) {
  io.to(`agent:${d.agentId}`).emit('dispatch', d);
  io.emit('dispatch_log', d);
  if (d.role !== 'witness') armAck(d);
}

function armAck(dispatch) {
  clearTimeout(ackTimers.get(dispatch.assignmentId));
  ackTimers.set(
    dispatch.assignmentId,
    setTimeout(() => onAckTimeout(dispatch), config.ackTimeoutMs),
  );
}

// --- Re-route sur timeout (boucle d'accusé, F6) ----------------------------
function onAckTimeout(dispatch) {
  ackTimers.delete(dispatch.assignmentId);
  const ctx = incidentCtx.get(dispatch.incidentId);
  const asRec = state.assignments.find((a) => a.id === dispatch.assignmentId);
  if (!asRec || asRec.status === 'ack') return;
  asRec.status = 'timeout';

  const rc = ctx?.rerouteCount || new Map();
  const count = (rc.get(dispatch.role + dispatch.targetZone) || 0) + 1;
  if (!ctx || count > 2) {
    io.emit('coverage_warning', {
      zoneId: dispatch.targetZone,
      etaSec: 0,
      message: `Aucun accusé pour ${dispatch.targetZone} après re-routes. Intervention opérateur requise.`,
    });
    return;
  }
  rc.set(dispatch.role + dispatch.targetZone, count);

  // libère l'agent qui n'a pas répondu, choisit le suivant
  setStatus(state, dispatch.agentId, 'available');
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
  broadcastState();
  emitDispatch({
    assignmentId: newAs.id, incidentId: dispatch.incidentId, role: dispatch.role,
    targetZone: dispatch.targetZone, agentId: next.id,
    text: `${dispatch.text} (re-route)`, audioUrl: dispatch.audioUrl, lang: dispatch.lang,
  });
  console.log(`[reroute] ${dispatch.assignmentId} -> ${next.id} (${dispatch.role} ${dispatch.targetZone})`);
}

// --- Pipeline incident partagé (audio réel OU transcript simulé) -----------
let incidentQueue = Promise.resolve();

async function runIncident(params) {
  const run = incidentQueue.then(() => runIncidentInner(params));
  incidentQueue = run.catch(() => {});
  return run;
}

async function runIncidentInner({ audio, transcript, langHint }) {
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

  broadcastState();
  io.emit('incident', res.incident); // console opérateur : feed + justification
  for (const d of res.dispatches) emitDispatch(d);
  for (const w of res.warnings) io.emit('coverage_warning', w);
  emitRepositionGuidance();
  console.log(`[incident ${incidentId}] "${res.incident.transcript}" -> primary ${res.incident.primary_id}` +
    `, ${res.dispatches.filter((d) => d.role === 'backfill').length} backfill, ${res.warnings.length} warning` +
    ` (LLM: ${res.decision._source}${res.decision._model ? ` / ${res.decision._model}` : ''})`);
  return res;
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
  });

  socket.on('position', ({ agentId, zoneId }) => {
    applyPositionUpdate(agentId, zoneId, { source: 'manual' });
  });

  socket.on('gps_position', ({ agentId, lat, lon, accuracy }) => {
    const hit = resolveGpsZone(state.zones, lat, lon, config.gps.maxDistanceM);
    if (!hit) {
      logPosition({ agentId, lat, lon, accuracy, source: 'gps_rejected' });
      socket.emit('error_msg', {
        message: `GPS hors parc (>${config.gps.maxDistanceM} m d'une zone). Renseigne PARK_LAT/PARK_LON sur le serveur.`,
      });
      return;
    }
    applyPositionUpdate(agentId, hit.zoneId, {
      lat,
      lon,
      accuracy,
      distanceM: hit.distanceM,
      source: 'gps',
    });
  });

  socket.on('scan_reposition', () => {
    const hints = computeRepositionHints(state);
    emitRepositionGuidance();
    io.emit('guidance_log', {
      agentId: null,
      message: `Scan repositionnement : ${hints.length} suggestion(s) émise(s).`,
      reason: 'scan',
    });
  });

  socket.on('incident_audio', async ({ agentId, audio, ts, lang }) => {
    try {
      await runIncident({ audio, langHint: lang });
    } catch (e) {
      console.error('[incident_audio] erreur', e);
      socket.emit('error_msg', { message: 'Traitement incident échoué', detail: String(e.message) });
    }
  });

  // Helper démo : déclenche un incident depuis un transcript (sans micro).
  socket.on('sim_incident', async ({ transcript, lang }) => {
    try { await runIncident({ transcript, langHint: lang }); }
    catch (e) { console.error('[sim_incident]', e); }
  });

  socket.on('ack', ({ assignmentId }) => {
    clearTimeout(ackTimers.get(assignmentId));
    ackTimers.delete(assignmentId);
    const as = state.assignments.find((a) => a.id === assignmentId);
    if (!as) return;
    as.status = 'ack';
    if (as.role === 'backfill') { setPosition(state, as.agent_id, as.target_zone); setStatus(state, as.agent_id, 'available'); }
    else setStatus(state, as.agent_id, 'responding');
    broadcastState();
    io.emit('ack_log', { assignmentId, agentId: as.agent_id });
  });

  socket.on('operator_override', ({ incidentId, newAgentId, reason }) => {
    if (reason) addConstraint(state, { scope: 'global', rule_text: reason, source_override: incidentId });
    const inc = state.incidents.find((i) => i.id === incidentId);
    if (inc && newAgentId) {
      const old = inc.primary_id;
      if (old) { setStatus(state, old, 'available'); }
      inc.primary_id = newAgentId;
      setStatus(state, newAgentId, 'responding');
      const zoneName = zoneById(state, inc.zone_id)?.name || inc.zone_id;
      const as = { id: `as_ov${state.assignments.length + 1}`, incident_id: incidentId, agent_id: newAgentId, role: 'primary', target_zone: inc.zone_id, status: 'sent', sent_at: Date.now() };
      state.assignments.push(as);
      broadcastState();
      emitDispatch({ assignmentId: as.id, incidentId, role: 'primary', targetZone: inc.zone_id, agentId: newAgentId, text: `Override opérateur : ${zoneName}. Vas-y.`, audioUrl: null, lang: 'fr' });
    }
    io.emit('override_log', { incidentId, newAgentId, reason });
  });

  // Helper démo : reset état depuis le seed (répétitions).
  socket.on('reset', () => {
    for (const t of ackTimers.values()) clearTimeout(t);
    ackTimers.clear(); incidentCtx.clear();
    state = buildState(loadSeed());
    broadcastState();
    console.log('[reset] état rechargé depuis le seed');
  });

  socket.on('disconnect', () => {
    if (socket.data.agentId) { /* on garde l'agent dans l'état (app rouverte) */ }
  });
});

// --- Boot ------------------------------------------------------------------
assertCrusoeLiveWorkflowOrExit();

server.listen(config.port, '0.0.0.0', () => {
  const proto = server instanceof https.Server ? 'https' : 'http';
  console.log(`\n🎛  Weave coordinateur — ${proto}://localhost:${config.port}`);
  console.log(
    `   cerveau: ${config.mockCrusoe ? 'mock' : `Crusoe(${config.crusoe.model})`} · voix: ${config.mockGradium ? 'mock' : 'Gradium'}`,
  );
  if (!config.mockCrusoe) {
    console.log(`   [crusoe] fallback: ${config.crusoe.modelFallback}`);
    console.log(`   [crusoe] allowlist: ${config.crusoe.allowedModels.length} modèles autorisés`);
    prewarmCrusoe()
      .then((ms) => ms != null && console.log(`   [crusoe] pré-chauffe OK (${ms} ms)`))
      .catch((e) => console.warn(`   [crusoe] pré-chauffe échouée: ${e.message}`));
  }
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) console.log(`   LAN (${name}) : ${proto}://${a.address}:${config.port}`);
  }
  console.log('   /health · /api/state · WS Socket.io\n');
});

export { app, io, server };

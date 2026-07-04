// liveEngine.js — Adaptateur LECTURE SEULE : branche le simulateur 3D sur le VRAI coordinateur
// (le cerveau) via socket.io. Drop-in de DispatchEngine : même interface `on/emit` + mêmes
// méthodes/props consommées par le renderer (main.js), mais alimenté par le Contrat A (WS) au
// lieu de calculer localement. Le 3D devient une VUE LIVE des actions faites sur le cerveau.
//
// Vue seule : les contrôles opérateur du 3D sont des no-ops (le vrai contrôle = console op /
// téléphones). Voix = synthèse navigateur (inchangée : on émet `speak {speaker, text}`).
import { io } from "socket.io-client";
import { zoneSeed, agentSeed } from "./data.js";

const RESPONSE_SPEEDUP = 11; // aligné sur engine.js/main.js

// Graphe statique (adjacence de data.js) pour le pathfinding des déplacements.
function buildGraph() {
  const g = new Map();
  for (const z of zoneSeed) g.set(z.id, (z.adjacency || []).map((e) => ({ to: e.z, time: e.t })));
  return g;
}
const seedZoneById = new Map(zoneSeed.map((z) => [z.id, z]));

export class LiveCoordinatorEngine extends EventTarget {
  constructor() {
    super();
    this._graph = buildGraph();
    this._elapsed = 0;
    this._incidentSeen = new Set();
    this._initMirror();
    this._connect();
  }

  // --- interface event-bus (identique à DispatchEngine) ---
  on(type, handler) {
    this.addEventListener(type, (event) => handler(event.detail));
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // Miroir initial depuis le seed (mêmes variables que le moteur demo : camelCase), pour que le
  // renderer ait un état cohérent avant le 1er `state` du coordinateur.
  _initMirror() {
    this.zones = zoneSeed.map((z) => ({
      id: z.id, name: z.name, short: z.short, requiredMin: z.requiredMin,
      requiredSkills: [...z.requiredSkills], pos: z.pos, color: z.color,
      adjacency: z.adjacency, headcount: 0, surplus: 0,
    }));
    this.zoneById = new Map(this.zones.map((z) => [z.id, z]));
    this.agents = agentSeed.map((a, i) => ({
      ...a, status: "available", coveringZone: a.isReserve ? null : a.currentZone,
      assignedCover: false, route: null, eta: 0, labelOffset: i % 2 ? 0.7 : -0.7,
    }));
    this.agentById = new Map(this.agents.map((a) => [a.id, a]));
    this.incidents = [];
  }

  zone(id) {
    return this.zoneById.get(id);
  }

  // --- connexion au coordinateur (même origine par défaut ; ?coordinator=URL pour le dev Vite) ---
  _connect() {
    const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    const url = params.get("coordinator") || undefined; // undefined = same-origin
    this.socket = io(url, { transports: ["websocket"] });
    this.socket.on("state", (s) => this._onState(s));
    this.socket.on("incident", (i) => this._onIncident(i));
    this.socket.on("dispatch_log", (d) => this._onDispatch(d));
    this.socket.on("coverage_warning", (w) => this._onWarning(w));
    this.socket.on("ack_log", (a) => this._onAck(a));
    // Densité de foule (capteur BLE / simulateur) -> heat visuel sur la zone.
    this.socket.on("crowd_density", (p) => {
      if (p?.zoneId) this.emit("density", { zoneId: p.zoneId, ratio: p.ratio || 0, deviceCount: p.deviceCount });
    });
    this.socket.on("connect", () => {
      this.emit("connection", { connected: true });
      this.emit("decision", { kind: "neutral", title: "Coordinateur connecté", body: "Vue live du cerveau active.", tone: "neutral" });
    });
    this.socket.on("disconnect", () => {
      this.emit("connection", { connected: false });
      this.emit("decision", { kind: "warning", title: "Coordinateur déconnecté", body: "La vue n'est plus alimentée.", tone: "danger" });
    });
  }

  // `state` (Contrat A) : source de vérité de la couverture. On met à jour le miroir et on ré-émet
  // `coverage`. On NE touche PAS la position d'un agent en transit (status != available) pour éviter
  // que la vue ne le "snap" en arrière pendant son animation.
  _onState(state) {
    for (const cz of state.zones || []) {
      const mz = this.zoneById.get(cz.id);
      if (!mz) continue;
      mz.name = cz.name;
      mz.requiredMin = cz.required_min;
      mz.requiredSkills = cz.required_skills || [];
      mz.headcount = cz.headcount;
      mz.surplus = cz.surplus;
      if (cz.adjacency) mz.adjacency = cz.adjacency;
    }
    for (const ca of state.agents || []) {
      let ma = this.agentById.get(ca.id);
      if (!ma) {
        ma = { id: ca.id, name: ca.name, skills: ca.skills, languages: ca.languages, isReserve: ca.is_reserve,
          homeZone: null, currentZone: ca.current_zone, status: ca.status, coveringZone: null,
          assignedCover: false, route: null, eta: 0, labelOffset: this.agents.length % 2 ? 0.7 : -0.7 };
        this.agents.push(ma);
        this.agentById.set(ma.id, ma);
      }
      ma.name = ca.name; ma.skills = ca.skills; ma.languages = ca.languages; ma.isReserve = ca.is_reserve; ma.status = ca.status;
      if (ca.status === "available") {
        ma.currentZone = ca.current_zone; // position "posée" = autoritaire
        ma.coveringZone = ca.current_zone;
        ma.assignedCover = ma.isReserve;
      } else {
        ma.coveringZone = null; // en transit / occupé : ne couvre pas, on garde sa position d'anim
      }
    }
    this.emit("coverage", this.getCoverage(false));
  }

  // Couverture au format attendu par le renderer, dérivée des chiffres AUTORITAIRES du coordinateur.
  getCoverage() {
    return this.zones.map((z) => {
      const here = this.agents.filter((a) => a.currentZone === z.id && a.status === "available");
      const covered = new Set(here.flatMap((a) => a.skills || []));
      const missingSkills = (z.requiredSkills || []).filter((s) => !covered.has(s));
      return {
        zoneId: z.id, name: z.name, requiredMin: z.requiredMin, requiredSkills: z.requiredSkills,
        headcount: z.headcount, actualHeadcount: z.headcount, incoming: 0, surplus: z.surplus,
        missingSkills, agents: here, ok: z.headcount >= z.requiredMin && missingSkills.length === 0,
      };
    });
  }

  _onIncident(inc) {
    if (!inc?.id || this._incidentSeen.has(inc.id)) return;
    this._incidentSeen.add(inc.id);
    const zone = this.zoneById.get(inc.zone_id) || { name: inc.zone_id };
    const incident = {
      id: inc.id, zoneId: inc.zone_id, zoneName: zone.name, transcript: inc.transcript || "",
      language: inc.language || "fr", type: inc.type || "incident", skillsNeeded: inc.skills_needed || [],
      severity: inc.severity || 3, status: "triaging", primaryId: inc.primary_id || null, backfills: [],
      warnings: inc.warning ? [inc.warning] : [], startedAt: this._elapsed,
      // Offset patient DÉTERMINISTE (hash de l'id) : même position sur tous les écrans connectés.
      patientOffset: (() => {
        let h = 0;
        for (const c of String(inc.id)) h = (h * 31 + c.charCodeAt(0)) % 9973;
        return [((h % 27) / 26 - 0.5) * 2.6, 0, (((h >> 3) % 27) / 26 - 0.5) * 2.6];
      })(),
    };
    this.incidents.push(incident);
    if (this.incidents.length > 50) this.incidents.shift(); // borne mémoire (session grand écran)
    this.emit("incident", { incident });
    this.emit("decision", {
      kind: "parse", title: `Incident : ${zone.name}`,
      body: `${String(incident.type).replaceAll("_", " ")} · ${incident.skillsNeeded.join(", ") || "—"} · sévérité ${incident.severity}/5`,
      tone: "hot",
    });
    if (inc.justification) this.emit("decision", { kind: "parse", title: "Justification", body: inc.justification, tone: "neutral" });
    if (inc.degraded) this.emit("decision", { kind: "warning", title: "Mode dégradé", body: "Crusoe injoignable — dispatch déterministe local.", tone: "warning" });
    // Badges HUD : état du cerveau (modèle utilisé / dégradé) porté par chaque incident.
    this.emit("brain", { degraded: !!inc.degraded, model: inc.model || null, source: inc.source || null });
  }

  // `dispatch_log` (broadcast) : anime le déplacement de l'agent. Les TÉMOINS ne bougent pas (ignorés).
  _onDispatch(d) {
    if (!d?.agentId || d.role === "witness") return;
    const agent = this.agentById.get(d.agentId);
    if (!agent) return;
    const path = this.shortestPath(agent.currentZone, d.targetZone);
    this.emit("decision", {
      kind: d.role === "primary" ? "dispatch" : "backfill",
      title: `${agent.name} → ${this.zone(d.targetZone)?.name || d.targetZone}`,
      body: d.text || "", tone: "success",
    });
    if (d.text) this.emit("speak", { speaker: agent.name, text: d.text });
    agent.targetZone = d.targetZone;
    this.emit("move", {
      agentId: agent.id, role: d.role, incidentId: d.incidentId,
      path: path.zones, targetZone: d.targetZone, travelTime: path.time,
    });
  }

  _onWarning(w) {
    this.emit("decision", {
      kind: "warning", zoneId: w.zoneId, title: `Alerte couverture : ${this.zone(w.zoneId)?.name || w.zoneId}`,
      body: w.message || "", tone: "danger",
    });
    if (w.message) this.emit("speak", { speaker: "Conductor", text: w.message });
  }

  _onAck(a) {
    const agent = this.agentById.get(a.agentId);
    this.emit("ack", { agentId: a.agentId });
    this.emit("decision", { kind: "ack", title: `${agent?.name || a.agentId} a accusé`, body: "Intervention confirmée.", tone: "success" });
  }

  // Dijkstra sur l'adjacence (identique à DispatchEngine.shortestPath).
  shortestPath(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return { time: 0, zones: [fromId || toId] };
    const dist = new Map();
    const prev = new Map();
    const unvisited = new Set(zoneSeed.map((z) => z.id));
    for (const z of zoneSeed) dist.set(z.id, Infinity);
    dist.set(fromId, 0);
    while (unvisited.size) {
      let current = null;
      let best = Infinity;
      for (const id of unvisited) {
        const s = dist.get(id);
        if (s < best) { best = s; current = id; }
      }
      if (current === null || current === toId) break;
      unvisited.delete(current);
      for (const edge of this._graph.get(current) || []) {
        const cand = dist.get(current) + edge.time;
        if (cand < dist.get(edge.to)) { dist.set(edge.to, cand); prev.set(edge.to, current); }
      }
    }
    const zones = [];
    let cursor = toId;
    while (cursor) {
      zones.unshift(cursor);
      cursor = prev.get(cursor);
      if (cursor === fromId) { zones.unshift(cursor); break; }
    }
    if (zones[0] !== fromId) return { time: 60, zones: [fromId, toId] };
    return { time: dist.get(toId), zones };
  }

  // --- Callbacks de fin d'animation (rappelés par le renderer) ---
  // On met à jour la position dans le miroir. Pas de choréo ambulance en live (le coordinateur
  // ne la modélise pas) : la vue reste fidèle aux vrais événements.
  completeMove(agentId, role, incidentId, targetZone) {
    const agent = this.agentById.get(agentId);
    if (!agent) return;
    agent.currentZone = targetZone;
    agent.targetZone = null;
    if (role === "backfill") {
      agent.status = "available";
      agent.coveringZone = targetZone;
      this.emit("decision", {
        kind: "restore", title: `${this.zone(targetZone)?.name || targetZone} — couverture rétablie`,
        body: `${agent.name} couvre la zone. Le trou est comblé.`, tone: "success",
      });
      this.emit("coverage", this.getCoverage());
    } else if (role === "primary") {
      agent.status = "treating";
      const inc = this.incidents.find((i) => i.id === incidentId);
      if (inc) inc.status = "on_scene";
      this.emit("decision", { kind: "onscene", title: `${agent.name} sur place`, body: "Intervention en cours.", tone: "hot" });
    }
  }
  completeAmbulance() { /* pas d'ambulance en mode live */ }

  // --- Contrôles opérateur : NO-OPS (vue seule ; le contrôle réel passe par la console op) ---
  triggerIncident() { /* vue seule */ }
  setForceTimeout() { /* vue seule */ }
  setConstraint() { /* vue seule */ }
  reset() {
    this.incidents = [];
    this._incidentSeen.clear();
    this.emit("reset", {}); // symétrie de contrat avec le moteur demo (balises 3D nettoyées)
    this.emit("coverage", this.getCoverage());
  }
  tick(deltaSeconds) {
    this._elapsed += deltaSeconds;
  }
}

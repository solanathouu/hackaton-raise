import {
  applyAssignmentPlan,
  applyDecision,
  buildSnapshot,
  coverageWarning,
  createTravelIndex,
  findReplacementForAssignment,
  publicState
} from "./engine.js";
import { createIdFactory } from "./ids.js";
import { findAgent, findZone, pendingAssignmentsForAgent, resetState } from "./state.js";
import { transcribe, speak } from "./integrations/gradium.js";
import { decide } from "./integrations/crusoe.js";

export class CoordinatorRuntime {
  constructor({ state, seed, store, config }) {
    this.state = state;
    this.seed = seed;
    this.store = store;
    this.config = config;
    this.io = null;
    this.incidentIds = createIdFactory("inc");
    this.assignmentIds = createIdFactory("as");
    this.constraintIds = createIdFactory("constraint");
    this.ackTimers = new Map();
    this.reconnectTimers = new Map();

    const persistedConstraints = this.store.loadConstraints();
    if (persistedConstraints.length) this.state.constraints = persistedConstraints;
  }

  attachIo(io) {
    this.io = io;
  }

  publicState() {
    return publicState(this.state);
  }

  broadcastState() {
    this.io?.emit("state", this.publicState());
  }

  logEvent(type, payload) {
    this.store.logEvent(type, payload);
  }

  handleConnection(socket) {
    socket.emit("state", this.publicState());

    socket.on("hello", (payload = {}, callback) => {
      this.handleHello(socket, payload);
      callback?.({ ok: true });
    });

    socket.on("operator_hello", (payload = {}, callback) => {
      socket.join("operators");
      socket.data.operator = true;
      socket.emit("state", this.publicState());
      callback?.({ ok: true, role: "operator" });
    });

    socket.on("position", (payload = {}, callback) => {
      const result = this.handlePosition(payload);
      callback?.(result);
    });

    socket.on("incident_audio", async (payload = {}, callback) => {
      try {
        const result = await this.handleIncidentAudio(payload);
        callback?.({ ok: true, incidentId: result.incident.id });
      } catch (error) {
        socket.emit("pipeline_error", { message: error.message });
        callback?.({ ok: false, error: error.message });
      }
    });

    socket.on("ack", (payload = {}, callback) => {
      const result = this.handleAck(payload.assignmentId);
      callback?.(result);
    });

    socket.on("operator_override", async (payload = {}, callback) => {
      try {
        const result = await this.handleOperatorOverride(payload);
        callback?.({ ok: true, assignmentId: result.assignment?.id });
      } catch (error) {
        socket.emit("pipeline_error", { message: error.message });
        callback?.({ ok: false, error: error.message });
      }
    });

    socket.on("request_state", (callback) => {
      const snapshot = this.publicState();
      socket.emit("state", snapshot);
      callback?.({ ok: true, state: snapshot });
    });

    socket.on("disconnect", () => this.handleDisconnect(socket));
  }

  handleHello(socket, payload = {}) {
    const agent = findAgent(this.state, payload.agentId);
    if (!agent) {
      socket.emit("pipeline_error", { message: `Unknown agent ${payload.agentId}` });
      return;
    }

    const existingTimer = this.reconnectTimers.get(agent.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.reconnectTimers.delete(agent.id);
    }

    socket.data.agentId = agent.id;
    socket.join(`agent:${agent.id}`);
    agent.connected = true;
    agent.socket_id = socket.id;
    agent.last_seen = new Date().toISOString();
    if (agent.status === "offline") agent.status = "available";

    socket.emit("state", this.publicState());
    for (const assignment of pendingAssignmentsForAgent(this.state, agent.id)) {
      if (assignment.payload) socket.emit("dispatch", assignment.payload);
    }

    this.logEvent("agent_hello", { agentId: agent.id, socketId: socket.id });
    this.broadcastState();
  }

  handleDisconnect(socket) {
    const agentId = socket.data.agentId;
    if (!agentId) return;

    const agent = findAgent(this.state, agentId);
    if (!agent || agent.socket_id !== socket.id) return;

    agent.connected = false;
    agent.socket_id = null;
    agent.last_seen = new Date().toISOString();
    this.broadcastState();

    const timer = setTimeout(() => {
      const current = findAgent(this.state, agentId);
      if (!current || current.connected) return;
      if (current.status === "available") current.status = "offline";
      current.last_seen = new Date().toISOString();
      this.reconnectTimers.delete(agentId);
      this.logEvent("agent_offline", { agentId });
      this.broadcastState();
    }, this.config.reconnectGraceMs);

    this.reconnectTimers.set(agentId, timer);
  }

  handlePosition(payload = {}) {
    const agent = findAgent(this.state, payload.agentId);
    const zone = findZone(this.state, payload.zoneId);
    if (!agent) return { ok: false, error: `Unknown agent ${payload.agentId}` };
    if (!zone) return { ok: false, error: `Unknown zone ${payload.zoneId}` };

    agent.current_zone = zone.id;
    agent.destination_zone = null;
    agent.last_seen = new Date().toISOString();
    if (agent.status === "offline") agent.status = "available";
    this.logEvent("position", { agentId: agent.id, zoneId: zone.id });
    this.broadcastState();
    return { ok: true };
  }

  async handleIncidentAudio(payload = {}) {
    const reporterId = payload.agentId;
    const stt = await transcribe(payload, this.config);
    const snapshot = buildSnapshot(this.state, {
      transcript: stt.text,
      lang: stt.lang,
      zone_id: payload.zoneId
    });

    let decisionResult;
    try {
      decisionResult = await decide(snapshot, stt.text, this.config);
    } catch (error) {
      decisionResult = {
        decision: null,
        source: `deterministic-fallback:${error.message}`
      };
    }

    const decision = decisionResult.decision || {
      ...snapshot.incident,
      primary_id: snapshot.candidates_primary[0]?.id || null,
      backfills: [],
      warning: null,
      justification: "Fallback déterministe après erreur LLM.",
      constraints_applied: []
    };

    const plan = applyDecision(decision, this.state, { maxDepth: 2 });
    const now = new Date().toISOString();
    const incident = {
      id: this.incidentIds.next(),
      transcript: stt.text,
      language: stt.lang,
      type: decision.incident_type || snapshot.incident.incident_type,
      incident_type: decision.incident_type || snapshot.incident.incident_type,
      zone_id: decision.zone_id || snapshot.incident.zone_id,
      skills_needed: decision.skills_needed || snapshot.incident.skills_needed,
      severity: decision.severity || snapshot.incident.severity,
      primary_id: plan.assignments.find((assignment) => assignment.role === "primary")?.agent_id || null,
      backfills: plan.assignments
        .filter((assignment) => assignment.role === "backfill")
        .map((assignment) => ({ agent_id: assignment.agent_id, target_zone: assignment.target_zone })),
      warning: plan.warning || decision.warning || null,
      status: plan.assignments.length ? "dispatching" : "needs_operator",
      source: decisionResult.source,
      reporter_id: reporterId,
      created_at: now,
      updated_at: now,
      justification: decision.justification || ""
    };

    this.state.incidents.push(incident);
    this.store.upsertIncident(incident);
    this.logEvent("incident_created", { incident, snapshot, decision });

    for (const assignmentPlan of plan.assignments) {
      const assignment = await this.createAndSendAssignment(incident, assignmentPlan);
      applyAssignmentPlan(this.state, assignmentPlan);
      this.state.assignments.push(assignment);
      this.store.upsertAssignment(assignment);
    }

    if (incident.warning) this.emitCoverageWarning(incident.warning, incident.id);
    this.io?.to("operators").emit("incident_update", incident);
    this.broadcastState();

    return { incident, assignments: plan.assignments };
  }

  async createAndSendAssignment(incident, plan, options = {}) {
    const agent = findAgent(this.state, plan.agent_id);
    const zone = findZone(this.state, plan.target_zone);
    const text =
      options.text ||
      (plan.role === "primary"
        ? `${incidentLabel(incident)} ${zone.name}, tu es le plus proche. Vas-y.`
        : `Rejoins ${zone.name} pour maintenir la couverture.`);
    const tts = await speak(text, preferredLanguage(agent, incident.language), this.config);
    const now = new Date().toISOString();
    const assignment = {
      id: this.assignmentIds.next(),
      incident_id: incident.id,
      agent_id: agent.id,
      role: plan.role,
      target_zone: zone.id,
      from_zone: plan.from_zone,
      hop: plan.hop,
      status: "sent",
      text,
      audioUrl: tts.audioUrl,
      lang: preferredLanguage(agent, incident.language),
      sent_at: now,
      created_at: now,
      updated_at: now,
      payload: null
    };

    assignment.payload = {
      assignmentId: assignment.id,
      incidentId: incident.id,
      role: assignment.role,
      targetZone: assignment.target_zone,
      text: assignment.text,
      audioUrl: assignment.audioUrl,
      lang: assignment.lang
    };

    this.sendDispatch(assignment);
    return assignment;
  }

  sendDispatch(assignment) {
    this.io?.to(`agent:${assignment.agent_id}`).emit("dispatch", assignment.payload);
    this.io?.to("operators").emit("dispatch", {
      ...assignment.payload,
      agentId: assignment.agent_id,
      status: assignment.status
    });
    this.logEvent("dispatch_sent", assignment);

    if (this.ackTimers.has(assignment.id)) clearTimeout(this.ackTimers.get(assignment.id));
    const timer = setTimeout(() => this.handleAckTimeout(assignment.id), this.config.ackTimeoutMs);
    this.ackTimers.set(assignment.id, timer);
  }

  handleAck(assignmentId) {
    const assignment = this.state.assignments.find((item) => item.id === assignmentId);
    if (!assignment) return { ok: false, error: `Unknown assignment ${assignmentId}` };
    if (assignment.status !== "sent") return { ok: true, status: assignment.status };

    if (this.ackTimers.has(assignment.id)) {
      clearTimeout(this.ackTimers.get(assignment.id));
      this.ackTimers.delete(assignment.id);
    }

    assignment.status = "ack";
    assignment.acked_at = new Date().toISOString();
    assignment.updated_at = assignment.acked_at;
    this.store.upsertAssignment(assignment);
    this.logEvent("assignment_ack", { assignmentId });
    this.io?.to("operators").emit("assignment_update", assignment);
    this.broadcastState();
    return { ok: true, status: assignment.status };
  }

  async handleAckTimeout(assignmentId) {
    const assignment = this.state.assignments.find((item) => item.id === assignmentId);
    if (!assignment || assignment.status !== "sent") return;

    this.ackTimers.delete(assignmentId);
    assignment.status = "timeout";
    assignment.timeout_at = new Date().toISOString();
    assignment.updated_at = assignment.timeout_at;
    this.store.upsertAssignment(assignment);
    this.io?.to("operators").emit("assignment_update", assignment);
    this.logEvent("assignment_timeout", { assignmentId });

    const agent = findAgent(this.state, assignment.agent_id);
    if (agent && agent.status !== "offline") {
      agent.status = agent.connected ? "available" : "offline";
      agent.current_zone = assignment.from_zone || agent.current_zone;
      agent.destination_zone = null;
    }

    const incident = this.state.incidents.find((item) => item.id === assignment.incident_id);
    if (!incident) {
      this.broadcastState();
      return;
    }

    const timedOutAgentIds = this.state.assignments
      .filter((item) => item.incident_id === incident.id && item.status === "timeout")
      .map((item) => item.agent_id);
    const replacement = findReplacementForAssignment(this.state, assignment, incident, timedOutAgentIds);

    if (!replacement) {
      const warning = coverageWarning(this.state, assignment.target_zone, createTravelIndex(this.state.zones));
      incident.warning = warning;
      incident.status = "needs_operator";
      this.store.upsertIncident(incident);
      this.emitCoverageWarning(warning, incident.id);
      this.broadcastState();
      return;
    }

    const replacementPlan = {
      agent_id: replacement.id,
      role: assignment.role,
      target_zone: assignment.target_zone,
      from_zone: replacement.current_zone,
      hop: assignment.hop ?? 0
    };
    const replacementAssignment = await this.createAndSendAssignment(incident, replacementPlan, {
      text:
        assignment.role === "primary"
          ? `${incidentLabel(incident)} ${findZone(this.state, assignment.target_zone).name}, réassignation faute d'accusé. Vas-y.`
          : `Réassignation: rejoins ${findZone(this.state, assignment.target_zone).name} pour maintenir la couverture.`
    });
    assignment.rerouted_to = replacementAssignment.id;
    applyAssignmentPlan(this.state, replacementPlan);
    this.state.assignments.push(replacementAssignment);
    this.store.upsertAssignment(assignment);
    this.store.upsertAssignment(replacementAssignment);
    this.io?.to("operators").emit("assignment_update", replacementAssignment);
    this.broadcastState();
  }

  async handleOperatorOverride(payload = {}) {
    const incident = this.state.incidents.find((item) => item.id === payload.incidentId);
    const agent = findAgent(this.state, payload.newAgentId);
    if (!incident) throw new Error(`Unknown incident ${payload.incidentId}`);
    if (!agent) throw new Error(`Unknown agent ${payload.newAgentId}`);

    const now = new Date().toISOString();
    const constraint = {
      id: this.constraintIds.next(),
      scope: "agent",
      rule_text: payload.reason || `Operator override: prefer ${agent.name} for ${incident.zone_id}`,
      source_override: {
        incidentId: incident.id,
        newAgentId: agent.id,
        previousPrimaryId: incident.primary_id || null
      },
      created_at: now
    };
    this.state.constraints.push(constraint);
    this.store.insertConstraint(constraint);

    for (const active of this.state.assignments.filter(
      (assignment) => assignment.incident_id === incident.id && assignment.role === "primary" && assignment.status === "sent"
    )) {
      if (this.ackTimers.has(active.id)) clearTimeout(this.ackTimers.get(active.id));
      active.status = "rerouted";
      active.updated_at = now;
      this.store.upsertAssignment(active);

      const previousAgent = findAgent(this.state, active.agent_id);
      if (previousAgent && previousAgent.status === "responding") {
        previousAgent.current_zone = active.from_zone || previousAgent.current_zone;
        previousAgent.destination_zone = null;
        previousAgent.status = previousAgent.connected ? "available" : "offline";
      }
    }

    const plan = {
      agent_id: agent.id,
      role: "primary",
      target_zone: incident.zone_id,
      from_zone: agent.current_zone,
      hop: 0
    };
    const assignment = await this.createAndSendAssignment(incident, plan, {
      text: `${incidentLabel(incident)} ${findZone(this.state, incident.zone_id).name}, override opérateur. Vas-y.`
    });
    applyAssignmentPlan(this.state, plan);
    this.state.assignments.push(assignment);
    incident.primary_id = agent.id;
    incident.status = "dispatching";
    incident.updated_at = now;
    this.store.upsertIncident(incident);
    this.store.upsertAssignment(assignment);
    this.logEvent("operator_override", { payload, constraint, assignment });

    this.io?.emit("learned_constraints", this.state.constraints);
    this.io?.to("operators").emit("incident_update", incident);
    this.broadcastState();

    return { assignment, constraint };
  }

  emitCoverageWarning(warning, incidentId = null) {
    const payload = { ...warning, incidentId };
    this.io?.emit("coverage_warning", payload);
    this.logEvent("coverage_warning", payload);
  }

  resetDemo() {
    for (const timer of this.ackTimers.values()) clearTimeout(timer);
    this.ackTimers.clear();
    resetState(this.state, this.seed);
    this.state.constraints.push(...this.store.loadConstraints());
    this.incidentIds.reset();
    this.assignmentIds.reset();
    this.logEvent("demo_reset", {});
    this.broadcastState();
    return this.publicState();
  }
}

function preferredLanguage(agent, incidentLanguage) {
  if (!agent?.languages?.length) return incidentLanguage || "fr";
  if (agent.languages.includes("fr")) return "fr";
  return agent.languages[0];
}

function incidentLabel(incident) {
  if (incident.incident_type === "arret_cardiaque" || incident.type === "arret_cardiaque") {
    return "Arrêt cardiaque au";
  }
  if (incident.incident_type === "security" || incident.type === "security") {
    return "Incident sécurité au";
  }
  return "Incident au";
}

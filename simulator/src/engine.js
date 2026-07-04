import { agentSeed, incidentCatalog, zoneSeed } from "./data.js";

const RESPONSE_SPEEDUP = 11;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatSkills(skills) {
  return skills.length ? skills.join(", ") : "couverture générale";
}

function getDistance(a, b) {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dz);
}

export class DispatchEngine extends EventTarget {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.zones = clone(zoneSeed);
    this.zoneById = new Map(this.zones.map((zone) => [zone.id, zone]));
    this.agents = clone(agentSeed).map((agent, index) => ({
      ...agent,
      status: "available",
      coveringZone: agent.isReserve ? null : agent.currentZone,
      assignedCover: false,
      route: null,
      eta: 0,
      labelOffset: index % 2 ? 0.7 : -0.7
    }));
    this.agentById = new Map(this.agents.map((agent) => [agent.id, agent]));
    this.incidents = [];
    this.assignments = [];
    this.constraints = {
      protectGrandHuitRcp: false
    };
    this.forceTimeoutOnce = false;
    this._incidentCounter = 1;
    this._assignmentCounter = 1;
    this._elapsed = 0;
    this._spoken = [];
    this._buildPaths();
    this.emit("reset", {});
    this.emit("coverage", this.getCoverage(false));
  }

  _buildPaths() {
    this.graph = new Map();
    for (const zone of this.zones) {
      this.graph.set(zone.id, zone.adjacency.map((edge) => ({ to: edge.z, time: edge.t })));
    }
  }

  on(type, handler) {
    this.addEventListener(type, (event) => handler(event.detail));
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setConstraint(name, enabled) {
    this.constraints[name] = enabled;
    this.emit("decision", {
      kind: "constraint",
      title: enabled ? "Contrainte opérateur appliquée" : "Contrainte opérateur levée",
      body: enabled
        ? "La paire RCP du Grand Huit est protégée sauf en dernier recours."
        : "La paire RCP du Grand Huit redevient mobilisable.",
      tone: "neutral"
    });
  }

  setForceTimeout(enabled) {
    this.forceTimeoutOnce = enabled;
  }

  zone(id) {
    return this.zoneById.get(id);
  }

  shortestPath(fromId, toId) {
    if (fromId === toId) {
      return { time: 0, zones: [fromId] };
    }
    const dist = new Map();
    const prev = new Map();
    const unvisited = new Set(this.zones.map((zone) => zone.id));
    for (const zone of this.zones) dist.set(zone.id, Infinity);
    dist.set(fromId, 0);

    while (unvisited.size) {
      let current = null;
      let best = Infinity;
      for (const id of unvisited) {
        const score = dist.get(id);
        if (score < best) {
          best = score;
          current = id;
        }
      }
      if (current === null || current === toId) break;
      unvisited.delete(current);
      for (const edge of this.graph.get(current) || []) {
        const candidate = dist.get(current) + edge.time;
        if (candidate < dist.get(edge.to)) {
          dist.set(edge.to, candidate);
          prev.set(edge.to, current);
        }
      }
    }

    const zones = [];
    let cursor = toId;
    while (cursor) {
      zones.unshift(cursor);
      cursor = prev.get(cursor);
      if (cursor === fromId) {
        zones.unshift(cursor);
        break;
      }
    }
    if (zones[0] !== fromId) {
      return { time: Math.round(getDistance(this.zone(fromId).pos, this.zone(toId).pos) * 12), zones: [fromId, toId] };
    }
    return { time: dist.get(toId), zones };
  }

  getCoverage(includeIncoming = false) {
    const incomingByZone = new Map();
    if (includeIncoming) {
      for (const agent of this.agents) {
        if (agent.status === "backfilling" && agent.targetZone) {
          incomingByZone.set(agent.targetZone, (incomingByZone.get(agent.targetZone) || 0) + 1);
        }
      }
    }

    return this.zones.map((zone) => {
      const coveringAgents = this.agents.filter((agent) => {
        if (agent.status !== "available" && agent.status !== "pending_ack") return false;
        if (agent.coveringZone !== zone.id) return false;
        return !agent.isReserve || agent.assignedCover;
      });
      const incoming = incomingByZone.get(zone.id) || 0;
      const skillsCovered = new Set(coveringAgents.flatMap((agent) => agent.skills));
      const missingSkills = zone.requiredSkills.filter((skill) => !skillsCovered.has(skill));
      const headcount = coveringAgents.length + incoming;
      const surplus = headcount - zone.requiredMin;
      const ok = surplus >= 0 && missingSkills.length === 0;
      return {
        zoneId: zone.id,
        name: zone.name,
        requiredMin: zone.requiredMin,
        requiredSkills: zone.requiredSkills,
        headcount,
        actualHeadcount: coveringAgents.length,
        incoming,
        surplus,
        missingSkills,
        agents: coveringAgents,
        ok
      };
    });
  }

  getDeficits(includeIncoming = true) {
    return this.getCoverage(includeIncoming)
      .filter((zone) => !zone.ok)
      .map((zone) => ({
        zoneId: zone.zoneId,
        missingHeadcount: Math.max(0, zone.requiredMin - zone.headcount),
        missingSkills: zone.missingSkills,
        label: [
          zone.requiredMin > zone.headcount ? `${zone.requiredMin - zone.headcount} staff` : null,
          zone.missingSkills.length ? zone.missingSkills.join("/") : null
        ].filter(Boolean).join(" + ")
      }));
  }

  simulateRemove(agentId, options = {}) {
    const includeIncoming = options.includeIncoming ?? true;
    const original = this.agentById.get(agentId);
    const saved = {
      status: original.status,
      coveringZone: original.coveringZone,
      targetZone: original.targetZone
    };
    original.status = "responding";
    original.coveringZone = null;
    original.targetZone = null;
    const deficits = this.getDeficits(includeIncoming);
    Object.assign(original, saved);
    return deficits;
  }

  isProtected(agent, incidentZoneId) {
    return this.constraints.protectGrandHuitRcp
      && incidentZoneId !== "Z2"
      && agent.currentZone === "Z2"
      && agent.skills.includes("RCP");
  }

  canCoverSkill(agent, skillsNeeded) {
    return skillsNeeded.every((skill) => agent.skills.includes(skill));
  }

  isAvailable(agent) {
    return agent.status === "available";
  }

  choosePrimary(incident) {
    const zone = this.zone(incident.zoneId);
    const candidates = this.agents
      .filter((agent) => this.isAvailable(agent))
      .filter((agent) => this.canCoverSkill(agent, incident.skillsNeeded))
      .map((agent) => {
        const path = this.shortestPath(agent.currentZone, incident.zoneId);
        const deficits = agent.isReserve ? [] : this.simulateRemove(agent.id);
        const createsGap = deficits.length > 0;
        const protectedPenalty = this.isProtected(agent, incident.zoneId) ? 10000 : 0;
        const reserveCredit = agent.isReserve ? -18 : 0;
        const sameZoneCredit = agent.currentZone === incident.zoneId ? -45 : 0;
        const gapPenalty = createsGap ? 22 : -12;
        const medicCredit = incident.skillsNeeded.includes("medic") && agent.skills.includes("medic") ? -15 : 0;
        return {
          agent,
          path,
          createsGap,
          deficits,
          score: path.time + protectedPenalty + reserveCredit + sameZoneCredit + gapPenalty + medicCredit
        };
      })
      .sort((a, b) => a.score - b.score);

    return candidates;
  }

  findBackfillCandidate(targetZoneId, missingSkills, usedAgentIds, hop) {
    const target = this.zone(targetZoneId);
    const requiredSkills = missingSkills.length ? missingSkills : target.requiredSkills;
    const available = this.agents
      .filter((agent) => this.isAvailable(agent))
      .filter((agent) => !usedAgentIds.has(agent.id))
      .filter((agent) => agent.currentZone !== targetZoneId)
      .filter((agent) => requiredSkills.length === 0 || requiredSkills.every((skill) => agent.skills.includes(skill)))
      .map((agent) => {
        const path = this.shortestPath(agent.currentZone, targetZoneId);
        const deficits = agent.isReserve ? [] : this.simulateRemove(agent.id);
        const createsGap = deficits.some((deficit) => deficit.zoneId !== targetZoneId);
        const safe = agent.isReserve || !createsGap;
        const protectedPenalty = this.isProtected(agent, targetZoneId) ? 10000 : 0;
        const reserveCredit = agent.isReserve ? -45 : 0;
        const unsafePenalty = safe ? 0 : hop < 2 ? 85 : 10000;
        return {
          agent,
          path,
          safe,
          createsGap,
          deficits,
          score: path.time + protectedPenalty + reserveCredit + unsafePenalty
        };
      })
      .sort((a, b) => a.score - b.score);

    return available[0] || null;
  }

  triggerIncident(zoneId, options = {}) {
    const template = incidentCatalog[zoneId] || incidentCatalog.Z2;
    const zone = this.zone(zoneId);
    const incident = {
      id: `I${String(this._incidentCounter++).padStart(2, "0")}`,
      zoneId,
      zoneName: zone.name,
      transcript: options.transcript || template.transcript,
      language: options.language || template.language,
      type: template.type,
      skillsNeeded: template.skills,
      severity: template.severity,
      status: "triaging",
      primaryId: null,
      backfills: [],
      warnings: [],
      startedAt: this._elapsed,
      patientOffset: options.patientOffset || [
        (Math.random() - 0.5) * 2.6,
        0,
        (Math.random() - 0.5) * 2.6
      ]
    };
    this.incidents.push(incident);

    this.emit("incident", { incident });
    this.emit("decision", {
      kind: "parse",
      title: `Incident : ${zone.name}`,
      body: `${incident.type.replaceAll("_", " ")} · ${formatSkills(incident.skillsNeeded)} · sévérité ${incident.severity}/5`,
      tone: "hot"
    });
    this.emit("speak", {
      speaker: "Conductor",
      text: `Signalement vocal à ${zone.name}. Je lis ${incident.type.replaceAll("_", " ")}. Compétence requise : ${formatSkills(incident.skillsNeeded)}.`
    });

    const candidates = this.choosePrimary(incident);
    if (!candidates.length) {
      incident.status = "warning";
      incident.warnings.push("Aucun répondant qualifié disponible.");
      this.emit("decision", {
        kind: "warning",
        zoneId: incident.zoneId,
        title: "Aucun répondant qualifié disponible",
        body: `L'opérateur doit affecter manuellement ${formatSkills(incident.skillsNeeded)} pour ${zone.name}.`,
        tone: "danger"
      });
      this.emit("coverage", this.getCoverage(false));
      return incident;
    }

    this.dispatchPrimary(incident, candidates, 0);
    return incident;
  }

  dispatchPrimary(incident, candidates, candidateIndex) {
    const choice = candidates[candidateIndex];
    if (!choice) return;
    const agent = choice.agent;
    const sourceZone = agent.currentZone;
    incident.primaryId = agent.id;
    incident.status = "dispatching";

    const assignment = this.createAssignment(incident, agent, "primary", incident.zoneId, choice.path, candidateIndex);
    this.emit("decision", {
      kind: "dispatch",
      title: `${agent.name} → ${incident.zoneName}`,
      body: `${agent.name} est le répondant qualifié (${formatSkills(incident.skillsNeeded)}) le plus proche. ${choice.createsGap ? `Son départ de ${this.zone(sourceZone).name} crée un trou : backfill lancé.` : `Le départ de ${this.zone(sourceZone).name} reste dans les minima.`}`,
      tone: choice.createsGap ? "warning" : "success"
    });
    this.emit("assignment", { assignment, incident });
    this.emit("speak", {
      speaker: agent.name,
      text: `${agent.name}, bien reçu. Personne au sol à ${incident.zoneName}. J'y vais.`
    });

    agent.status = "pending_ack";
    agent.assignmentId = assignment.id;
    agent.targetZone = incident.zoneId;

    const shouldTimeout = this.forceTimeoutOnce && candidateIndex === 0;
    if (shouldTimeout) {
      this.forceTimeoutOnce = false;
      this.emit("timeout-toggle-consumed", {});
      assignment.status = "sent";
      assignment.ackDue = this._elapsed + 3.1;
      assignment.timeout = true;
      setTimeout(() => this.timeoutPrimary(incident, candidates, candidateIndex, assignment.id), 3100);
    } else {
      setTimeout(() => this.ackPrimary(incident, assignment.id), 850);
    }

    this.emit("coverage", this.getCoverage(false));
  }

  timeoutPrimary(incident, candidates, candidateIndex, assignmentId) {
    const assignment = this.assignments.find((item) => item.id === assignmentId);
    if (!assignment || assignment.status !== "sent") return;
    const agent = this.agentById.get(assignment.agentId);
    assignment.status = "timeout";
    agent.status = "available";
    agent.coveringZone = agent.isReserve ? null : agent.currentZone;
    agent.targetZone = null;
    agent.assignmentId = null;
    this.emit("decision", {
      kind: "timeout",
      title: `${agent.name} n'a pas accusé réception`,
      body: "Conductor referme la boucle et re-route vers le répondant qualifié suivant.",
      tone: "danger"
    });
    this.emit("speak", {
      speaker: "Conductor",
      text: `Pas d'accusé de ${agent.name}. Re-routage immédiat de l'incident.`
    });
    this.dispatchPrimary(incident, candidates, candidateIndex + 1);
  }

  ackPrimary(incident, assignmentId) {
    const assignment = this.assignments.find((item) => item.id === assignmentId);
    if (!assignment || assignment.status !== "sent") return;
    const agent = this.agentById.get(assignment.agentId);
    assignment.status = "ack";
    agent.coveringZone = null;
    agent.status = "responding";
    this.emit("ack", { agentId: agent.id });
    this.emit("decision", {
      kind: "ack",
      title: `${agent.name} a accusé réception`,
      body: `ETA ${Math.max(8, Math.round(assignment.travelTime / RESPONSE_SPEEDUP))} s vers ${incident.zoneName}.`,
      tone: "success"
    });
    this.emit("speak", {
      speaker: "Conductor",
      text: `${agent.name} a confirmé. ${agent.name}, rejoins ${incident.zoneName}.`
    });
    this.planBackfills(incident, new Set([agent.id]));
    this.emit("coverage", this.getCoverage(false));
    this.emit("move", {
      agentId: agent.id,
      role: "primary",
      incidentId: incident.id,
      path: assignment.path,
      targetZone: incident.zoneId,
      travelTime: assignment.travelTime
    });
  }

  planBackfills(incident, usedAgentIds) {
    let hop = 1;
    while (hop <= 2) {
      const deficits = this.getDeficits(true).filter((deficit) => {
        return !incident.backfills.some((backfill) => backfill.targetZone === deficit.zoneId && backfill.status !== "failed");
      });
      if (!deficits.length) break;
      const deficit = deficits[0];
      const candidate = this.findBackfillCandidate(deficit.zoneId, deficit.missingSkills, usedAgentIds, hop);
      if (!candidate) {
        const zone = this.zone(deficit.zoneId);
        const warning = `${zone.name} restera sous le minimum : ${deficit.label || "couverture"} non résolu.`;
        incident.warnings.push(warning);
        this.emit("decision", {
          kind: "warning",
          zoneId: deficit.zoneId,
          title: `Alerte opérateur : trou de couverture à ${zone.name}`,
          body: warning,
          tone: "danger"
        });
        this.emit("speak", {
          speaker: "Conductor",
          text: `Alerte. Aucun backfill propre pour ${zone.name}. Validation opérateur requise.`
        });
        break;
      }
      this.assignBackfill(incident, candidate, deficit.zoneId, hop);
      usedAgentIds.add(candidate.agent.id);
      hop += 1;
    }
  }

  assignBackfill(incident, candidate, targetZoneId, hop) {
    const agent = candidate.agent;
    const target = this.zone(targetZoneId);
    const sourceName = agent.coveringZone ? this.zone(agent.coveringZone).name : "reserve pool";
    const assignment = this.createAssignment(incident, agent, "backfill", targetZoneId, candidate.path, 0, hop);
    incident.backfills.push({
      agentId: agent.id,
      targetZone: targetZoneId,
      hop,
      status: "sent"
    });

    agent.coveringZone = null;
    agent.status = "backfilling";
    agent.assignmentId = assignment.id;
    agent.targetZone = targetZoneId;
    if (agent.isReserve) agent.assignedCover = true;

    this.emit("decision", {
      kind: "backfill",
      title: `Hop ${hop} : ${agent.name} backfill ${target.name}`,
      body: `${sourceName} → ${target.name}. ${candidate.safe ? "Aucun trou de second ordre créé." : "Crée un trou de second ordre, la cascade continue."}`,
      tone: candidate.safe ? "success" : "warning"
    });
    this.emit("assignment", { assignment, incident });
    this.emit("speak", {
      speaker: "Conductor",
      text: `${agent.name}, rejoins ${target.name} en renfort. Referme le trou de couverture.`
    });
    this.emit("move", {
      agentId: agent.id,
      role: "backfill",
      incidentId: incident.id,
      path: assignment.path,
      targetZone: targetZoneId,
      travelTime: assignment.travelTime,
      hop
    });
    this.emit("coverage", this.getCoverage(false));
  }

  createAssignment(incident, agent, role, targetZone, path, candidateIndex, hop = 0) {
    const assignment = {
      id: `AS${String(this._assignmentCounter++).padStart(3, "0")}`,
      incidentId: incident.id,
      agentId: agent.id,
      role,
      targetZone,
      path: path.zones,
      travelTime: path.time,
      candidateIndex,
      hop,
      status: "sent",
      sentAt: this._elapsed
    };
    this.assignments.push(assignment);
    return assignment;
  }

  completeMove(agentId, role, incidentId, targetZone) {
    const agent = this.agentById.get(agentId);
    const incident = this.incidents.find((item) => item.id === incidentId);
    agent.currentZone = targetZone;
    agent.targetZone = null;

    if (role === "backfill") {
      agent.status = "available";
      agent.coveringZone = targetZone;
      const assignment = this.assignments.find((item) => item.agentId === agentId && item.incidentId === incidentId && item.role === "backfill");
      if (assignment) assignment.status = "done";
      const backfill = incident?.backfills.find((item) => item.agentId === agentId && item.targetZone === targetZone);
      if (backfill) backfill.status = "done";
      this.emit("decision", {
        kind: "restore",
        title: `${this.zone(targetZone).name} — couverture rétablie`,
        body: `${agent.name} couvre maintenant la zone. Le trou est refermé.`,
        tone: "success"
      });
      this.emit("speak", {
        speaker: "Conductor",
        text: `Couverture de ${this.zone(targetZone).name} rétablie par ${agent.name}.`
      });
      this.emit("coverage", this.getCoverage(false));
      return;
    }

    if (role === "primary" && incident) {
      agent.status = "treating";
      incident.status = "on_scene";
      this.emit("decision", {
        kind: "onscene",
        title: `${agent.name} sur place`,
        body: "Le couloir ambulance se dégage pendant que le répondant stabilise la scène.",
        tone: "hot"
      });
      this.emit("speak", {
        speaker: agent.name,
        text: `${agent.name} auprès du visiteur. Préparation du transfert vers l'ambulance.`
      });
      setTimeout(() => this.transportToAmbulance(agentId, incidentId), 2600);
    }
  }

  transportToAmbulance(agentId, incidentId) {
    const agent = this.agentById.get(agentId);
    const incident = this.incidents.find((item) => item.id === incidentId);
    if (!agent || !incident || incident.status === "closed") return;
    agent.status = "transporting";
    incident.status = "transporting";
    this.emit("decision", {
      kind: "ambulance",
      title: `Transfert ambulance ouvert`,
      body: `${agent.name} escorte le patient vers le point ambulance de la porte de service.`,
      tone: "neutral"
    });
    this.emit("speak", {
      speaker: "Conductor",
      text: `Point ambulance prêt. ${agent.name}, amène le patient à la porte de service.`
    });
    this.emit("move", {
      agentId,
      role: "ambulance",
      incidentId,
      path: [agent.currentZone, "AMB"],
      targetZone: "Z10",
      travelTime: 80
    });
  }

  completeAmbulance(agentId, incidentId) {
    const agent = this.agentById.get(agentId);
    const incident = this.incidents.find((item) => item.id === incidentId);
    if (!agent || !incident) return;
    agent.status = "available";
    agent.currentZone = "Z10";
    agent.coveringZone = agent.isReserve ? null : "Z10";
    agent.targetZone = null;
    incident.status = "closed";
    incident.closedAt = this._elapsed;
    const assignment = this.assignments.find((item) => item.agentId === agentId && item.incidentId === incidentId && item.role === "primary");
    if (assignment) assignment.status = "done";
    this.emit("decision", {
      kind: "closed",
      title: `Incident ${incident.zoneName} clôturé`,
      body: `Patient remis à l'ambulance. ${agent.name} est disponible au Parking.`,
      tone: "success"
    });
    this.emit("speak", {
      speaker: "Conductor",
      text: `Transfert terminé. Incident ${incident.zoneName} clôturé.`
    });
    this.emit("coverage", this.getCoverage(false));
  }

  tick(deltaSeconds) {
    this._elapsed += deltaSeconds;
  }
}

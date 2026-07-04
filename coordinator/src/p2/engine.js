import { cloneState, findAgent, findZone } from "./state.js";

const COVERAGE_STATUSES = new Set(["available", "backfilling"]);
const DISPATCHABLE_STATUSES = new Set(["available"]);
const ZONE_ALIASES = {
  Z1: ["entree", "entrée", "entrada", "gate", "main gate"],
  Z2: ["grand huit", "roller coaster", "coaster"],
  Z3: ["grande roue", "ferris wheel"],
  Z4: ["riviere sauvage", "rivière sauvage", "river"],
  Z5: ["place centrale", "central plaza"],
  Z6: ["zone enfants", "kids", "children", "enfants"],
  Z7: ["food court", "restauration"],
  Z8: ["manege extreme", "manège extrême", "extreme", "extrême"],
  Z9: ["boutiques", "shops"],
  Z10: ["parking"]
};

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function createTravelIndex(zones) {
  const ids = zones.map((zone) => zone.id);
  const dist = new Map();

  for (const from of ids) {
    for (const to of ids) {
      dist.set(`${from}:${to}`, from === to ? 0 : Number.POSITIVE_INFINITY);
    }
  }

  for (const zone of zones) {
    for (const edge of zone.adjacency || []) {
      dist.set(`${zone.id}:${edge.z}`, edge.t);
      dist.set(`${edge.z}:${zone.id}`, edge.t);
    }
  }

  for (const mid of ids) {
    for (const from of ids) {
      for (const to of ids) {
        const current = dist.get(`${from}:${to}`);
        const through = dist.get(`${from}:${mid}`) + dist.get(`${mid}:${to}`);
        if (through < current) dist.set(`${from}:${to}`, through);
      }
    }
  }

  return {
    distance(from, to) {
      if (!from || !to) return Number.POSITIVE_INFINITY;
      return dist.get(`${from}:${to}`) ?? Number.POSITIVE_INFINITY;
    }
  };
}

export function agentHasSkills(agent, skills = []) {
  return skills.every((skill) => agent.skills.includes(skill));
}

export function canCoverZone(agent, zone) {
  return agentHasSkills(agent, zone.required_skills || []);
}

export function coverageAgents(state, zoneId) {
  return state.agents.filter(
    (agent) => agent.current_zone === zoneId && COVERAGE_STATUSES.has(agent.status)
  );
}

export function zoneCoverage(state, zoneId) {
  const zone = findZone(state, zoneId);
  if (!zone) throw new Error(`Unknown zone ${zoneId}`);

  const agents = coverageAgents(state, zoneId);
  const missingSkills = (zone.required_skills || []).filter(
    (skill) => !agents.some((agent) => agent.skills.includes(skill))
  );

  return {
    id: zone.id,
    name: zone.name,
    headcount: agents.length,
    required_min: zone.required_min,
    surplus: agents.length - zone.required_min,
    required_skills: [...(zone.required_skills || [])],
    missing_skills: missingSkills,
    ok: agents.length >= zone.required_min && missingSkills.length === 0
  };
}

export function summarizeZones(state) {
  return state.zones.map((zone) => ({
    ...zoneCoverage(state, zone.id),
    adjacency: zone.adjacency.map((edge) => ({ zone_id: edge.z, travel_time_s: edge.t }))
  }));
}

export function safeToPull(state, agentId) {
  const agent = findAgent(state, agentId);
  if (!agent || !DISPATCHABLE_STATUSES.has(agent.status)) return false;
  if (agent.is_reserve) return true;

  const zone = findZone(state, agent.current_zone);
  if (!zone) return false;

  const remaining = coverageAgents(state, zone.id).filter((candidate) => candidate.id !== agent.id);
  const missingSkills = (zone.required_skills || []).filter(
    (skill) => !remaining.some((candidate) => candidate.skills.includes(skill))
  );

  return remaining.length >= zone.required_min && missingSkills.length === 0;
}

export function detectZoneFromTranscript(transcript, zones, fallbackZoneId = null) {
  const normalized = normalizeText(transcript);

  for (const zone of zones) {
    const names = [zone.id, zone.name, ...(ZONE_ALIASES[zone.id] || [])].map(normalizeText);
    if (names.some((alias) => alias && normalized.includes(alias))) return zone.id;
  }

  return fallbackZoneId || zones[0]?.id || null;
}

export function inferIncident(transcript, zones, overrides = {}) {
  const normalized = normalizeText(transcript);
  const zoneId = overrides.zone_id || overrides.zoneId || detectZoneFromTranscript(transcript, zones);
  const cardiac =
    normalized.includes("cardiaque") ||
    normalized.includes("respire plus") ||
    normalized.includes("no respira") ||
    normalized.includes("not breathing") ||
    normalized.includes("collapsed") ||
    normalized.includes("desplomo");
  const fight =
    normalized.includes("bagarre") ||
    normalized.includes("fight") ||
    normalized.includes("security") ||
    normalized.includes("securite");

  if (cardiac) {
    return {
      incident_type: "arret_cardiaque",
      zone_id: zoneId,
      skills_needed: ["RCP"],
      severity: 5
    };
  }

  if (fight) {
    return {
      incident_type: "security",
      zone_id: zoneId,
      skills_needed: ["secu"],
      severity: 4
    };
  }

  return {
    incident_type: "medical",
    zone_id: zoneId,
    skills_needed: ["first-aid"],
    severity: 3
  };
}

function isAgentBlockedByConstraints(agent, constraints = []) {
  const haystacks = [agent.id, agent.name].map(normalizeText);
  return constraints.some((constraint) => {
    const rule = normalizeText(constraint.rule_text || "");
    const mentionsAgent = haystacks.some((value) => value && rule.includes(value));
    const isBlocking =
      rule.includes("pause") ||
      rule.includes("break") ||
      rule.includes("protege") ||
      rule.includes("protect") ||
      rule.includes("evite") ||
      rule.includes("avoid") ||
      rule.includes("ne pas");
    return mentionsAgent && isBlocking;
  });
}

function baseCandidate(agent, targetZoneId, travelIndex, safe) {
  return {
    id: agent.id,
    name: agent.name,
    skills: [...agent.skills],
    languages: [...agent.languages],
    current_zone: agent.current_zone,
    travel_time_s: travelIndex.distance(agent.current_zone, targetZoneId),
    is_reserve: agent.is_reserve,
    safe
  };
}

export function rankPrimaryCandidates(state, incident, travelIndex, options = {}) {
  const excluded = new Set(options.excludeAgentIds || []);
  return state.agents
    .filter((agent) => DISPATCHABLE_STATUSES.has(agent.status))
    .filter((agent) => !excluded.has(agent.id))
    .filter((agent) => !isAgentBlockedByConstraints(agent, state.constraints))
    .filter((agent) => agentHasSkills(agent, incident.skills_needed || []))
    .map((agent) => baseCandidate(agent, incident.zone_id, travelIndex, safeToPull(state, agent.id)))
    .sort((a, b) => {
      if (a.travel_time_s !== b.travel_time_s) return a.travel_time_s - b.travel_time_s;
      if (a.is_reserve !== b.is_reserve) return a.is_reserve ? 1 : -1;
      return a.id.localeCompare(b.id);
    });
}

export function rankBackfillCandidates(state, targetZoneId, travelIndex, options = {}) {
  const targetZone = findZone(state, targetZoneId);
  const excluded = new Set(options.excludeAgentIds || []);
  const includeUnsafe = Boolean(options.includeUnsafe);

  return state.agents
    .filter((agent) => DISPATCHABLE_STATUSES.has(agent.status))
    .filter((agent) => agent.current_zone !== targetZoneId)
    .filter((agent) => !excluded.has(agent.id))
    .filter((agent) => !isAgentBlockedByConstraints(agent, state.constraints))
    .filter((agent) => canCoverZone(agent, targetZone))
    .map((agent) => baseCandidate(agent, targetZoneId, travelIndex, safeToPull(state, agent.id)))
    .filter((candidate) => includeUnsafe || candidate.safe)
    .sort((a, b) => {
      if (a.safe !== b.safe) return a.safe ? -1 : 1;
      if (a.travel_time_s !== b.travel_time_s) return a.travel_time_s - b.travel_time_s;
      if (a.is_reserve !== b.is_reserve) return a.is_reserve ? 1 : -1;
      return a.id.localeCompare(b.id);
    });
}

export function buildSnapshot(state, incidentInput) {
  const travelIndex = createTravelIndex(state.zones);
  const inferred = inferIncident(incidentInput.transcript, state.zones, incidentInput);
  const incident = {
    transcript: incidentInput.transcript,
    lang: incidentInput.lang || "fr",
    zone_id: inferred.zone_id,
    incident_type: inferred.incident_type,
    skills_needed: inferred.skills_needed,
    severity: inferred.severity
  };

  return {
    incident,
    zones: summarizeZones(state),
    roster: state.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      skills: [...agent.skills],
      languages: [...agent.languages],
      current_zone: agent.current_zone,
      is_reserve: agent.is_reserve,
      status: agent.status,
      connected: agent.connected
    })),
    constraints: state.constraints.map((constraint) => ({ ...constraint })),
    candidates_primary: rankPrimaryCandidates(state, incident, travelIndex),
    candidates_backfill_by_zone: Object.fromEntries(
      state.zones.map((zone) => [zone.id, rankBackfillCandidates(state, zone.id, travelIndex)])
    )
  };
}

function applyPlanToSimulation(state, plan) {
  const agent = findAgent(state, plan.agent_id);
  if (!agent) throw new Error(`Unknown agent ${plan.agent_id}`);
  agent.current_zone = plan.target_zone;
  agent.destination_zone = plan.target_zone;
  agent.status = plan.role === "primary" ? "responding" : "backfilling";
}

function deficientZoneIds(state) {
  return state.zones.filter((zone) => !zoneCoverage(state, zone.id).ok).map((zone) => zone.id);
}

export function cascadeBackfill(state, targetZoneId, options = {}) {
  const travelIndex = createTravelIndex(state.zones);
  const maxDepth = options.maxDepth ?? 2;
  const excluded = new Set(options.excludeAgentIds || []);

  function visit(simState, zoneId, depth, path) {
    if (zoneCoverage(simState, zoneId).ok) {
      return { ok: true, state: simState, assignments: [] };
    }

    if (depth <= 0) {
      return {
        ok: false,
        state: simState,
        assignments: [],
        warning: coverageWarning(simState, zoneId, travelIndex)
      };
    }

    const candidates = rankBackfillCandidates(simState, zoneId, travelIndex, {
      includeUnsafe: true,
      excludeAgentIds: [...excluded]
    });

    for (const candidate of candidates) {
      const key = `${candidate.id}->${zoneId}`;
      if (path.has(key)) continue;

      const candidateAgent = findAgent(simState, candidate.id);
      const fromZone = candidateAgent.current_zone;
      const nextState = cloneState(simState);
      const plan = {
        agent_id: candidate.id,
        role: "backfill",
        target_zone: zoneId,
        from_zone: fromZone,
        hop: maxDepth - depth + 1
      };
      applyPlanToSimulation(nextState, plan);

      const childAssignments = [];
      let workingState = nextState;
      let failed = false;
      const deficits = deficientZoneIds(workingState).filter((id) => id !== zoneId);

      for (const deficitZoneId of deficits) {
        const child = visit(workingState, deficitZoneId, depth - 1, new Set([...path, key]));
        if (!child.ok) {
          failed = true;
          break;
        }
        workingState = child.state;
        childAssignments.push(...child.assignments);
      }

      if (!failed && zoneCoverage(workingState, zoneId).ok) {
        return {
          ok: true,
          state: workingState,
          assignments: [plan, ...childAssignments]
        };
      }
    }

    return {
      ok: false,
      state: simState,
      assignments: [],
      warning: coverageWarning(simState, zoneId, travelIndex)
    };
  }

  return visit(cloneState(state), targetZoneId, maxDepth, new Set());
}

export function decideDeterministically(snapshot) {
  const primary = snapshot.candidates_primary[0];

  return {
    incident_type: snapshot.incident.incident_type,
    zone_id: snapshot.incident.zone_id,
    skills_needed: snapshot.incident.skills_needed,
    severity: snapshot.incident.severity,
    primary_id: primary?.id || null,
    backfills: [],
    warning: primary ? null : "Aucun agent qualifié disponible.",
    justification: primary
      ? `${primary.name} est le répondant qualifié le plus proche; le moteur complète la couverture si nécessaire.`
      : "Aucun répondant qualifié n'est disponible.",
    constraints_applied: []
  };
}

export function applyDecision(decision, state, options = {}) {
  const maxDepth = options.maxDepth ?? 2;
  const travelIndex = createTravelIndex(state.zones);
  const simState = cloneState(state);
  const incident = {
    incident_type: decision.incident_type,
    zone_id: decision.zone_id,
    skills_needed: decision.skills_needed || [],
    severity: decision.severity || 3
  };
  const assignments = [];

  let primary = findAgent(simState, decision.primary_id);
  if (!primary || !DISPATCHABLE_STATUSES.has(primary.status) || !agentHasSkills(primary, incident.skills_needed)) {
    primary = rankPrimaryCandidates(simState, incident, travelIndex)[0];
  }

  if (!primary) {
    return {
      ok: false,
      state: simState,
      assignments,
      warning: {
        zoneId: incident.zone_id,
        etaSec: null,
        message: "Aucun agent qualifié disponible. Override opérateur requis."
      }
    };
  }

  const primaryPlan = {
    agent_id: primary.id,
    role: "primary",
    target_zone: incident.zone_id,
    from_zone: primary.current_zone,
    hop: 0
  };
  assignments.push(primaryPlan);
  applyPlanToSimulation(simState, primaryPlan);

  for (const requested of decision.backfills || []) {
    if (assignments.length >= 3) break;
    const agent = findAgent(simState, requested.agent_id);
    const targetZone = findZone(simState, requested.target_zone);
    if (!agent || !targetZone || !DISPATCHABLE_STATUSES.has(agent.status)) continue;
    if (!canCoverZone(agent, targetZone)) continue;
    if (!safeToPull(simState, agent.id)) continue;

    const plan = {
      agent_id: agent.id,
      role: "backfill",
      target_zone: targetZone.id,
      from_zone: agent.current_zone,
      hop: assignments.length
    };
    assignments.push(plan);
    applyPlanToSimulation(simState, plan);
  }

  let warning = null;
  let workingState = simState;
  const deficits = deficientZoneIds(workingState);

  for (const zoneId of deficits) {
    const cascade = cascadeBackfill(workingState, zoneId, {
      maxDepth,
      excludeAgentIds: assignments.map((assignment) => assignment.agent_id)
    });
    if (!cascade.ok) {
      warning = cascade.warning;
      continue;
    }
    workingState = cascade.state;
    assignments.push(...cascade.assignments);
  }

  const finalDeficit = deficientZoneIds(workingState)[0];
  if (finalDeficit) warning = coverageWarning(workingState, finalDeficit, travelIndex);

  return {
    ok: !warning,
    state: workingState,
    assignments,
    warning
  };
}

export function coverageWarning(state, zoneId, travelIndex = createTravelIndex(state.zones)) {
  const zone = findZone(state, zoneId);
  const candidates = rankBackfillCandidates(state, zoneId, travelIndex, { includeUnsafe: true });
  const etaSec = candidates[0]?.travel_time_s ?? null;
  const minutes = etaSec == null || !Number.isFinite(etaSec) ? "?" : Math.ceil(etaSec / 60);
  return {
    zoneId,
    etaSec,
    message: `${zone.name} tombera sous le minimum ~${minutes} min. Accepter / réassigner ?`
  };
}

export function applyAssignmentPlan(state, plan) {
  applyPlanToSimulation(state, plan);
}

export function publicState(state) {
  return {
    agents: state.agents.map((agent) => ({ ...agent, socket_id: undefined })),
    zones: summarizeZones(state),
    incidents: state.incidents.map((incident) => ({ ...incident })),
    assignments: state.assignments.map((assignment) => ({ ...assignment })),
    constraints: state.constraints.map((constraint) => ({ ...constraint })),
    started_at: state.started_at
  };
}

export function findReplacementForAssignment(state, assignment, incident, excludeAgentIds = []) {
  const travelIndex = createTravelIndex(state.zones);
  const excluded = new Set([assignment.agent_id, ...excludeAgentIds]);

  if (assignment.role === "primary") {
    return rankPrimaryCandidates(
      state,
      {
        zone_id: incident.zone_id,
        skills_needed: incident.skills_needed || []
      },
      travelIndex,
      { excludeAgentIds: [...excluded] }
    )[0];
  }

  return rankBackfillCandidates(state, assignment.target_zone, travelIndex, {
    excludeAgentIds: [...excluded]
  })[0];
}

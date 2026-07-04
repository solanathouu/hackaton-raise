import fs from "node:fs";

export function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function loadSeed(config) {
  return {
    zones: readJson(config.zonesPath),
    roster: readJson(config.rosterPath),
    constraints: fs.existsSync(config.constraintsPath) ? readJson(config.constraintsPath) : []
  };
}

export function createInitialState(seed) {
  return {
    zones: seed.zones.map((zone) => ({ ...zone })),
    agents: seed.roster.map((agent) => ({
      ...agent,
      connected: false,
      socket_id: null,
      last_seen: null,
      destination_zone: null
    })),
    incidents: [],
    assignments: [],
    constraints: seed.constraints.map((constraint) => ({ ...constraint })),
    started_at: new Date().toISOString()
  };
}

export function resetState(state, seed) {
  const fresh = createInitialState(seed);
  state.zones = fresh.zones;
  state.agents = fresh.agents;
  state.incidents = fresh.incidents;
  state.assignments = fresh.assignments;
  state.constraints = fresh.constraints;
  state.started_at = fresh.started_at;
}

export function cloneState(state) {
  return {
    zones: state.zones.map((zone) => ({
      ...zone,
      required_skills: [...zone.required_skills],
      adjacency: zone.adjacency.map((edge) => ({ ...edge }))
    })),
    agents: state.agents.map((agent) => ({
      ...agent,
      skills: [...agent.skills],
      languages: [...agent.languages]
    })),
    incidents: state.incidents.map((incident) => ({
      ...incident,
      skills_needed: [...(incident.skills_needed || [])],
      backfills: (incident.backfills || []).map((backfill) => ({ ...backfill }))
    })),
    assignments: state.assignments.map((assignment) => ({ ...assignment })),
    constraints: state.constraints.map((constraint) => ({ ...constraint })),
    started_at: state.started_at
  };
}

export function findAgent(state, agentId) {
  return state.agents.find((agent) => agent.id === agentId);
}

export function findZone(state, zoneId) {
  return state.zones.find((zone) => zone.id === zoneId);
}

export function pendingAssignmentsForAgent(state, agentId) {
  return state.assignments.filter(
    (assignment) => assignment.agent_id === agentId && assignment.status === "sent"
  );
}


// state.js — store d'état vivant en mémoire. Construit depuis le seed, muté par le coordinateur.
import { computeTravelMatrix, headcount, surplus } from './engine.js';

// Construit un état frais (utilisé au boot ET pour reset démo / tests).
export function buildState({ zones, roster, constraints = [] }) {
  return {
    zones: zones.map((z) => ({ ...z })),
    agents: roster.map((a) => ({ ...a })),
    constraints: constraints.map((c) => ({ ...c })),
    travel: computeTravelMatrix(zones),
    // journaux runtime
    incidents: [],
    assignments: [],
    _seq: { incident: 0, assignment: 0, constraint: 0 },
  };
}

// Sérialisation pour l'event WS `state` (Contrat A) : zones avec headcount/surplus calculés.
export function serializeState(state) {
  return {
    agents: state.agents.map((a) => ({
      id: a.id,
      name: a.name,
      skills: a.skills,
      languages: a.languages,
      current_zone: a.current_zone,
      is_reserve: a.is_reserve,
      status: a.status,
    })),
    zones: state.zones.map((z) => ({
      id: z.id,
      name: z.name,
      required_min: z.required_min,
      required_skills: z.required_skills,
      adjacency: z.adjacency,
      headcount: headcount(state, z.id),
      surplus: surplus(state, z.id),
    })),
  };
}

// Mutations ------------------------------------------------------------------
export function setPosition(state, agentId, zoneId) {
  const a = state.agents.find((x) => x.id === agentId);
  if (a) a.current_zone = zoneId;
  return a;
}

export function setStatus(state, agentId, status) {
  const a = state.agents.find((x) => x.id === agentId);
  if (a) a.status = status;
  return a;
}

// Applique le nextState renvoyé par applyDecision (statuts d'agents mis à jour).
export function commitAgents(state, nextState) {
  const byId = new Map(nextState.agents.map((a) => [a.id, a]));
  for (const a of state.agents) {
    const n = byId.get(a.id);
    if (n) a.status = n.status;
  }
}

export function nextIncidentId(state) {
  return `inc_${++state._seq.incident}`;
}
export function addConstraint(state, { scope, rule_text, source_override = null }) {
  const c = { id: `c_${++state._seq.constraint}`, scope, rule_text, source_override, created_at: Date.now() };
  state.constraints.push(c);
  return c;
}

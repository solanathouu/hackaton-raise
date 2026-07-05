// presence.js — preuve de vie des téléphones (heartbeat, additif hors Contrat A).
// Un agent SANS heartbeat (ancien client, agent simulé en démo) reste joignable
// par défaut : rétrocompatible, rien ne casse si un seul téléphone émet.
// Module sans dépendance : importable par engine.js ET state.js sans cycle.

export const REACHABLE_MS = Number(process.env.HEARTBEAT_TTL_MS || 30000);

export function isReachable(agent, now = Date.now()) {
  return !agent?.last_heartbeat || now - agent.last_heartbeat < REACHABLE_MS;
}

// Horloge SERVEUR, jamais le ts client (dérive d'horloge des téléphones).
export function markHeartbeat(state, agentId, { battery = null } = {}) {
  const a = state.agents.find((x) => x.id === agentId);
  if (!a) return null;
  a.last_heartbeat = Date.now();
  if (battery != null && Number.isFinite(Number(battery))) a.battery = Math.round(Number(battery));
  return a;
}

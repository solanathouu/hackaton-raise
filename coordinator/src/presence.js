// presence.js — preuve de vie des téléphones (heartbeat, additif hors Contrat A).
// Un agent SANS heartbeat (ancien client, agent simulé en démo) reste joignable
// par défaut : rétrocompatible, rien ne casse si un seul téléphone émet.
// Module sans dépendance : importable par engine.js ET state.js sans cycle.

export const REACHABLE_MS = Number(process.env.HEARTBEAT_TTL_MS || 30000);

export function isReachable(agent, now = Date.now()) {
  return !agent?.last_heartbeat || now - agent.last_heartbeat < REACHABLE_MS;
}

// Horloge SERVEUR, jamais le ts client (dérive d'horloge des téléphones).
// Batterie bornée 0-100 : un client buggé n'affiche jamais « 99999% » sur la console.
export function markHeartbeat(state, agentId, { battery = null } = {}) {
  const a = state.agents.find((x) => x.id === agentId);
  if (!a) return null;
  a.last_heartbeat = Date.now();
  const b = Number(battery);
  if (battery != null && Number.isFinite(b)) a.battery = Math.min(100, Math.max(0, Math.round(b)));
  return a;
}

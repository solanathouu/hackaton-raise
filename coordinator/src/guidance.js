// guidance.js — suggestions de repositionnement proactif (P5 / opérateur + staff).
import { headcount, surplus, travelTime, zoneById } from './engine.js';

/** Distance approximative en mètres (Haversine). */
export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Zone la plus proche d'un point GPS (lat/lon ancrés sur le parc). */
export function nearestZone(zones, lat, lon, maxDistanceM = Infinity) {
  const hit = resolveGpsZone(zones, lat, lon, maxDistanceM);
  return hit?.zoneId ?? null;
}

/** Zone + distance ; null si hors périmètre maxDistanceM. */
export function resolveGpsZone(zones, lat, lon, maxDistanceM = Infinity) {
  if (lat == null || lon == null) return null;
  let best = null;
  let bestD = Infinity;
  for (const z of zones) {
    if (z.lat == null || z.lon == null) continue;
    const d = distanceM(lat, lon, z.lat, z.lon);
    if (d < bestD) {
      bestD = d;
      best = z.id;
    }
  }
  if (!best || bestD > maxDistanceM) return null;
  return { zoneId: best, distanceM: Math.round(bestD) };
}

function fmtEta(sec) {
  if (sec == null || sec === Infinity) return '?';
  if (sec < 60) return `${Math.round(sec)} s`;
  return `${Math.round(sec / 60)} min`;
}

/** Hint pour un agent disponible en surplus (ou réserviste) vers une zone sous-staffée. */
function hintForAgent(state, agent) {
  if (!agent || agent.status !== 'available') return null;
  const src = agent.current_zone;
  const srcSurplus = surplus(state, src);
  if (!agent.is_reserve && srcSurplus <= 0) return null;

  let best = null;
  for (const z of state.zones) {
    if (z.id === src) continue;
    const t = travelTime(state, src, z.id);
    if (t == null || t === Infinity) continue;
    const deficit = z.required_min - headcount(state, z.id);
    if (deficit <= 0) continue;
    const score = deficit * 1000 - t;
    if (!best || score > best.score) {
      best = { targetZone: z.id, zoneName: z.name, etaSec: t, deficit, score };
    }
  }
  if (!best) return null;

  const srcName = zoneById(state, src)?.name || src;
  return {
    agentId: agent.id,
    agentName: agent.name,
    fromZone: src,
    targetZone: best.targetZone,
    targetName: best.zoneName,
    etaSec: best.etaSec,
    reason: 'coverage_gap',
    message:
      `Reposition: ${best.zoneName} needs ${best.deficit} more agent(s). ` +
      `From ${srcName}, ETA ~${fmtEta(best.etaSec)}.`,
  };
}

/** Tous les hints actifs (un par agent éligible). */
export function computeRepositionHints(state) {
  const hints = [];
  for (const agent of state.agents) {
    const h = hintForAgent(state, agent);
    if (h) hints.push(h);
  }
  return hints;
}

export function hintForAgentId(state, agentId) {
  const agent = state.agents.find((a) => a.id === agentId);
  return hintForAgent(state, agent);
}

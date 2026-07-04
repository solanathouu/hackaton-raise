import zonesLayout from '../data/zones.json'

const zoneById = new Map(zonesLayout.map((z) => [z.id, z]))

// L'adjacence dans zones.json est déjà déclarée dans les deux sens, mais on
// construit le graphe en ajoutant les deux arêtes quoi qu'il arrive pour ne
// pas dépendre de cette symétrie côté données.
function buildGraph() {
  const graph = new Map(zonesLayout.map((z) => [z.id, new Map()]))
  for (const zone of zonesLayout) {
    for (const { z: neighborId, t } of zone.adjacency) {
      graph.get(zone.id).set(neighborId, t)
      if (!graph.has(neighborId)) graph.set(neighborId, new Map())
      graph.get(neighborId).set(zone.id, t)
    }
  }
  return graph
}

const GRAPH = buildGraph()

// Dijkstra sans tas de priorité : le graphe fait ~10 nœuds, un scan linéaire
// à chaque itération est largement suffisant.
export function computeShortestRoute(sourceId, targetId) {
  if (sourceId === targetId) return { path: [sourceId], totalSeconds: 0 }
  if (!GRAPH.has(sourceId) || !GRAPH.has(targetId)) return null

  const dist = new Map([[sourceId, 0]])
  const prev = new Map()
  const visited = new Set()

  for (;;) {
    let current = null
    let currentDist = Infinity
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < currentDist) {
        current = id
        currentDist = d
      }
    }
    if (current === null || current === targetId) break
    visited.add(current)

    for (const [neighborId, weight] of GRAPH.get(current)) {
      const candidate = currentDist + weight
      if (candidate < (dist.get(neighborId) ?? Infinity)) {
        dist.set(neighborId, candidate)
        prev.set(neighborId, current)
      }
    }
  }

  if (!dist.has(targetId)) return null

  const path = [targetId]
  let node = targetId
  while (node !== sourceId) {
    node = prev.get(node)
    path.unshift(node)
  }

  return { path, totalSeconds: dist.get(targetId) }
}

export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  if (minutes === 0) return `${seconds}s`
  if (seconds === 0) return `${minutes}min`
  return `${minutes}min${String(seconds).padStart(2, '0')}`
}

export function zoneName(id) {
  return zoneById.get(id)?.name ?? id
}

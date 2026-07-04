import { formatDuration, zoneName } from '../lib/routing'
import './RouteBanner.css'

// Affiché après "je m'en occupe" (F du PRD) : chemin le plus court calculé
// côté client via lib/routing.js sur le graphe d'adjacence de zones.json.
export function RouteBanner({ route, onArrived }) {
  if (!route) return null

  const alreadyThere = route.path.length <= 1

  if (alreadyThere) {
    return (
      <div className="route-banner route-banner--here">
        <span className="route-banner__text">Tu es déjà sur place · {zoneName(route.targetZone)}</span>
        <button type="button" className="route-banner__ok" onClick={onArrived}>
          OK
        </button>
      </div>
    )
  }

  return (
    <div className="route-banner">
      <div className="route-banner__head">
        <span className="route-banner__target">→ {zoneName(route.targetZone)}</span>
        <span className="route-banner__eta">~{formatDuration(route.totalSeconds)}</span>
      </div>
      <p className="route-banner__path">{route.path.join(' → ')}</p>
      <button type="button" className="route-banner__arrived" onClick={onArrived}>
        Arrivé sur zone
      </button>
    </div>
  )
}

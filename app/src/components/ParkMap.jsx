import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ZoneIcon, IncidentIcon } from './zoneIcons'
import { MapDecor } from './mapDecor'
import zonesLayout from '../data/zones.json'
import './ParkMap.css'

// Carte interactive façon Google Maps/Waze, toujours en SVG maison (pas de
// vraies coordonnées GPS dans le seed dataset — cf. README). Les liens
// d'adjacence sont dessinés comme des allées (fourreau gris + revêtement
// blanc, courbes déterministes), sur un fond de plan terrain (mapDecor).
// Interactions : pan avec inertie, pinch, molette, double-tap pour zoomer,
// boutons +/− / recentrage sur soi / réinitialisation, cadrage automatique
// sur l'itinéraire après un accusé de réception.

const VB_WIDTH = 900
const VB_HEIGHT = 650
const MIN_SCALE = 1
const MAX_SCALE = 5
const PAN_MARGIN = 60
const TAP_MOVE_THRESHOLD = 8
const DOUBLE_TAP_MS = 320
const ZONE_HIT_RADIUS = 26 // zone de tap confortable au doigt, plus large que l'icône visible
const LABEL_SCALE_THRESHOLD = 1.35 // en dessous, seuls les codes de zone sont lisibles
const BUTTON_ZOOM_FACTOR = 1.6
const ANIM_MS = 260
const FLING_MIN_SPEED = 0.25 // unités viewBox / ms
const FLING_FRICTION = 0.92
const VELOCITY_WINDOW_MS = 90

const IDENTITY = { scale: 1, x: 0, y: 0 }

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function clampTransform({ scale, x, y }) {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
  const limitX = ((s - 1) * VB_WIDTH) / 2 + PAN_MARGIN
  const limitY = ((s - 1) * VB_HEIGHT) / 2 + PAN_MARGIN
  return {
    scale: s,
    x: Math.min(limitX, Math.max(-limitX, x)),
    y: Math.min(limitY, Math.max(-limitY, y)),
  }
}

// Zoom vers `scale` en gardant le point viewBox `vb` fixe à l'écran.
function zoomAt(t, vb, scale) {
  const localX = (vb.x - t.x) / t.scale
  const localY = (vb.y - t.y) / t.scale
  return clampTransform({ scale, x: vb.x - localX * scale, y: vb.y - localY * scale })
}

function centerOn(point, scale) {
  return clampTransform({
    scale,
    x: VB_WIDTH / 2 - point.x * scale,
    y: VB_HEIGHT / 2 - point.y * scale,
  })
}

// Géométrie partagée allée/itinéraire : courbe quadratique déterministe entre
// deux zones (même tracé quel que soit le sens de parcours), pour que
// l'itinéraire épouse exactement le dessin des allées.
function edgePathD(a, b) {
  const [p, q] = a.id < b.id ? [a, b] : [b, a]
  const dx = q.x - p.x
  const dy = q.y - p.y
  const len = Math.hypot(dx, dy) || 1
  const seed = (p.id + q.id).split('').reduce((sum, c) => sum + c.charCodeAt(0), 0)
  const sign = seed % 2 === 0 ? 1 : -1
  const bend = sign * Math.min(42, Math.max(14, len * 0.16))
  const mx = (p.x + q.x) / 2 - (dy / len) * bend
  const my = (p.y + q.y) / 2 + (dx / len) * bend
  return `M${p.x} ${p.y}Q${mx} ${my} ${q.x} ${q.y}`
}

function zoneStatusLabel(zone, state, isActive) {
  if (isActive) return 'Incident en cours'
  if (!state) return 'Statut inconnu'
  const min = state.required_min ?? zone.required_min
  return state.headcount < min ? `Sous-effectif · ${state.headcount}/${min}` : `Couverture OK · ${state.headcount}/${min}`
}

export function ParkMap({ zoneStates, activeZoneIds, route, agentZoneId }) {
  const byId = useMemo(() => new Map(zonesLayout.map((z) => [z.id, z])), [])
  const svgRef = useRef(null)
  const gestureRef = useRef({
    pointers: new Map(),
    drag: null,
    pinch: null,
    moved: false,
    lastTap: null,
    samples: [], // derniers déplacements du doigt, pour la vitesse de fling
  })
  const rafRef = useRef(null)

  const [transform, setTransformState] = useState(IDENTITY)
  const transformRef = useRef(IDENTITY)
  const [selectedZoneId, setSelectedZoneId] = useState(null)

  const setTransform = useCallback((updater) => {
    setTransformState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      transformRef.current = next
      return next
    })
  }, [])

  const stopMotion = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  // Transition animée vers une transformation cible (zoom bouton, double-tap,
  // recentrage, cadrage d'itinéraire) — ease-out cubique, comme les
  // déplacements de caméra d'une app de navigation.
  const animateTo = useCallback((target, duration = ANIM_MS) => {
    stopMotion()
    const from = transformRef.current
    const start = performance.now()
    const step = (now) => {
      const k = Math.min(1, (now - start) / duration)
      const e = 1 - (1 - k) ** 3
      setTransform(clampTransform({
        scale: from.scale + (target.scale - from.scale) * e,
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
      }))
      if (k < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [stopMotion, setTransform])

  const startFling = useCallback((vx, vy) => {
    stopMotion()
    let last = performance.now()
    let speedX = vx
    let speedY = vy
    const step = (now) => {
      const dt = now - last
      last = now
      setTransform((t) => clampTransform({ scale: t.scale, x: t.x + speedX * dt, y: t.y + speedY * dt }))
      speedX *= FLING_FRICTION ** (dt / 16)
      speedY *= FLING_FRICTION ** (dt / 16)
      if (Math.hypot(speedX, speedY) > 0.02) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [stopMotion, setTransform])

  useEffect(() => stopMotion, [stopMotion])

  const clientToViewBox = useCallback((clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * VB_WIDTH,
      y: ((clientY - rect.top) / rect.height) * VB_HEIGHT,
    }
  }, [])

  const handlePointerDown = useCallback((e) => {
    stopMotion()
    svgRef.current.setPointerCapture(e.pointerId)
    const g = gestureRef.current
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    g.moved = false
    g.samples = []

    if (g.pointers.size === 1) {
      g.drag = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startTx: transformRef.current.x,
        startTy: transformRef.current.y,
      }
    } else if (g.pointers.size === 2) {
      const pts = [...g.pointers.values()]
      const mid = midpoint(pts[0], pts[1])
      const t = transformRef.current
      g.pinch = {
        startDist: distance(pts[0], pts[1]),
        startScale: t.scale,
        startVb: clientToViewBox(mid.x, mid.y),
        startTx: t.x,
        startTy: t.y,
      }
      g.drag = null
    }
  }, [stopMotion, clientToViewBox])

  const handlePointerMove = useCallback((e) => {
    const g = gestureRef.current
    if (!g.pointers.has(e.pointerId)) return
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (g.pointers.size >= 2 && g.pinch) {
      const pts = [...g.pointers.values()].slice(0, 2)
      const ratio = distance(pts[0], pts[1]) / g.pinch.startDist
      const newScale = g.pinch.startScale * ratio
      const { startVb, startTx, startTy, startScale } = g.pinch
      const localX = (startVb.x - startTx) / startScale
      const localY = (startVb.y - startTy) / startScale
      g.moved = true
      setTransform(
        clampTransform({ scale: newScale, x: startVb.x - localX * newScale, y: startVb.y - localY * newScale })
      )
    } else if (g.pointers.size === 1 && g.drag) {
      const dxClient = e.clientX - g.drag.startClientX
      const dyClient = e.clientY - g.drag.startClientY
      if (Math.hypot(dxClient, dyClient) > TAP_MOVE_THRESHOLD) g.moved = true
      const rect = svgRef.current.getBoundingClientRect()
      const dxVb = (dxClient / rect.width) * VB_WIDTH
      const dyVb = (dyClient / rect.height) * VB_HEIGHT

      // Échantillons récents (fenêtre glissante) pour estimer la vitesse de
      // relâchement et déclencher l'inertie.
      const now = e.timeStamp
      g.samples.push({ t: now, x: dxVb, y: dyVb })
      while (g.samples.length > 1 && now - g.samples[0].t > VELOCITY_WINDOW_MS) g.samples.shift()

      setTransform((t) => clampTransform({ scale: t.scale, x: g.drag.startTx + dxVb, y: g.drag.startTy + dyVb }))
    }
  }, [setTransform])

  // Détection du tap par calcul géométrique plutôt que via un onPointerUp
  // posé sur chaque <g> de zone : le svgRef capture le pointeur au pointerDown
  // (setPointerCapture), ce qui empêche les événements suivants d'atteindre
  // les enfants du DOM — seul le récepteur qui a capturé (le <svg>) les reçoit.
  const endGesture = useCallback((e) => {
    const g = gestureRef.current
    const wasSingleTap = g.pointers.size === 1 && !g.moved
    const wasDrag = g.pointers.size === 1 && g.moved && g.drag
    g.pointers.delete(e.pointerId)
    if (g.pointers.size < 2) g.pinch = null

    if (wasDrag && g.pointers.size === 0 && g.samples.length >= 2) {
      // Inertie : vitesse moyenne sur la fenêtre récente, en unités vb/ms.
      const first = g.samples[0]
      const last = g.samples[g.samples.length - 1]
      const dt = last.t - first.t
      if (dt > 0) {
        const vx = (last.x - first.x) / dt
        const vy = (last.y - first.y) / dt
        if (Math.hypot(vx, vy) > FLING_MIN_SPEED) startFling(vx, vy)
      }
    }
    if (g.pointers.size === 0) g.drag = null

    if (wasSingleTap && g.pointers.size === 0) {
      const now = Date.now()
      const tapPos = { x: e.clientX, y: e.clientY }
      const last = g.lastTap

      if (last && now - last.time < DOUBLE_TAP_MS && distance(last.pos, tapPos) < 30) {
        // Double-tap : zoom avant centré sur le doigt (comme Google Maps) ;
        // au niveau max, revient à la vue d'ensemble.
        const t = transformRef.current
        const vb = clientToViewBox(tapPos.x, tapPos.y)
        if (t.scale >= MAX_SCALE - 0.01) animateTo(IDENTITY)
        else animateTo(zoomAt(t, vb, t.scale * 2))
        g.lastTap = null
        return
      }

      const t = transformRef.current
      const vb = clientToViewBox(tapPos.x, tapPos.y)
      const localX = (vb.x - t.x) / t.scale
      const localY = (vb.y - t.y) / t.scale
      const tappedZone = zonesLayout.find(
        (z) => Math.hypot(z.x - localX, z.y - localY) <= ZONE_HIT_RADIUS
      )

      g.lastTap = { time: now, pos: tapPos }
      setSelectedZoneId((current) => {
        if (!tappedZone) return null
        return current === tappedZone.id ? null : tappedZone.id
      })
    }
  }, [startFling, clientToViewBox, animateTo])

  // Écouteur natif non-passif : React attache onWheel en mode passif, ce qui
  // empêche silencieusement preventDefault (le scroll/zoom du navigateur
  // continuerait en plus du zoom custom).
  useEffect(() => {
    const svgEl = svgRef.current
    const handleWheel = (e) => {
      e.preventDefault()
      stopMotion()
      const vb = clientToViewBox(e.clientX, e.clientY)
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18
      setTransform((t) => zoomAt(t, vb, t.scale * factor))
    }
    svgEl.addEventListener('wheel', handleWheel, { passive: false })
    return () => svgEl.removeEventListener('wheel', handleWheel)
  }, [clientToViewBox, stopMotion, setTransform])

  const zoomBy = useCallback((factor) => {
    const t = transformRef.current
    animateTo(zoomAt(t, { x: VB_WIDTH / 2, y: VB_HEIGHT / 2 }, t.scale * factor))
  }, [animateTo])

  const recenterOnAgent = useCallback(() => {
    const zone = agentZoneId ? byId.get(agentZoneId) : null
    if (!zone) return
    animateTo(centerOn(zone, Math.max(transformRef.current.scale, 2)), 380)
  }, [agentZoneId, byId, animateTo])

  const resetView = useCallback(() => {
    animateTo(IDENTITY)
    setSelectedZoneId(null)
  }, [animateTo])

  // Quand un itinéraire démarre, cadre automatiquement la caméra dessus
  // (comportement "démarrer la navigation" de Waze).
  const routeKey = route?.join('>')
  useEffect(() => {
    if (!route || route.length < 2) return
    const pts = route.map((id) => byId.get(id)).filter(Boolean)
    if (pts.length < 2) return
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const pad = 90
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(VB_WIDTH / (maxX - minX + pad * 2), VB_HEIGHT / (maxY - minY + pad * 2)))
    )
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
    animateTo(centerOn(center, scale), 420)
    // routeKey suffit comme dépendance : route est recréé à chaque rendu parent.
  }, [routeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const edges = useMemo(
    () =>
      zonesLayout.flatMap((zone) =>
        zone.adjacency
          .filter((adj) => zone.id < adj.z) // évite de dessiner chaque allée deux fois
          .map((adj) => ({ key: `${zone.id}-${adj.z}`, d: edgePathD(zone, byId.get(adj.z)) }))
      ),
    [byId]
  )

  const routeSegments = useMemo(() => {
    if (!route || route.length < 2) return []
    const segments = []
    for (let i = 0; i < route.length - 1; i += 1) {
      const from = byId.get(route[i])
      const to = byId.get(route[i + 1])
      if (from && to) segments.push({ key: `${from.id}-${to.id}`, d: edgePathD(from, to) })
    }
    return segments
  }, [route, byId])

  const destinationZone = route && route.length > 1 ? byId.get(route[route.length - 1]) : null
  const agentZone = agentZoneId ? byId.get(agentZoneId) : null
  const selectedZone = selectedZoneId ? byId.get(selectedZoneId) : null
  const labelsVisible = transform.scale >= LABEL_SCALE_THRESHOLD

  return (
    <div className="park-map-wrap">
      <svg
        ref={svgRef}
        className={`park-map${labelsVisible ? ' park-map--labels' : ''}`}
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        role="img"
        aria-label="Plan du site, interactif : pincer pour zoomer, glisser pour déplacer, double-tap pour zoomer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onPointerLeave={endGesture}
      >
        <rect width={VB_WIDTH} height={VB_HEIGHT} className="park-map__outside" />
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          <MapDecor />

          {/* Allées : fourreau puis revêtement, comme les routes Google Maps */}
          {edges.map(({ key, d }) => (
            <path key={`casing-${key}`} d={d} className="park-map__path-casing" />
          ))}
          {edges.map(({ key, d }) => (
            <path key={`fill-${key}`} d={d} className="park-map__path-fill" />
          ))}

          {/* Itinéraire actif : tracé rouge continu + flux de points animé */}
          {routeSegments.map(({ key, d }) => (
            <path key={`route-${key}`} d={d} className="park-map__route" />
          ))}
          {routeSegments.map(({ key, d }) => (
            <path key={`route-flow-${key}`} d={d} className="park-map__route-flow" />
          ))}

          {zonesLayout.map((zone) => {
            const state = zoneStates?.find((z) => z.id === zone.id)
            const isActive = activeZoneIds?.has(zone.id)
            const headcount = state?.headcount
            const min = state?.required_min ?? zone.required_min

            return (
              <g
                key={zone.id}
                transform={`translate(${zone.x}, ${zone.y})`}
                className="park-map__zone"
              >
                {isActive && <circle r="21" className="park-map__halo" />}
                <circle r={isActive ? 17 : 13} className={`park-map__badge${isActive ? ' park-map__badge--active' : ''}`} />
                <g className="park-map__icon" transform={`translate(${isActive ? -11 : -8}, ${isActive ? -11 : -8})`}>
                  {isActive ? <IncidentIcon size={22} /> : <ZoneIcon zoneId={zone.id} size={16} />}
                </g>
                <text y={isActive ? 34 : 26} className="park-map__code">
                  {zone.id}
                </text>
                {headcount !== undefined && (
                  <text y={isActive ? 46 : 38} className="park-map__count">
                    {headcount}/{min}
                  </text>
                )}
                <text y={isActive ? 58 : 50} className="park-map__name">
                  {zone.name}
                </text>
              </g>
            )
          })}

          {/* Épingle de destination (bout de l'itinéraire) */}
          {destinationZone && (
            <g transform={`translate(${destinationZone.x}, ${destinationZone.y - 22})`}>
              <g className="park-map__pin">
                <path d="M0 22C-6 12-11 7-11-2a11 11 0 1 1 22 0c0 9-5 14-11 24z" className="park-map__pin-body" />
                <circle cy="-2" r="4" className="park-map__pin-dot" />
              </g>
            </g>
          )}

          {/* Position de l'agent — pastille "vous êtes ici" */}
          {agentZone && (
            <g transform={`translate(${agentZone.x + 20}, ${agentZone.y + 14})`} className="park-map__me">
              <circle r="12" className="park-map__me-pulse" />
              <circle r="7" className="park-map__me-ring" />
              <circle r="4.5" className="park-map__me-dot" />
              <text y="22" className="park-map__me-label">MOI</text>
            </g>
          )}

          {selectedZone && (
            <g transform={`translate(${selectedZone.x}, ${selectedZone.y})`} className="park-map__tooltip">
              <foreignObject x="-70" y="-78" width="140" height="52">
                <div className="park-map__tooltip-box">
                  <strong>{selectedZone.id} · {selectedZone.name}</strong>
                  <span>
                    {zoneStatusLabel(
                      selectedZone,
                      zoneStates?.find((z) => z.id === selectedZone.id),
                      activeZoneIds?.has(selectedZone.id)
                    )}
                  </span>
                </div>
              </foreignObject>
            </g>
          )}
        </g>
      </svg>

      <div className="park-map__controls">
        <button type="button" className="park-map__ctrl" onClick={resetView} aria-label="Réinitialiser la vue de la carte">
          <ResetIcon />
        </button>
        <button type="button" className="park-map__ctrl" onClick={recenterOnAgent} aria-label="Recentrer sur ma position">
          <LocateIcon />
        </button>
        <div className="park-map__zoom-group">
          <button type="button" className="park-map__ctrl" onClick={() => zoomBy(BUTTON_ZOOM_FACTOR)} aria-label="Zoomer">
            <PlusIcon />
          </button>
          <button type="button" className="park-map__ctrl" onClick={() => zoomBy(1 / BUTTON_ZOOM_FACTOR)} aria-label="Dézoomer">
            <MinusIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

function ResetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4 10a6 6 0 1 1 1.8 4.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M4 14.5V10h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

function LocateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="3" fill="currentColor" />
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <path d="M10 1v3M10 16v3M1 10h3M16 10h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function MinusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

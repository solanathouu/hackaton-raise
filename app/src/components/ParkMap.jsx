import { useCallback, useMemo, useRef, useState } from 'react'
import { ZoneIcon, IncidentIcon } from './zoneIcons'
import zonesLayout from '../data/zones.json'
import './ParkMap.css'

// Plan de parc stylisé statique (pas de vraies coordonnées GPS dans le seed
// dataset — Leaflet serait surdimensionné ici, cf. PRD section 13 : "carte en
// support, pas héros"). Positions x/y fixes définies dans data/zones.json.
// Le pan/zoom ci-dessous est une transformation SVG maison (translate+scale
// sur un <g>), pas une vraie projection géo : suffisant pour un plan
// illustré statique.

const VB_WIDTH = 900
const VB_HEIGHT = 650
const MIN_SCALE = 1
const MAX_SCALE = 4
const PAN_MARGIN = 60
const TAP_MOVE_THRESHOLD = 8
const DOUBLE_TAP_MS = 320

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

function zoneStatusLabel(zone, state, isActive) {
  if (isActive) return 'Incident en cours'
  if (!state) return 'Statut inconnu'
  const min = state.required_min ?? zone.required_min
  return state.headcount < min ? `Sous-effectif · ${state.headcount}/${min}` : `Couverture OK · ${state.headcount}/${min}`
}

export function ParkMap({ zoneStates, activeZoneIds, route }) {
  const byId = useMemo(() => new Map(zonesLayout.map((z) => [z.id, z])), [])
  const svgRef = useRef(null)
  const gestureRef = useRef({
    pointers: new Map(),
    drag: null,
    pinch: null,
    moved: false,
    lastTap: null,
  })

  const [transform, setTransform] = useState(IDENTITY)
  const [selectedZoneId, setSelectedZoneId] = useState(null)

  const resetView = useCallback(() => {
    setTransform(IDENTITY)
    setSelectedZoneId(null)
  }, [])

  const clientToViewBox = useCallback((clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * VB_WIDTH,
      y: ((clientY - rect.top) / rect.height) * VB_HEIGHT,
    }
  }, [])

  const handlePointerDown = useCallback((e) => {
    svgRef.current.setPointerCapture(e.pointerId)
    const g = gestureRef.current
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    g.moved = false

    if (g.pointers.size === 1) {
      g.drag = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startTx: transform.x,
        startTy: transform.y,
      }
    } else if (g.pointers.size === 2) {
      const pts = [...g.pointers.values()]
      const mid = midpoint(pts[0], pts[1])
      g.pinch = {
        startDist: distance(pts[0], pts[1]),
        startScale: transform.scale,
        startVb: clientToViewBox(mid.x, mid.y),
        startTx: transform.x,
        startTy: transform.y,
      }
      g.drag = null
    }
  }, [transform, clientToViewBox])

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
      setTransform((t) => clampTransform({ scale: t.scale, x: g.drag.startTx + dxVb, y: g.drag.startTy + dyVb }))
    }
  }, [])

  const endGesture = useCallback((e) => {
    const g = gestureRef.current
    const wasSingleTap = g.pointers.size === 1 && !g.moved
    g.pointers.delete(e.pointerId)
    if (g.pointers.size < 2) g.pinch = null
    if (g.pointers.size === 0) g.drag = null

    if (wasSingleTap && g.pointers.size === 0) {
      const now = Date.now()
      const tapPos = { x: e.clientX, y: e.clientY }
      const last = g.lastTap
      if (last && now - last.time < DOUBLE_TAP_MS && distance(last.pos, tapPos) < 30) {
        resetView()
        g.lastTap = null
      } else {
        g.lastTap = { time: now, pos: tapPos }
        setSelectedZoneId(null)
      }
    }
  }, [resetView])

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const vb = clientToViewBox(e.clientX, e.clientY)
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18
    setTransform((t) => {
      const newScale = t.scale * factor
      const localX = (vb.x - t.x) / t.scale
      const localY = (vb.y - t.y) / t.scale
      return clampTransform({ scale: newScale, x: vb.x - localX * newScale, y: vb.y - localY * newScale })
    })
  }, [clientToViewBox])

  const handleZoneTap = useCallback((zoneId) => (e) => {
    e.stopPropagation()
    if (gestureRef.current.moved) return
    gestureRef.current.lastTap = null
    setSelectedZoneId((current) => (current === zoneId ? null : zoneId))
  }, [])

  const routeSegments = useMemo(() => {
    if (!route || route.length < 2) return []
    const segments = []
    for (let i = 0; i < route.length - 1; i += 1) {
      const from = byId.get(route[i])
      const to = byId.get(route[i + 1])
      if (from && to) segments.push({ key: `${from.id}-${to.id}`, from, to })
    }
    return segments
  }, [route, byId])

  const selectedZone = selectedZoneId ? byId.get(selectedZoneId) : null

  return (
    <div className="park-map-wrap">
      <svg
        ref={svgRef}
        className="park-map"
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        role="img"
        aria-label="Plan du site, interactif : pincer pour zoomer, glisser pour déplacer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onPointerLeave={endGesture}
        onWheel={handleWheel}
      >
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {zonesLayout.flatMap((zone) =>
            zone.adjacency
              .filter((adj) => zone.id < adj.z) // évite de dessiner chaque lien deux fois
              .map((adj) => {
                const target = byId.get(adj.z)
                return (
                  <line
                    key={`${zone.id}-${adj.z}`}
                    x1={zone.x}
                    y1={zone.y}
                    x2={target.x}
                    y2={target.y}
                    className="park-map__link"
                  />
                )
              })
          )}

          {routeSegments.map(({ key, from, to }) => (
            <line key={key} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="park-map__route" />
          ))}
          {route?.map((zoneId) => {
            const zone = byId.get(zoneId)
            return <circle key={`route-dot-${zoneId}`} cx={zone.x} cy={zone.y} r="5" className="park-map__route-dot" />
          })}

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
                onPointerUp={handleZoneTap(zone.id)}
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
              </g>
            )
          })}

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

      <button type="button" className="park-map__reset" onClick={resetView} aria-label="Réinitialiser la vue de la carte">
        <ResetIcon />
      </button>
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

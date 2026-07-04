// graph.js — géométrie du parc : positions des zones, allées COURBES le long des adjacences,
// échantillonnage de trajets par abscisse curviligne. Les agents suivent exactement les mêmes
// courbes que les allées dessinées (cohérence visuelle totale).
import * as THREE from "three";
import { zoneSeed } from "./data.js";

export const WALK_Y = 0.06; // hauteur de marche au-dessus du sol

const zonePosById = new Map(zoneSeed.map((z) => [z.id, new THREE.Vector3(z.pos[0], 0, z.pos[2])]));
// Points spéciaux hors zones (choré ambulance du mode demo).
zonePosById.set("AMB", new THREE.Vector3(22, 0, 13));

export function zonePos(id) {
  return (zonePosById.get(id) || zonePosById.get("Z5")).clone();
}

// Bow déterministe par arête (pas de Math.random : même rendu sur tous les écrans).
function edgeBow(aId, bId) {
  let h = 0;
  for (const c of aId + bId) h = (h * 31 + c.charCodeAt(0)) % 997;
  const side = h % 2 === 0 ? 1 : -1;
  const amount = 0.1 + (h % 5) * 0.02; // 10% à 18% de la longueur
  return { side, amount };
}

function makeEdgeCurve(aId, bId) {
  const a = zonePos(aId);
  const b = zonePos(bId);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const { side, amount } = edgeBow(aId, bId);
  mid.add(perp.multiplyScalar(side * amount * len));
  a.y = WALK_Y; b.y = WALK_Y; mid.y = WALK_Y;
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

// Arêtes uniques (A|B trié) -> courbe canonique orientée A->B.
const edgeCurves = new Map();
for (const z of zoneSeed) {
  for (const e of z.adjacency || []) {
    const key = [z.id, e.z].sort().join("|");
    if (!edgeCurves.has(key)) {
      const [a, b] = key.split("|");
      edgeCurves.set(key, makeEdgeCurve(a, b));
    }
  }
}

export function allEdgeCurves() {
  return [...edgeCurves.values()];
}

function curveFor(aId, bId) {
  const key = [aId, bId].sort().join("|");
  const canonical = edgeCurves.get(key);
  if (!canonical) {
    // Arête hors graphe (ex: -> AMB) : segment droit.
    const a = zonePos(aId); a.y = WALK_Y;
    const b = zonePos(bId); b.y = WALK_Y;
    return { curve: new THREE.LineCurve3(a, b), reversed: false };
  }
  const reversed = key.split("|")[0] !== aId;
  return { curve: canonical, reversed };
}

/**
 * Construit une route multi-segments le long des allées.
 * @param {string[]} zones - chemin de zones (issu de Dijkstra), ex ["Z2","Z8"]
 * @param {THREE.Vector3} [finalTarget] - point exact d'arrivée (patient) ajouté après la dernière zone
 * @param {THREE.Vector3} [startPoint] - point de départ réel (figurine déjà en mouvement) préfixé avant la 1re zone
 * @returns {{ totalLength:number, sample(t:number):{position:THREE.Vector3, direction:THREE.Vector3} }}
 */
export function buildRoute(zones, finalTarget = null, startPoint = null) {
  const segs = [];
  if (startPoint && zones.length) {
    const from = startPoint.clone(); from.y = WALK_Y;
    const to = zonePos(zones[0]); to.y = WALK_Y;
    const line = new THREE.LineCurve3(from, to);
    segs.push({ curve: line, reversed: false, length: line.getLength() });
  }
  for (let i = 0; i < zones.length - 1; i++) {
    const { curve, reversed } = curveFor(zones[i], zones[i + 1]);
    segs.push({ curve, reversed, length: curve.getLength() });
  }
  if (finalTarget) {
    const from = zonePos(zones[zones.length - 1]); from.y = WALK_Y;
    const to = finalTarget.clone(); to.y = WALK_Y;
    const line = new THREE.LineCurve3(from, to);
    segs.push({ curve: line, reversed: false, length: line.getLength() });
  }
  if (!segs.length) {
    // Trajet nul : rester sur place.
    const p = zonePos(zones[0] || "Z5"); p.y = WALK_Y;
    return {
      totalLength: 0,
      sample: () => ({ position: p.clone(), direction: new THREE.Vector3(0, 0, 1) }),
    };
  }
  const totalLength = segs.reduce((s, seg) => s + seg.length, 0);
  return {
    totalLength,
    sample(t) {
      let d = THREE.MathUtils.clamp(t, 0, 1) * totalLength;
      for (const seg of segs) {
        if (d <= seg.length || seg === segs[segs.length - 1]) {
          const u = seg.length > 0 ? THREE.MathUtils.clamp(d / seg.length, 0, 1) : 1;
          const uu = seg.reversed ? 1 - u : u;
          const position = seg.curve.getPointAt(uu);
          const direction = seg.curve.getTangentAt(uu);
          if (seg.reversed) direction.negate();
          return { position, direction };
        }
        d -= seg.length;
      }
      const last = segs[segs.length - 1];
      const uu = last.reversed ? 0 : 1;
      return { position: last.curve.getPointAt(uu), direction: last.curve.getTangentAt(uu) };
    },
  };
}

/** Points échantillonnés d'une route (pour tracer un beam/tube). */
export function routePoints(zones, finalTarget = null, divisions = 48) {
  const route = buildRoute(zones, finalTarget);
  const pts = [];
  for (let i = 0; i <= divisions; i++) pts.push(route.sample(i / divisions).position);
  return pts;
}

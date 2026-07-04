// agents.js — figurines des agents staff : corps couleur compétence, anneau de statut au sol,
// étiquette nom, déplacements interpolés LE LONG DES ALLÉES (mêmes courbes que le décor),
// orientation lissée + bob de marche. Gère les agents découverts dynamiquement via le state live.
import * as THREE from "three";
import { buildRoute, zonePos } from "./graph.js";
import { makeLabel } from "./labels.js";
import { PLATFORM_TOP } from "./park.js";
import { PALETTE } from "./scene.js";

const RESPONSE_SPEEDUP = 11; // aligné moteurs demo/live
const GOLDEN = 2.399963229728653;

export const SKILL_COLOR = { reserve: "#a78bfa", medic: "#2dd4bf", RCP: "#60a5fa", secu: "#facc15", "first-aid": "#4ade80", DAE: "#93c5fd" };
const STATUS_RING = {
  available: "#2ea043",
  pending_ack: "#e3b341",
  responding: "#f85149",
  backfilling: "#388bfd",
  treating: "#ff7b72",
  transporting: "#e6edf3",
};

function skillColor(agent) {
  if (agent.isReserve) return SKILL_COLOR.reserve;
  for (const s of ["medic", "RCP", "secu", "first-aid", "DAE"]) if (agent.skills?.includes(s)) return SKILL_COLOR[s];
  return "#4ade80";
}

function makeFigurine(agent) {
  const group = new THREE.Group();
  const color = skillColor(agent);

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.21, 0.46, 6, 14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: color, emissiveIntensity: 0.14 }),
  );
  body.position.y = 0.52;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 14, 14),
    new THREE.MeshStandardMaterial({ color: "#e8d3bd", roughness: 0.7 }),
  );
  head.position.y = 1.02;
  head.castShadow = true;
  group.add(head);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.175, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: "#1f2732", roughness: 0.5 }),
  );
  cap.position.y = 1.05;
  group.add(cap);

  const ringMat = new THREE.MeshStandardMaterial({ color: "#0d1117", emissive: STATUS_RING.available, emissiveIntensity: 1.6, roughness: 0.5 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 28), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.045;
  group.add(ring);

  if (agent.isReserve) {
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6),
      new THREE.MeshStandardMaterial({ color: SKILL_COLOR.reserve, emissive: SKILL_COLOR.reserve, emissiveIntensity: 1.4 }));
    antenna.position.y = 1.32;
    group.add(antenna);
  }

  const label = makeLabel(agent.name, { fontSize: 0.42, borderColor: color, padding: 0.26 });
  label.position.y = 1.72;
  group.add(label);

  return { group, ringMat, label, body };
}

export function createAgentManager(scene, engine, { onArrival } = {}) {
  const visuals = new Map(); // agentId -> visual
  const restCount = new Map(); // zoneId -> nb de slots posés (répartition)

  function restPosition(agent, zoneId) {
    const idx = (restCount.get(zoneId) || 0);
    restCount.set(zoneId, idx + 1);
    const center = zonePos(zoneId);
    const angle = idx * GOLDEN + (agent.isReserve ? 1.2 : 0);
    const radius = 1.15 + (idx % 3) * 0.55 + (agent.isReserve ? 0.7 : 0);
    return new THREE.Vector3(
      center.x + Math.cos(angle) * radius,
      PLATFORM_TOP,
      center.z + Math.sin(angle) * radius,
    );
  }

  function ensureVisual(agent) {
    let v = visuals.get(agent.id);
    if (v) return v;
    const fig = makeFigurine(agent);
    const rest = restPosition(agent, agent.currentZone || "Z5");
    fig.group.position.copy(rest);
    scene.add(fig.group);
    v = {
      agent,
      ...fig,
      rest,
      zoneId: agent.currentZone,
      move: null,        // { route, duration, elapsed, role, incidentId, targetZone, endPos }
      glide: null,       // { from, to, t } — relocalisation douce (reset / resync)
      bobPhase: (agent.id.charCodeAt(1) || 65) * 0.7,
      lastStatus: null,
    };
    visuals.set(agent.id, v);
    return v;
  }

  /** Crée les figurines manquantes + REBIND les références (reset demo recrée engine.agents). */
  function syncRoster() {
    for (const agent of engine.agents) {
      const v = visuals.get(agent.id);
      if (v) v.agent = agent; // référence fraîche (sinon statut/zone figés après reset)
      else ensureVisual(agent);
    }
  }

  /** Statut -> anneau. Appelé à chaque frame (léger, set si changement). */
  function refreshStatus(v) {
    const status = v.agent.status || "available";
    if (status !== v.lastStatus) {
      v.lastStatus = status;
      v.ringMat.emissive.set(STATUS_RING[status] || STATUS_RING.available);
    }
  }

  /** Resynchronisation douce : l'état serveur dit "posé en zone X" mais la figurine est ailleurs. */
  function reconcile() {
    for (const v of visuals.values()) {
      const a = v.agent;
      if (v.move || a.status !== "available") continue;
      if (a.currentZone && a.currentZone !== v.zoneId) {
        v.zoneId = a.currentZone;
        v.rest = restPosition(a, a.currentZone);
        v.glide = { from: v.group.position.clone(), to: v.rest.clone(), t: 0 };
      }
    }
  }

  /** Event `move` du moteur : déplacement animé le long des allées. */
  function startMove(detail) {
    const v = visuals.get(detail.agentId);
    if (!v) return null;
    const zones = detail.path?.length ? detail.path : [v.zoneId || v.agent.currentZone, detail.targetZone];
    let finalTarget = null;
    if (detail.role === "primary") {
      const inc = engine.incidents.find((i) => i.id === detail.incidentId);
      if (inc?.patientOffset) {
        finalTarget = zonePos(inc.zoneId).add(new THREE.Vector3(inc.patientOffset[0], 0, inc.patientOffset[2]));
      }
    } else if (detail.role === "backfill") {
      finalTarget = restPosition(v.agent, detail.targetZone);
    }
    // Si la figurine est loin du départ théorique (re-dispatch pendant un move, re-route live),
    // on préfixe la route par sa position réelle : pas de snap-back au centre de la zone.
    const startPoint = v.group.position.distanceTo(zonePos(zones[0])) > 1.8 ? v.group.position.clone() : null;
    const route = buildRoute(zones, finalTarget, startPoint);
    const minDuration = detail.role === "primary" ? 1.6 : detail.role === "ambulance" ? 2.6 : 2.3;
    const duration = Math.max(minDuration, (detail.travelTime ?? 60) / RESPONSE_SPEEDUP);
    v.move = {
      route, duration, elapsed: 0,
      role: detail.role, incidentId: detail.incidentId, targetZone: detail.targetZone,
    };
    v.glide = null;
    v.zoneId = null; // en transit
    return route;
  }

  const _dir = new THREE.Vector3();
  function update(dt, t) {
    for (const v of visuals.values()) {
      refreshStatus(v);
      if (v.move) {
        const m = v.move;
        m.elapsed += dt;
        const raw = Math.min(m.elapsed / m.duration, 1);
        const k = THREE.MathUtils.smoothstep(raw, 0, 1);
        const { position, direction } = m.route.sample(k);
        v.group.position.copy(position);
        v.group.position.y += Math.abs(Math.sin(raw * Math.PI * 7)) * 0.06; // foulée
        if (direction.lengthSq() > 1e-4) {
          _dir.copy(direction);
          const target = Math.atan2(_dir.x, _dir.z);
          // delta wrappé sur ]-π, π] : pas de pirouette quand l'angle traverse ±π
          let dAng = target - v.group.rotation.y;
          dAng = Math.atan2(Math.sin(dAng), Math.cos(dAng));
          v.group.rotation.y += dAng * Math.min(1, dt * 9);
        }
        if (raw >= 1) {
          const done = m;
          v.move = null;
          v.zoneId = done.targetZone;
          v.rest = v.group.position.clone().setY(PLATFORM_TOP);
          if (done.role === "ambulance") {
            v.zoneId = null; // la figurine est au point AMB, pas en Z10 -> reconcile() la glissera au Parking
            engine.completeAmbulance(v.agent.id, done.incidentId);
          } else {
            engine.completeMove(v.agent.id, done.role, done.incidentId, done.targetZone);
          }
          onArrival?.(v.agent, done);
        }
      } else if (v.glide) {
        v.glide.t += dt / 0.9;
        const k = THREE.MathUtils.smoothstep(Math.min(v.glide.t, 1), 0, 1);
        v.group.position.lerpVectors(v.glide.from, v.glide.to, k);
        if (v.glide.t >= 1) v.glide = null;
      } else {
        // repos : respiration légère
        v.group.position.y = v.rest.y + Math.sin(t * 1.8 + v.bobPhase) * 0.025;
      }
    }
  }

  function agentPosition(agentId) {
    return visuals.get(agentId)?.group.position.clone() || null;
  }

  /** Réinitialisation dure (reset demo) : replace tout le monde à son slot. */
  function hardReset() {
    restCount.clear();
    for (const [id, v] of visuals) {
      const fresh = engine.agentById?.get(id);
      if (fresh) v.agent = fresh; // le reset du moteur demo recrée les objets agents
      v.move = null;
      v.glide = null;
      v.lastStatus = null;
      v.zoneId = v.agent.currentZone;
      v.rest = restPosition(v.agent, v.agent.currentZone || "Z5");
      v.group.position.copy(v.rest);
    }
  }

  return { syncRoster, reconcile, startMove, update, agentPosition, hardReset, visuals };
}

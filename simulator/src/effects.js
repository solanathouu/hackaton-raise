// effects.js — langage visuel des événements : balise d'incident (pilier de lumière + ondes de
// choc + gyrophare, intensité ∝ sévérité), beams de dispatch le long des allées (couleur par
// rôle), flash d'accusé. Auto-atténuation pour ne jamais encombrer le grand écran.
import * as THREE from "three";
import { zonePos } from "./graph.js";
import { PALETTE } from "./scene.js";

const ROLE_COLOR = { primary: "#f85149", backfill: "#388bfd", ambulance: "#e6edf3", reroute: "#e3b341" };
const INCIDENT_DIM_AFTER = 40; // s avant atténuation (live: pas d'event de clôture)
const MAX_INCIDENTS = 4;

// Libère géométries/matériaux/textures d'un objet retiré de la scène (anti-fuite VRAM
// sur les longues sessions grand écran).
function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.map?.dispose();
        m.dispose();
      }
    }
  });
}

export function createEffects(scene) {
  const incidents = new Map(); // incidentId -> visual
  const beams = [];            // { mesh, mat, life }
  const flashes = [];          // { mesh, mat, t }

  // --- incident ---------------------------------------------------------------
  function spawnIncident(incident) {
    if (incidents.has(incident.id)) return;
    const sev = THREE.MathUtils.clamp(incident.severity || 3, 1, 5);
    const pos = zonePos(incident.zoneId);
    if (incident.patientOffset) pos.add(new THREE.Vector3(incident.patientOffset[0], 0, incident.patientOffset[2]));

    const group = new THREE.Group();
    group.position.copy(pos);
    scene.add(group);

    const patient = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.17, 0.5, 6, 10),
      new THREE.MeshStandardMaterial({ color: "#d6c6b5", roughness: 0.8 }),
    );
    patient.rotation.z = Math.PI / 2;
    patient.position.y = 0.22;
    group.add(patient);

    const pillarH = 4 + sev * 1.6;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.52, pillarH, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color: PALETTE.bad, transparent: true, opacity: 0.24,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    pillar.position.y = pillarH / 2;
    group.add(pillar);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.05, 8, 48),
      new THREE.MeshBasicMaterial({ color: PALETTE.bad, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);

    // ondes de choc (3 anneaux expansifs déphasés)
    const waves = [];
    for (let i = 0; i < 3; i++) {
      const wave = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.035, 6, 48),
        new THREE.MeshBasicMaterial({ color: PALETTE.bad, transparent: true, opacity: 0, depthWrite: false }),
      );
      wave.rotation.x = Math.PI / 2;
      wave.position.y = 0.05;
      group.add(wave);
      waves.push({ mesh: wave, offset: i / 3 });
    }

    const light = new THREE.PointLight(PALETTE.bad, 10 + sev * 5, 11 + sev, 2);
    light.position.y = 1.6;
    group.add(light);

    incidents.set(incident.id, { group, pillar, ring, waves, light, sev, age: 0, closing: false });

    // limite d'encombrement : on retire la plus ancienne
    if (incidents.size > MAX_INCIDENTS) {
      const oldest = [...incidents.keys()][0];
      closeIncident(oldest);
    }
  }

  function closeIncident(incidentId) {
    const v = incidents.get(incidentId);
    if (v && !v.closing) {
      v.closing = true;
      v.closeAge = v.age;
    }
  }

  // --- beams de dispatch --------------------------------------------------------
  function spawnBeam(points, role) {
    if (!points || points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(points.map((p) => p.clone().setY(p.y + 0.16)));
    const mat = new THREE.MeshBasicMaterial({
      color: ROLE_COLOR[role] || PALETTE.accent, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 52, 0.075, 7, false), mat);
    scene.add(mesh);
    beams.push({ mesh, mat, life: 5.2 });
  }

  // --- flash d'accusé -------------------------------------------------------------
  function ackFlash(position) {
    if (!position) return;
    const mat = new THREE.MeshBasicMaterial({ color: PALETTE.ok, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 8, 36), mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(position).setY(0.1);
    scene.add(mesh);
    flashes.push({ mesh, mat, t: 0 });
  }

  function clearAll() {
    for (const id of [...incidents.keys()]) {
      const v = incidents.get(id);
      scene.remove(v.group);
      disposeObject(v.group);
      incidents.delete(id);
    }
    for (const b of beams) { scene.remove(b.mesh); disposeObject(b.mesh); }
    beams.length = 0;
    for (const f of flashes) { scene.remove(f.mesh); disposeObject(f.mesh); }
    flashes.length = 0;
  }

  // --- boucle ------------------------------------------------------------------
  function update(dt, t) {
    for (const [id, v] of incidents) {
      v.age += dt;
      const dim = v.closing
        ? Math.max(0, 1 - (v.age - v.closeAge) * 1.2) // décroissance monotone (pas de re-flash)
        : v.age > INCIDENT_DIM_AFTER ? 0.35 : 1;
      if (v.closing) {
        v.group.scale.multiplyScalar(1 - dt * 1.6);
        if (v.group.scale.x < 0.05) {
          scene.remove(v.group);
          disposeObject(v.group);
          incidents.delete(id);
          continue;
        }
      }
      v.ring.scale.setScalar(1 + Math.sin(t * 5.2) * 0.16);
      v.ring.material.opacity = (0.65 + Math.sin(t * 5.2) * 0.3) * dim;
      v.pillar.material.opacity = (0.15 + (Math.sin(t * 3.1) + 1) * 0.07) * dim;
      v.light.intensity = (8 + v.sev * 4) * (0.55 + (Math.sin(t * 7.3) + 1) * 0.3) * dim;
      for (const w of v.waves) {
        const phase = (t * 0.55 + w.offset) % 1;
        const r = 1 + phase * (2.2 + v.sev * 0.5);
        w.mesh.scale.setScalar(r);
        w.mesh.material.opacity = (1 - phase) * 0.5 * dim;
      }
    }
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      b.life -= dt;
      if (b.life < 2) b.mat.opacity = Math.max(0, b.life / 2) * 0.85;
      if (b.life <= 0) {
        scene.remove(b.mesh);
        disposeObject(b.mesh);
        beams.splice(i, 1);
      }
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t += dt;
      f.mesh.scale.setScalar(1 + f.t * 5);
      f.mat.opacity = Math.max(0, 0.9 - f.t * 1.1);
      if (f.t > 0.9) {
        scene.remove(f.mesh);
        disposeObject(f.mesh);
        flashes.splice(i, 1);
      }
    }
  }

  return { spawnIncident, closeIncident, spawnBeam, ackFlash, clearAll, update };
}

// park.js — le parc : sol, allées courbes lumineuses, plateformes de zones (anneau de statut
// couleur couverture), attractions procédurales animées par zone, arbres, lampadaires, foule
// ambiante instancée + heat de densité. Tout est déterministe (rendu identique multi-écrans).
import * as THREE from "three";
import { zoneSeed } from "./data.js";
import { allEdgeCurves, zonePos } from "./graph.js";
import { makeLabel } from "./labels.js";
import { PALETTE } from "./scene.js";

export const PLATFORM_TOP = 0.16;

// PRNG déterministe (mulberry32) — pas de Math.random : multi-écrans synchrones.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.08, ...opts });
const emissiveMat = (color, intensity = 1.4, base = "#0c0f14") =>
  new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, roughness: 0.6 });

function cylinderBetween(start, end, radius, material, radialSegments = 10) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), radialSegments);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  return mesh;
}

// Texture radiale (heat de densité) générée en canvas — zéro asset réseau.
function radialTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.55, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Attractions par zone (low-poly nuit, accents émissifs). Chaque builder peut
// renvoyer une fonction d'update ajoutée aux animations du parc.
// ---------------------------------------------------------------------------
function buildAttraction(zone, group, animations) {
  const c = zone.color;
  switch (zone.id) {
    case "Z1": { // arche d'entrée
      const pillarMat = mat("#3d4654");
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 4.4, 10), pillarMat);
        p.position.set(side * 2.3, 2.2, 0);
        p.castShadow = true;
        group.add(p);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.7, 0.8), mat("#2c3442"));
      lintel.position.y = 4.35;
      group.add(lintel);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.34, 0.1), emissiveMat(c, 1.8));
      sign.position.set(0, 4.32, 0.46);
      group.add(sign);
      break;
    }
    case "Z2": { // grand huit : boucle de rail + train qui roule
      const pts = [
        [-3.4, 0.7, -2.2], [-1.6, 2.6, -3.0], [0.9, 4.1, -1.6], [2.9, 2.3, 0.4],
        [1.7, 0.9, 2.5], [-0.9, 1.5, 2.9], [-3.0, 2.8, 1.3], [-3.9, 1.2, -0.6],
      ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
      const curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.9);
      const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 140, 0.09, 8, true), emissiveMat("#f85149", 0.55, "#331416"));
      rail.castShadow = true;
      group.add(rail);
      const supportMat = mat("#333c49");
      for (let i = 0; i < 8; i++) {
        const p = curve.getPointAt(i / 8);
        if (p.y > 1.15) group.add(cylinderBetween(new THREE.Vector3(p.x, 0, p.z), p.clone().addScaledVector(new THREE.Vector3(0, 1, 0), -0.05), 0.05, supportMat, 6));
      }
      const train = new THREE.Group();
      const carGeo = new THREE.BoxGeometry(0.46, 0.3, 0.3);
      const cars = [0, 1, 2].map(() => { const m = new THREE.Mesh(carGeo, emissiveMat("#ffd166", 0.9, "#3a2c10")); train.add(m); return m; });
      group.add(train);
      let tt = 0;
      animations.push((dt) => {
        tt = (tt + dt * 0.055) % 1;
        cars.forEach((car, i) => {
          const u = (tt - i * 0.022 + 1) % 1;
          car.position.copy(curve.getPointAt(u));
          const tan = curve.getTangentAt(u);
          car.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
        });
      });
      break;
    }
    case "Z3": { // grande roue : jante + rayons + nacelles stabilisées + lumières
      const wheel = new THREE.Group();
      wheel.position.set(0, 3.6, 0);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.09, 10, 48), emissiveMat(c, 0.8, "#241019"));
      wheel.add(rim);
      const spokeMat = mat("#414b5a");
      const cabins = [];
      const N = 10;
      for (let i = 0; i < N; i++) {
        const angle = (i / N) * Math.PI * 2;
        const end = new THREE.Vector3(Math.cos(angle) * 3.1, Math.sin(angle) * 3.1, 0);
        wheel.add(cylinderBetween(new THREE.Vector3(0, 0, 0), end, 0.045, spokeMat, 6));
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), emissiveMat("#ffe08a", 2.2));
        bulb.position.copy(end);
        wheel.add(bulb);
        const pivot = new THREE.Group();
        pivot.position.copy(end);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.4), mat("#5a6474"));
        cab.position.y = -0.36;
        pivot.add(cab);
        wheel.add(pivot);
        cabins.push(pivot);
      }
      for (const side of [-0.5, 0.5]) {
        group.add(cylinderBetween(new THREE.Vector3(side * 2.2, 0, side), new THREE.Vector3(0, 3.6, 0), 0.1, mat("#39424f"), 8));
      }
      group.add(wheel);
      animations.push((dt) => {
        wheel.rotation.z += dt * 0.16;
        for (const p of cabins) p.rotation.z = -wheel.rotation.z; // nacelles droites
      });
      break;
    }
    case "Z4": { // rivière : ruban d'eau + rochers + rondin qui flotte
      const pts = [[-3.4, 0.1, 2.4], [-1.2, 0.1, 0.6], [1.4, 0.1, 1.8], [3.2, 0.1, -0.4], [1.8, 0.1, -2.6]]
        .map(([x, y, z]) => new THREE.Vector3(x, y, z));
      const curve = new THREE.CatmullRomCurve3(pts);
      const water = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 60, 0.55, 8, false),
        new THREE.MeshStandardMaterial({ color: "#1c4966", emissive: "#12405e", emissiveIntensity: 0.55, transparent: true, opacity: 0.85, roughness: 0.25 }),
      );
      water.scale.y = 0.24;
      group.add(water);
      const rockMat = mat("#3a4350");
      const r = rng(44);
      for (let i = 0; i < 5; i++) {
        const p = curve.getPointAt(r());
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 + r() * 0.2, 0), rockMat);
        rock.position.set(p.x + (r() - 0.5) * 1.6, 0.16, p.z + (r() - 0.5) * 1.6);
        group.add(rock);
      }
      const log = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 8), mat("#6b4a2f"));
      log.rotation.z = Math.PI / 2;
      group.add(log);
      let lt = 0;
      animations.push((dt) => {
        lt = (lt + dt * 0.05) % 1;
        const p = curve.getPointAt(lt);
        log.position.set(p.x, 0.18 + Math.sin(lt * 21) * 0.03, p.z);
      });
      break;
    }
    case "Z5": { // place centrale : fontaine + bancs
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.65, 0.42, 24), mat("#3c4553"));
      basin.position.y = 0.21;
      group.add(basin);
      const waterTop = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.32, 0.1, 24),
        new THREE.MeshStandardMaterial({ color: "#1d5b7a", emissive: "#155a80", emissiveIntensity: 0.7, roughness: 0.2 }));
      waterTop.position.y = 0.42;
      group.add(waterTop);
      const jet = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.5, 10),
        new THREE.MeshStandardMaterial({ color: "#bfeaff", emissive: "#9fd8f5", emissiveIntensity: 1.1, transparent: true, opacity: 0.75 }));
      jet.position.y = 1.15;
      group.add(jet);
      animations.push((dt, t) => { jet.scale.y = 1 + Math.sin(t * 2.4) * 0.12; });
      const benchMat = mat("#4a3f31");
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const bench = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.34), benchMat);
        bench.position.set(Math.cos(a) * 2.5, 0.28, Math.sin(a) * 2.5);
        bench.rotation.y = -a;
        group.add(bench);
      }
      break;
    }
    case "Z6": { // carrousel
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.42, 0.2, 20), mat("#494153"));
      base.position.y = 0.1;
      group.add(base);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.85, 20), emissiveMat(c, 0.55, "#33202a"));
      roof.position.y = 2.15;
      group.add(roof);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.7, 8), mat("#8a93a5"));
      pole.position.y = 0.95;
      group.add(pole);
      const spinner = new THREE.Group();
      spinner.position.y = 0.55;
      const horseMat = emissiveMat("#ffd166", 0.5, "#3a2c14");
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const horse = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.4), horseMat);
        horse.position.set(Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95);
        horse.rotation.y = -a + Math.PI / 2;
        spinner.add(horse);
      }
      group.add(spinner);
      animations.push((dt, t) => {
        spinner.rotation.y += dt * 0.5;
        spinner.position.y = 0.55 + Math.sin(t * 1.7) * 0.05;
      });
      break;
    }
    case "Z7": { // food court : stands chauds + tables
      const stallBody = mat("#41372c");
      for (let i = 0; i < 3; i++) {
        const stall = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 1.0), stallBody);
        body.position.y = 0.5;
        body.castShadow = true;
        stall.add(body);
        const awn = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.2), emissiveMat("#fdba74", 0.75, "#3a2a16"));
        awn.position.y = 1.1;
        stall.add(awn);
        const front = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5), emissiveMat("#ffcf9a", 1.3));
        front.position.set(0, 0.62, 0.51);
        stall.add(front);
        const a = (i / 3) * Math.PI * 2 + 0.6;
        stall.position.set(Math.cos(a) * 2.1, 0, Math.sin(a) * 2.1);
        stall.rotation.y = -a + Math.PI;
        group.add(stall);
      }
      const tableMat = mat("#57493a");
      const r = rng(7);
      for (let i = 0; i < 4; i++) {
        const table = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.06, 0.5, 10), tableMat);
        table.position.set((r() - 0.5) * 2.6, 0.25, (r() - 0.5) * 2.6);
        group.add(table);
      }
      break;
    }
    case "Z8": { // manège extrême : tour + bras rotatifs
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.44, 5.6, 12), mat("#3c4553"));
      tower.position.y = 2.8;
      tower.castShadow = true;
      group.add(tower);
      const hub = new THREE.Group();
      hub.position.y = 5.1;
      const armMat = emissiveMat(c, 0.5, "#241531");
      const cabMat = emissiveMat("#e9d5ff", 1.0, "#241531");
      for (const dir of [1, -1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.14, 0.3), armMat);
        arm.rotation.y = dir > 0 ? 0 : Math.PI / 2;
        hub.add(arm);
        for (const side of [-1, 1]) {
          const cab = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 4, 10), cabMat);
          if (dir > 0) cab.position.set(side * 2.3, -0.42, 0);
          else cab.position.set(0, -0.42, side * 2.3);
          hub.add(cab);
        }
      }
      group.add(hub);
      animations.push((dt) => { hub.rotation.y += dt * 0.9; });
      break;
    }
    case "Z9": { // boutiques : rangée d'échoppes
      const bodies = ["#31404f", "#3d3549", "#2f4a41"];
      for (let i = 0; i < 3; i++) {
        const shop = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.15, 1.15), mat(bodies[i]));
        body.position.y = 0.58;
        body.castShadow = true;
        shop.add(body);
        const sign = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.2, 0.08), emissiveMat(c, 1.4, "#22301a"));
        sign.position.set(0, 1.28, 0.56);
        shop.add(sign);
        shop.position.set((i - 1) * 1.95, 0, i % 2 ? 0.5 : -0.3);
        shop.rotation.y = (i - 1) * 0.24;
        group.add(shop);
      }
      break;
    }
    case "Z10": { // parking : voitures low-poly
      const pad = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.06, 4.6), mat("#1a212c"));
      pad.position.y = 0.03;
      group.add(pad);
      const colors = ["#41506a", "#5a4a4a", "#3e5a50", "#4d465e", "#55584a", "#3a4a63"];
      const r = rng(10);
      for (let i = 0; i < 6; i++) {
        const car = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.26, 0.5), mat(colors[i]));
        body.position.y = 0.2;
        car.add(body);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.44), mat("#222b38"));
        cabin.position.set(-0.05, 0.4, 0);
        car.add(cabin);
        car.position.set(-2.2 + (i % 3) * 2.1, 0.05, i < 3 ? -1.2 : 1.2);
        car.rotation.y = (r() - 0.5) * 0.12;
        group.add(car);
      }
      break;
    }
  }
}

// Porte de service + ambulance au point AMB (choré demo).
function buildServiceGate(scene) {
  const g = new THREE.Group();
  g.position.copy(zonePos("AMB"));
  const amb = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8, 0.9), mat("#dde3ea"));
  body.position.y = 0.55;
  body.castShadow = true;
  amb.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.16, 0.92), mat("#c93a3a"));
  stripe.position.y = 0.62;
  amb.add(stripe);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), emissiveMat("#66aaff", 3));
  beacon.position.set(0.55, 1.02, 0);
  amb.add(beacon);
  g.add(amb);
  const light = new THREE.PointLight("#5aa2ff", 7, 9, 2);
  light.position.set(0, 1.6, 0);
  g.add(light);
  scene.add(g);
  return (dt, t) => {
    beacon.material.emissiveIntensity = 2 + Math.sin(t * 7) * 1.8;
    light.intensity = 5 + Math.sin(t * 7) * 4;
  };
}

// ---------------------------------------------------------------------------
export function buildPark(scene) {
  const animations = [];
  const zoneVisuals = new Map();
  const zoneMeshes = []; // pour raycast clic

  // Sol
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(54, 72),
    new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.96, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-3, 0, 1.5);
  ground.receiveShadow = true;
  scene.add(ground);

  // Allées courbes : ruban sombre + fil lumineux central
  const pathMat = mat(PALETTE.path, { roughness: 0.9 });
  const glowMat = new THREE.MeshStandardMaterial({ color: "#0c1118", emissive: PALETTE.accent, emissiveIntensity: 0.35, roughness: 0.6 });
  for (const curve of allEdgeCurves()) {
    const ribbon = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.55, 8, false), pathMat);
    ribbon.scale.y = 0.12;
    ribbon.receiveShadow = true;
    scene.add(ribbon);
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.05, 6, false), glowMat);
    wire.position.y = 0.045;
    scene.add(wire);
  }
  animations.push((dt, t) => { glowMat.emissiveIntensity = 0.28 + (Math.sin(t * 1.3) + 1) * 0.09; });

  // Zones
  const heatTex = radialTexture();
  for (const zone of zoneSeed) {
    const group = new THREE.Group();
    group.position.copy(zonePos(zone.id));
    scene.add(group);

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(3.1, 3.3, PLATFORM_TOP, 40),
      mat("#1b2430", { roughness: 0.9 }),
    );
    platform.position.y = PLATFORM_TOP / 2;
    platform.receiveShadow = true;
    platform.userData.zoneId = zone.id;
    group.add(platform);
    zoneMeshes.push(platform);

    const ringMat = new THREE.MeshStandardMaterial({ color: "#0d1117", emissive: PALETTE.ok, emissiveIntensity: 1.15, roughness: 0.5 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.28, 0.075, 10, 72), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = PLATFORM_TOP + 0.03;
    group.add(ring);

    // Heat de densité (invisible par défaut)
    const heat = new THREE.Mesh(
      new THREE.CircleGeometry(3.6, 40),
      new THREE.MeshBasicMaterial({ map: heatTex, color: PALETTE.warn, transparent: true, opacity: 0, depthWrite: false }),
    );
    heat.rotation.x = -Math.PI / 2;
    heat.position.y = PLATFORM_TOP + 0.05;
    group.add(heat);

    const attraction = new THREE.Group();
    attraction.position.y = PLATFORM_TOP;
    group.add(attraction);
    buildAttraction(zone, attraction, animations);

    const labelY = { Z2: 5.4, Z3: 8.1, Z8: 6.9, Z1: 5.6 }[zone.id] || 3.9;
    const label = makeLabel(`${zone.short}`, { fontSize: 0.56, borderColor: zone.color, bg: "rgba(13,17,23,0.8)" });
    label.position.y = labelY;
    group.add(label);

    zoneVisuals.set(zone.id, {
      group, platform, ring, ringMat, heat, label,
      status: "ok", warnPulse: 0, heatLevel: 0,
    });
  }

  // Arbres instancés (troncs + feuillages), placement déterministe hors allées/zones
  const r = rng(2026);
  const spots = [];
  for (let i = 0; i < 240 && spots.length < 46; i++) {
    const x = -34 + r() * 62;
    const z = -22 + r() * 42;
    const p = new THREE.Vector3(x, 0, z);
    if (p.distanceTo(new THREE.Vector3(-3, 0, 1.5)) > 50) continue;
    let ok = true;
    for (const zn of zoneSeed) if (p.distanceTo(zonePos(zn.id)) < 5.4) { ok = false; break; }
    if (ok && p.distanceTo(zonePos("AMB")) > 4) spots.push(p);
  }
  const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.13, 1, 6), mat("#4a3a29"), spots.length);
  const crownMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.75, 0), mat("#1d3a28", { roughness: 1 }), spots.length);
  crownMesh.castShadow = true;
  const dummy = new THREE.Object3D();
  spots.forEach((p, i) => {
    const s = 0.8 + r() * 0.7;
    dummy.position.set(p.x, 0.5 * s, p.z);
    dummy.scale.setScalar(s);
    dummy.rotation.y = r() * Math.PI;
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.y = (0.9 + 0.55) * s;
    dummy.updateMatrix();
    crownMesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(trunkMesh, crownMesh);

  // Lampadaires (faux halos émissifs, 1 vraie lumière déjà sur la place)
  const lampSpots = [[-8, 6], [7, -6], [-16, 2], [10, 12], [-20, 12.5], [5, -13]];
  for (const [x, z] of lampSpots) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.6, 6), mat("#39424f"));
    pole.position.set(x, 1.3, z);
    scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), emissiveMat("#ffd9a0", 2.6));
    bulb.position.set(x, 2.7, z);
    scene.add(bulb);
  }

  animations.push(buildServiceGate(scene));

  // Foule ambiante instancée + déambulation douce
  const CROWD = 170;
  const crowdGeo = new THREE.ConeGeometry(0.11, 0.44, 6);
  const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, CROWD);
  crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const palette = ["#8aa7c9", "#c9a48a", "#9dc98a", "#c98aa4", "#a08ac9", "#c9c18a"];
  const walkers = [];
  const cr = rng(451);
  const baseCount = { Z5: 30, Z7: 24, Z6: 20, Z9: 16, Z1: 14, Z3: 16, Z2: 14, Z4: 12, Z8: 14, Z10: 0 };
  let ci = 0;
  for (const zone of zoneSeed) {
    const n = Math.min(baseCount[zone.id] ?? 12, CROWD - ci);
    const center = zonePos(zone.id);
    for (let k = 0; k < n; k++, ci++) {
      const angle = cr() * Math.PI * 2;
      const rad = 2.2 + cr() * 2.6;
      walkers.push({
        zoneId: zone.id,
        cx: center.x + Math.cos(angle) * rad,
        cz: center.z + Math.sin(angle) * rad,
        r: 0.35 + cr() * 0.85,
        speed: 0.25 + cr() * 0.6,
        phase: cr() * Math.PI * 2,
        scale: 0.85 + cr() * 0.4,
      });
      crowd.setColorAt(ci, new THREE.Color(palette[ci % palette.length]));
    }
  }
  crowd.count = walkers.length;
  scene.add(crowd);
  const crowdScaleByZone = new Map(); // densité visuelle par zone (crowd_density)
  animations.push((dt, t) => {
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i];
      const zs = crowdScaleByZone.get(w.zoneId) ?? 1;
      const a = w.phase + t * w.speed;
      dummy.position.set(w.cx + Math.cos(a) * w.r, 0.22 * w.scale, w.cz + Math.sin(a * 0.83) * w.r);
      dummy.rotation.y = a;
      dummy.scale.setScalar(w.scale * zs);
      dummy.updateMatrix();
      crowd.setMatrixAt(i, dummy.matrix);
    }
    crowd.instanceMatrix.needsUpdate = true;
  });

  // --- API d'état -------------------------------------------------------------
  const STATUS_COLOR = { ok: PALETTE.ok, warn: PALETTE.warn, bad: PALETTE.bad };

  function setZoneStatus(zoneId, status) {
    const v = zoneVisuals.get(zoneId);
    if (!v || v.status === status) return;
    v.status = status;
    v.ringMat.emissive.set(STATUS_COLOR[status] || PALETTE.ok);
  }

  function pulseZoneWarning(zoneId) {
    const v = zoneVisuals.get(zoneId);
    if (v) v.warnPulse = 1;
  }

  function setZoneHeat(zoneId, ratio) {
    const v = zoneVisuals.get(zoneId);
    if (!v) return;
    v.heatLevel = THREE.MathUtils.clamp(ratio, 0, 1.4);
    v.heat.material.color.set(ratio >= 0.85 ? PALETTE.bad : PALETTE.warn);
    crowdScaleByZone.set(zoneId, THREE.MathUtils.clamp(0.7 + ratio * 0.6, 0.7, 1.5));
  }

  function setZoneLabel(zoneId, text) {
    zoneVisuals.get(zoneId)?.label.userData.setText(text);
  }

  function update(dt, t) {
    for (const fn of animations) fn(dt, t);
    for (const v of zoneVisuals.values()) {
      // pulsation de l'anneau selon statut + warning ponctuel
      const base = v.status === "bad" ? 1.5 + Math.sin(t * 6) * 0.7 : v.status === "warn" ? 1.25 + Math.sin(t * 3.4) * 0.35 : 1.05;
      v.ringMat.emissiveIntensity = base + v.warnPulse * (1.6 + Math.sin(t * 9));
      if (v.warnPulse > 0) v.warnPulse = Math.max(0, v.warnPulse - dt * 0.5);
      if (v.heatLevel > 0) {
        v.heatLevel = Math.max(0, v.heatLevel - dt * 0.02); // decay lent : auto-nettoyage si le capteur se tait
        v.heat.material.opacity = v.heatLevel * (0.3 + (Math.sin(t * 2.6) + 1) * 0.1);
      } else {
        v.heat.material.opacity = Math.max(0, v.heat.material.opacity - dt);
      }
    }
  }

  return { zoneVisuals, zoneMeshes, update, setZoneStatus, setZoneLabel, setZoneHeat, pulseZoneWarning };
}

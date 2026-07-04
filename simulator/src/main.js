import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import "./styles.css";
import { zoneSeed } from "./data.js";
import { createEngine } from "./engineFactory.js";

const RESPONSE_SPEEDUP = 11;
const sceneHost = document.querySelector("#scene");
const labelHost = document.querySelector("#labels");
const decisionCards = document.querySelector("#decisionCards");
const coverageList = document.querySelector("#coverageList");
const voiceToggle = document.querySelector("#voiceToggle");
const resetBtn = document.querySelector("#resetBtn");
const cameraBtn = document.querySelector("#cameraBtn");
const timeoutToggle = document.querySelector("#timeoutToggle");
const protectToggle = document.querySelector("#protectToggle");
const approveBtn = document.querySelector("#approveBtn");
const whyBtn = document.querySelector("#whyBtn");
const overrideBtn = document.querySelector("#overrideBtn");
const metricResponse = document.querySelector("#metricResponse");
const metricCoverage = document.querySelector("#metricCoverage");
const metricIncidents = document.querySelector("#metricIncidents");

const engine = createEngine(); // live (coordinateur WS) par défaut · ?mode=demo = scripté offline
const scene = new THREE.Scene();
scene.background = new THREE.Color("#090b10");
scene.fog = new THREE.Fog("#090b10", 28, 72);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
camera.position.set(18, 25, 31);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sceneHost.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0, 2);
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 16;
controls.maxDistance = 58;
controls.update();

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const mouseWorld = new THREE.Vector3();
const zoneMeshes = new Map();
const zoneRings = new Map();
const blackspots = new Map();
const labels = new Map();
const agentVisuals = new Map();
const incidentVisuals = new Map();
const activeBeams = new Set();
const animatedObjects = [];
const ambulancePosition = new THREE.Vector3(22, 0.35, 13);

let voiceEnabled = false;
let cameraMode = "orbit";
let lastIncidentId = null;
let lastPrimaryEta = 0;

const colors = {
  ok: new THREE.Color("#36d399"),
  warn: new THREE.Color("#facc15"),
  bad: new THREE.Color("#fb7185"),
  routePrimary: new THREE.Color("#60a5fa"),
  routeBackfill: new THREE.Color("#6ee7b7"),
  ambulance: new THREE.Color("#f8fafc")
};

const materials = {
  ground: new THREE.MeshStandardMaterial({ color: "#101914", roughness: 0.94, metalness: 0.02 }),
  path: new THREE.MeshStandardMaterial({ color: "#293241", roughness: 0.86, metalness: 0.05 }),
  water: new THREE.MeshStandardMaterial({ color: "#0ea5e9", roughness: 0.42, metalness: 0.08, transparent: true, opacity: 0.78 }),
  blackspot: new THREE.MeshBasicMaterial({ color: "#020617", transparent: true, opacity: 0.64, depthWrite: false }),
  redPulse: new THREE.MeshBasicMaterial({ color: "#fb7185", transparent: true, opacity: 0.52, depthWrite: false }),
  routePrimary: new THREE.MeshBasicMaterial({ color: colors.routePrimary, transparent: true, opacity: 0.84 }),
  routeBackfill: new THREE.MeshBasicMaterial({ color: colors.routeBackfill, transparent: true, opacity: 0.76 }),
  ambulance: new THREE.MeshBasicMaterial({ color: colors.ambulance, transparent: true, opacity: 0.82 })
};

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = random(20260704);

function zonePos(zoneId, y = 0) {
  if (zoneId === "AMB") return ambulancePosition.clone();
  const zone = zoneSeed.find((item) => item.id === zoneId);
  return new THREE.Vector3(zone.pos[0], y, zone.pos[2]);
}

function skillColor(agent) {
  if (agent.isReserve) return "#a78bfa";
  if (agent.skills.includes("medic")) return "#2dd4bf";
  if (agent.skills.includes("RCP")) return "#60a5fa";
  if (agent.skills.includes("secu")) return "#facc15";
  return "#6ee7b7";
}

function cylinderBetween(start, end, radius, material, radialSegments = 8) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, radialSegments);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createLabel(id, text, className = "") {
  const el = document.createElement("div");
  el.className = `world-label ${className}`.trim();
  el.textContent = text;
  labelHost.appendChild(el);
  labels.set(id, { el, position: new THREE.Vector3(), visible: true });
  return el;
}

function setLabelPosition(id, position, visible = true) {
  const label = labels.get(id);
  if (!label) return;
  label.position.copy(position);
  label.visible = visible;
}

function removeLabel(id) {
  const label = labels.get(id);
  if (!label) return;
  label.el.remove();
  labels.delete(id);
}

function createGround() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 52, 1, 1), materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, 1);
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(64, 32, "#1f3b34", "#172330");
  grid.position.y = 0.012;
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  scene.add(grid);
}

function createLighting() {
  const hemi = new THREE.HemisphereLight("#c7d2fe", "#102117", 1.8);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight("#ffffff", 2.8);
  sun.position.set(-12, 28, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 28;
  sun.shadow.camera.bottom = -28;
  scene.add(sun);

  const emergencyGlow = new THREE.PointLight("#fb7185", 55, 34, 2);
  emergencyGlow.position.set(18, 7, 8);
  scene.add(emergencyGlow);
}

function createPaths() {
  const pathMaterial = materials.path;
  const seen = new Set();
  for (const zone of zoneSeed) {
    for (const edge of zone.adjacency) {
      const key = [zone.id, edge.z].sort().join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      const start = zonePos(zone.id, 0.03);
      const end = zonePos(edge.z, 0.03);
      const mesh = cylinderBetween(start, end, 0.16, pathMaterial, 10);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
}

function createZones() {
  const padGeometry = new THREE.CylinderGeometry(2.25, 2.25, 0.12, 48);
  const ringGeometry = new THREE.TorusGeometry(2.42, 0.065, 8, 64);
  const blackGeometry = new THREE.CircleGeometry(2.85, 64);

  for (const zone of zoneSeed) {
    const padMaterial = new THREE.MeshStandardMaterial({
      color: zone.color,
      roughness: 0.68,
      metalness: 0.08,
      transparent: true,
      opacity: 0.42
    });
    const pad = new THREE.Mesh(padGeometry, padMaterial);
    pad.position.set(zone.pos[0], 0.08, zone.pos[2]);
    pad.castShadow = false;
    pad.receiveShadow = true;
    pad.userData.zoneId = zone.id;
    scene.add(pad);
    zoneMeshes.set(zone.id, pad);

    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: colors.ok, transparent: true, opacity: 0.95 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(zone.pos[0], 0.18, zone.pos[2]);
    scene.add(ring);
    zoneRings.set(zone.id, ring);

    const blackspot = new THREE.Mesh(blackGeometry, materials.blackspot.clone());
    blackspot.rotation.x = -Math.PI / 2;
    blackspot.position.set(zone.pos[0], 0.21, zone.pos[2]);
    blackspot.visible = false;
    scene.add(blackspot);
    blackspots.set(zone.id, blackspot);

    createLabel(`zone-${zone.id}`, zone.short, "zone");
    setLabelPosition(`zone-${zone.id}`, new THREE.Vector3(zone.pos[0], 2.9, zone.pos[2]));
  }
}

function createCoaster() {
  const points = [
    new THREE.Vector3(-16, 1.3, -8),
    new THREE.Vector3(-15, 4.9, -11),
    new THREE.Vector3(-11, 2.4, -12),
    new THREE.Vector3(-8, 5.4, -7),
    new THREE.Vector3(-11, 1.6, -4),
    new THREE.Vector3(-15, 3.2, -5),
    new THREE.Vector3(-16, 1.3, -8)
  ];
  const curve = new THREE.CatmullRomCurve3(points, true);
  const rail = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 120, 0.08, 8, true),
    new THREE.MeshStandardMaterial({ color: "#ef4444", roughness: 0.36, metalness: 0.28 })
  );
  rail.castShadow = true;
  scene.add(rail);

  for (const point of points.slice(0, -1)) {
    scene.add(cylinderBetween(new THREE.Vector3(point.x, 0.1, point.z), point, 0.035, new THREE.MeshStandardMaterial({ color: "#94a3b8" }), 6));
  }
}

function createFerrisWheel() {
  const group = new THREE.Group();
  group.position.set(0, 2.9, -13);
  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(2.25, 0.045, 10, 96),
    new THREE.MeshStandardMaterial({ color: "#f9a8d4", roughness: 0.35, metalness: 0.35 })
  );
  group.add(wheel);
  for (let i = 0; i < 12; i += 1) {
    const angle = (Math.PI * 2 * i) / 12;
    const end = new THREE.Vector3(Math.cos(angle) * 2.2, Math.sin(angle) * 2.2, 0);
    group.add(cylinderBetween(new THREE.Vector3(0, 0, 0), end, 0.018, new THREE.MeshStandardMaterial({ color: "#cbd5e1" }), 5));
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.24, 0.24), new THREE.MeshStandardMaterial({ color: i % 2 ? "#60a5fa" : "#facc15" }));
    pod.position.copy(end);
    group.add(pod);
  }
  scene.add(group);
  scene.add(cylinderBetween(new THREE.Vector3(-1.5, 0.1, -13), new THREE.Vector3(0, 2.4, -13), 0.05, new THREE.MeshStandardMaterial({ color: "#64748b" }), 7));
  scene.add(cylinderBetween(new THREE.Vector3(1.5, 0.1, -13), new THREE.Vector3(0, 2.4, -13), 0.05, new THREE.MeshStandardMaterial({ color: "#64748b" }), 7));
  animatedObjects.push({ object: group, axis: "z", speed: 0.24 });
}

function createRiver() {
  const points = [
    new THREE.Vector3(11.4, 0.15, -12.1),
    new THREE.Vector3(15.2, 0.17, -12.4),
    new THREE.Vector3(17.1, 0.14, -9.6),
    new THREE.Vector3(13.7, 0.15, -7.2),
    new THREE.Vector3(11.2, 0.16, -9.2)
  ];
  const river = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 80, 0.36, 14), materials.water);
  river.receiveShadow = true;
  scene.add(river);
}

function createExtremeRide() {
  const towerMat = new THREE.MeshStandardMaterial({ color: "#8b5cf6", roughness: 0.4, metalness: 0.4 });
  const tower = cylinderBetween(new THREE.Vector3(16, 0.2, -2), new THREE.Vector3(16, 6.6, -2), 0.13, towerMat, 12);
  scene.add(tower);
  const arm = new THREE.Group();
  arm.position.set(16, 5.5, -2);
  const beam = cylinderBetween(new THREE.Vector3(-2.1, 0, 0), new THREE.Vector3(2.1, 0, 0), 0.06, new THREE.MeshStandardMaterial({ color: "#f8fafc" }), 8);
  arm.add(beam);
  const carA = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.35, 0.45), new THREE.MeshStandardMaterial({ color: "#fb7185" }));
  const carB = carA.clone();
  carA.position.set(-2.35, 0, 0);
  carB.position.set(2.35, 0, 0);
  arm.add(carA, carB);
  scene.add(arm);
  animatedObjects.push({ object: arm, axis: "z", speed: 0.82 });
}

function createStallsAndLandmarks() {
  const box = (x, y, z, w, h, d, color) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.05 }));
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  box(0, 0, 0, 2.6, 0.36, 2.6, "#facc15");
  box(0, 0.36, 0, 1.7, 0.32, 1.7, "#0f172a");

  for (let i = 0; i < 5; i += 1) {
    box(-8 + i * 1.1, 0, 15.8, 0.8, 0.65, 0.9, i % 2 ? "#a3e635" : "#38bdf8");
  }
  for (let i = 0; i < 4; i += 1) {
    box(1 + i * 1.1, 0, 13.7, 0.82, 0.58, 0.78, i % 2 ? "#fdba74" : "#fb7185");
  }
  for (let i = 0; i < 4; i += 1) {
    box(9.4 + i * 0.86, 0, 10.7, 0.55, 0.7, 0.55, i % 2 ? "#60a5fa" : "#facc15");
  }

  const archMat = new THREE.MeshStandardMaterial({ color: "#6ee7b7", roughness: 0.45, metalness: 0.18 });
  scene.add(cylinderBetween(new THREE.Vector3(-19.3, 0, 9.1), new THREE.Vector3(-19.3, 2.4, 9.1), 0.08, archMat, 10));
  scene.add(cylinderBetween(new THREE.Vector3(-16.7, 0, 9.1), new THREE.Vector3(-16.7, 2.4, 9.1), 0.08, archMat, 10));
  scene.add(cylinderBetween(new THREE.Vector3(-19.3, 2.4, 9.1), new THREE.Vector3(-16.7, 2.4, 9.1), 0.08, archMat, 10));

  const ambulance = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.72, 0.92), new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.32 }));
  body.position.y = 0.55;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.08, 0.96), new THREE.MeshBasicMaterial({ color: "#ef4444" }));
  stripe.position.y = 0.67;
  ambulance.add(body, stripe);
  ambulance.position.copy(ambulancePosition);
  ambulance.rotation.y = -0.5;
  ambulance.userData.baseY = ambulance.position.y;
  scene.add(ambulance);
  animatedObjects.push({ object: ambulance, axis: "pulse", speed: 2.6 });
}

function createAttractions() {
  createCoaster();
  createFerrisWheel();
  createRiver();
  createExtremeRide();
  createStallsAndLandmarks();
}

function createCrowd() {
  const geometry = new THREE.ConeGeometry(0.11, 0.42, 7);
  const material = new THREE.MeshStandardMaterial({ color: "#cbd5e1", roughness: 0.7, metalness: 0.02 });
  const mesh = new THREE.InstancedMesh(geometry, material, 210);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let index = 0;
  const palette = ["#cbd5e1", "#93c5fd", "#fda4af", "#fde68a", "#86efac", "#ddd6fe"];
  for (const zone of zoneSeed.filter((item) => item.id !== "Z10")) {
    const count = zone.id === "Z5" ? 34 : zone.id === "Z7" ? 28 : 18;
    for (let i = 0; i < count && index < mesh.count; i += 1) {
      const angle = rand() * Math.PI * 2;
      const radius = 1.35 + rand() * 3.1;
      dummy.position.set(zone.pos[0] + Math.cos(angle) * radius, 0.26, zone.pos[2] + Math.sin(angle) * radius);
      dummy.rotation.y = rand() * Math.PI * 2;
      const scale = 0.82 + rand() * 0.46;
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      color.set(palette[Math.floor(rand() * palette.length)]);
      mesh.setColorAt(index, color);
      index += 1;
    }
  }
  mesh.count = index;
  scene.add(mesh);
}

function createAgentVisual(agent, index) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: skillColor(agent), roughness: 0.45, metalness: 0.14 });
  const darkMat = new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.6, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.82, 16), bodyMat);
  body.position.y = 0.56;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), darkMat);
  head.position.y = 1.08;
  head.castShadow = true;
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.025, 8, 28),
    new THREE.MeshBasicMaterial({ color: skillColor(agent), transparent: true, opacity: agent.isReserve ? 0.95 : 0.65 })
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.1;
  group.add(body, head, halo);

  const base = zonePos(agent.currentZone, 0);
  const angle = index * 2.399963;
  const radius = agent.isReserve ? 1.7 : 0.88 + (index % 3) * 0.22;
  group.position.set(base.x + Math.cos(angle) * radius, 0.06, base.z + Math.sin(angle) * radius);
  group.userData.restOffset = new THREE.Vector3(Math.cos(angle) * radius, 0.06, Math.sin(angle) * radius);
  group.userData.agentId = agent.id;
  scene.add(group);

  const label = createLabel(`agent-${agent.id}`, agent.name, "agent");
  label.style.borderColor = `${skillColor(agent)}88`;
  agentVisuals.set(agent.id, {
    agentId: agent.id,
    group,
    move: null,
    labelId: `agent-${agent.id}`,
    routeBeam: null,
    bob: rand() * Math.PI * 2
  });
}

function createAgents() {
  engine.agents.forEach((agent, index) => createAgentVisual(agent, index));
}

function createIncidentVisual(incident) {
  const zone = zoneSeed.find((item) => item.id === incident.zoneId);
  const position = new THREE.Vector3(
    zone.pos[0] + incident.patientOffset[0],
    0.18,
    zone.pos[2] + incident.patientOffset[2]
  );
  const group = new THREE.Group();
  group.position.copy(position);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.045, 8, 64), materials.redPulse.clone());
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.54, 6, 12), new THREE.MeshStandardMaterial({ color: "#fecdd3", roughness: 0.52 }));
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.25;
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), new THREE.MeshBasicMaterial({ color: "#fb7185" }));
  beacon.position.y = 1.24;
  group.add(ring, body, beacon);
  scene.add(group);

  const light = new THREE.PointLight("#fb7185", 20, 9, 2);
  light.position.copy(position).add(new THREE.Vector3(0, 2.1, 0));
  scene.add(light);

  createLabel(`incident-${incident.id}`, `${incident.type.replaceAll("_", " ")} ${incident.severity}/5`, "danger");
  setLabelPosition(`incident-${incident.id}`, position.clone().add(new THREE.Vector3(0, 2.2, 0)));

  incidentVisuals.set(incident.id, {
    id: incident.id,
    group,
    ring,
    beacon,
    light,
    patientPosition: position.clone(),
    labelId: `incident-${incident.id}`,
    done: false
  });
  lastIncidentId = incident.id;
}

function removeIncidentVisual(incidentId) {
  const visual = incidentVisuals.get(incidentId);
  if (!visual) return;
  scene.remove(visual.group, visual.light);
  visual.group.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  removeLabel(visual.labelId);
  incidentVisuals.delete(incidentId);
}

function makeRouteBeam(points, role) {
  const cleanPoints = points.filter(Boolean);
  if (cleanPoints.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(cleanPoints.map((point) => point.clone().setY(0.42)));
  const material = role === "primary" ? materials.routePrimary.clone() : role === "backfill" ? materials.routeBackfill.clone() : materials.ambulance.clone();
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.045, 7), material);
  mesh.userData.life = 1;
  scene.add(mesh);
  activeBeams.add(mesh);
  return mesh;
}

function visualTargetFor(agentId, targetZoneId) {
  const base = zonePos(targetZoneId, 0.06);
  const agent = engine.agentById.get(agentId);
  const index = engine.agents.findIndex((item) => item.id === agentId);
  const angle = index * 2.399963;
  const radius = agent?.isReserve ? 1.45 : 0.9 + (index % 3) * 0.18;
  return base.add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
}

function pathPointsForMove(detail) {
  const visual = agentVisuals.get(detail.agentId);
  const points = [visual.group.position.clone()];
  for (const zoneId of detail.path.slice(1)) {
    points.push(zonePos(zoneId, 0.06));
  }
  if (detail.role === "primary") {
    const incidentVisual = incidentVisuals.get(detail.incidentId);
    const patient = incidentVisual?.patientPosition || zonePos(detail.targetZone, 0.06);
    if (points.length === 1) points.push(patient.clone());
    else points[points.length - 1] = patient.clone();
  } else if (detail.role === "backfill") {
    const target = visualTargetFor(detail.agentId, detail.targetZone);
    if (points.length === 1) points.push(target);
    else points[points.length - 1] = target;
  } else if (detail.role === "ambulance") {
    points.push(ambulancePosition.clone());
  }
  return points.map((point) => point.clone().setY(0.06));
}

function startVisualMove(detail) {
  const visual = agentVisuals.get(detail.agentId);
  if (!visual) return;
  const points = pathPointsForMove(detail);
  const segmentLengths = [];
  let totalLength = 0;
  for (let i = 1; i < points.length; i += 1) {
    const length = points[i].distanceTo(points[i - 1]);
    segmentLengths.push(length);
    totalLength += length;
  }
  const minDuration = detail.role === "primary" ? 1.55 : 2.4;
  const duration = Math.max(minDuration, detail.travelTime / RESPONSE_SPEEDUP);
  const beam = makeRouteBeam(points, detail.role);
  visual.move = {
    ...detail,
    points,
    segmentLengths,
    totalLength,
    duration,
    elapsed: 0,
    beam
  };
  visual.routeBeam = beam;
  if (detail.role === "primary") {
    lastPrimaryEta = Math.round(duration);
    metricResponse.textContent = `${lastPrimaryEta}s`;
  }
}

function samplePath(move, progress) {
  if (move.points.length === 1 || move.totalLength === 0) {
    return { position: move.points[0].clone(), direction: new THREE.Vector3(0, 0, 1) };
  }
  const targetDistance = move.totalLength * progress;
  let cursor = 0;
  for (let i = 0; i < move.segmentLengths.length; i += 1) {
    const length = move.segmentLengths[i];
    if (cursor + length >= targetDistance || i === move.segmentLengths.length - 1) {
      const local = length === 0 ? 1 : (targetDistance - cursor) / length;
      const start = move.points[i];
      const end = move.points[i + 1];
      return {
        position: start.clone().lerp(end, THREE.MathUtils.clamp(local, 0, 1)),
        direction: end.clone().sub(start).normalize()
      };
    }
    cursor += length;
  }
  const last = move.points.at(-1);
  return { position: last.clone(), direction: new THREE.Vector3(0, 0, 1) };
}

function updateMoves(delta) {
  for (const visual of agentVisuals.values()) {
    if (!visual.move) {
      visual.bob += delta * 1.8;
      visual.group.position.y = 0.06 + Math.sin(visual.bob) * 0.025;
      continue;
    }
    const move = visual.move;
    move.elapsed += delta;
    const progress = THREE.MathUtils.clamp(move.elapsed / move.duration, 0, 1);
    const sample = samplePath(move, smoothstep(progress));
    visual.group.position.copy(sample.position);
    visual.group.position.y = 0.06 + Math.sin(progress * Math.PI) * 0.12;
    if (sample.direction.lengthSq() > 0.001) {
      visual.group.rotation.y = Math.atan2(sample.direction.x, sample.direction.z);
    }

    if (move.role === "ambulance") {
      const incidentVisual = incidentVisuals.get(move.incidentId);
      if (incidentVisual) {
        incidentVisual.group.position.copy(visual.group.position).add(new THREE.Vector3(0.45, 0.08, 0.35));
        incidentVisual.light.position.copy(incidentVisual.group.position).add(new THREE.Vector3(0, 2, 0));
        setLabelPosition(incidentVisual.labelId, incidentVisual.group.position.clone().add(new THREE.Vector3(0, 2.2, 0)));
      }
    }

    if (progress >= 1) {
      if (move.beam) {
        move.beam.userData.fade = true;
      }
      visual.move = null;
      if (move.role === "ambulance") {
        engine.completeAmbulance(move.agentId, move.incidentId);
        setTimeout(() => removeIncidentVisual(move.incidentId), 1300);
      } else {
        engine.completeMove(move.agentId, move.role, move.incidentId, move.targetZone);
      }
    }
  }
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function updateBeams(delta) {
  for (const beam of [...activeBeams]) {
    if (beam.userData.fade) {
      beam.userData.life -= delta * 0.7;
      beam.material.opacity = Math.max(0, beam.userData.life) * 0.72;
      if (beam.userData.life <= 0) {
        activeBeams.delete(beam);
        scene.remove(beam);
        beam.geometry.dispose();
        beam.material.dispose();
      }
    }
  }
}

function updateLabels() {
  const width = sceneHost.clientWidth;
  const height = sceneHost.clientHeight;
  const projected = new THREE.Vector3();

  for (const [id, label] of labels) {
    projected.copy(label.position).project(camera);
    const visible = label.visible && projected.z > -1 && projected.z < 1;
    label.el.style.display = visible ? "block" : "none";
    if (!visible) continue;
    const x = (projected.x * 0.5 + 0.5) * width;
    const y = (-projected.y * 0.5 + 0.5) * height;
    label.el.style.left = `${x}px`;
    label.el.style.top = `${y}px`;
    const scale = THREE.MathUtils.clamp(1.12 - projected.z * 0.24, 0.74, 1.12);
    label.el.style.transform = `scale(${scale})`;
  }

  for (const [agentId, visual] of agentVisuals) {
    const agent = engine.agentById.get(agentId);
    const suffix = agent?.status && agent.status !== "available" ? ` - ${agent.status.replace("_", " ")}` : "";
    const label = labels.get(visual.labelId);
    if (label) {
      label.el.textContent = `${agent?.name || agentId}${suffix}`;
      setLabelPosition(visual.labelId, visual.group.position.clone().add(new THREE.Vector3(0, 1.72, 0)));
    }
  }
}

function updateCoverageVisuals(coverage) {
  let okCount = 0;
  for (const zoneCoverage of coverage) {
    const ring = zoneRings.get(zoneCoverage.zoneId);
    const blackspot = blackspots.get(zoneCoverage.zoneId);
    const label = labels.get(`zone-${zoneCoverage.zoneId}`);
    const bad = !zoneCoverage.ok;
    const tight = zoneCoverage.ok && zoneCoverage.surplus === 0 && zoneCoverage.requiredMin > 0;
    if (zoneCoverage.ok) okCount += 1;
    if (ring) {
      const color = bad ? colors.bad : tight ? colors.warn : colors.ok;
      ring.material.color.copy(color);
      ring.material.opacity = bad ? 1 : tight ? 0.78 : 0.62;
      ring.scale.setScalar(bad ? 1.12 : tight ? 1.04 : 1);
    }
    if (blackspot) {
      blackspot.visible = bad;
      blackspot.material.opacity = bad ? 0.62 : 0;
    }
    if (label) {
      label.el.classList.toggle("danger", bad);
      const zone = zoneSeed.find((item) => item.id === zoneCoverage.zoneId);
      label.el.textContent = `${zone.short} ${zoneCoverage.actualHeadcount}/${zoneCoverage.requiredMin}`;
    }
  }
  const percent = coverage.length ? Math.round((okCount / coverage.length) * 100) : 100;
  metricCoverage.textContent = `${percent}%`;
}

function renderCoverageList(coverage) {
  coverageList.innerHTML = "";
  for (const item of coverage) {
    const row = document.createElement("div");
    row.className = `coverage-row ${!item.ok ? "bad" : item.surplus === 0 && item.requiredMin > 0 ? "warn" : ""}`;
    const left = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.name;
    const meta = document.createElement("span");
    const skillText = item.requiredSkills.length ? `needs ${item.requiredSkills.join("/")}` : "general";
    const incomingText = item.incoming ? `, ${item.incoming} incoming` : "";
    const missingText = item.missingSkills.length ? `, missing ${item.missingSkills.join("/")}` : "";
    meta.textContent = `${item.actualHeadcount}/${item.requiredMin}${incomingText} - ${skillText}${missingText}`;
    left.append(title, meta);

    const pill = document.createElement("div");
    pill.className = "coverage-pill";
    pill.textContent = item.ok ? (item.surplus > 0 ? `+${item.surplus}` : "min") : "gap";
    row.append(left, pill);
    coverageList.appendChild(row);
  }
}

function addDecisionCard(event) {
  const card = document.createElement("article");
  card.className = `decision-card ${event.tone || "neutral"}`;
  const title = document.createElement("h3");
  title.textContent = event.title;
  const body = document.createElement("p");
  body.textContent = event.body;
  card.append(title, body);
  decisionCards.prepend(card);
  while (decisionCards.children.length > 9) {
    decisionCards.lastElementChild.remove();
  }
}

function updateMetrics() {
  const active = engine.incidents.filter((incident) => incident.status !== "closed").length;
  metricIncidents.textContent = String(active);
}

function currentPlanSummary() {
  const incident = [...engine.incidents].reverse().find((item) => item.status !== "closed") || engine.incidents.at(-1);
  if (!incident) {
    return "No active incident yet. Simulate a collapse first.";
  }
  const primary = incident.primaryId ? engine.agentById.get(incident.primaryId) : null;
  const backfills = incident.backfills
    .map((backfill) => `${engine.agentById.get(backfill.agentId)?.name || backfill.agentId} to ${engine.zone(backfill.targetZone).name}`)
    .join("; ");
  const primaryText = primary ? `${primary.name} is assigned to ${incident.zoneName}` : `No primary assigned for ${incident.zoneName}`;
  return `${primaryText}. ${backfills ? `Backfill: ${backfills}.` : "No backfill is currently required."}`;
}

function resetVisualAgents() {
  for (const [agentId, visual] of agentVisuals) {
    const agent = engine.agentById.get(agentId);
    const base = zonePos(agent.currentZone, 0);
    visual.group.position.copy(base).add(visual.group.userData.restOffset || new THREE.Vector3());
    visual.group.position.y = 0.06;
    visual.move = null;
  }
}

function resetSimulation() {
  for (const incidentId of [...incidentVisuals.keys()]) removeIncidentVisual(incidentId);
  for (const beam of [...activeBeams]) {
    activeBeams.delete(beam);
    scene.remove(beam);
    beam.geometry.dispose();
    beam.material.dispose();
  }
  decisionCards.innerHTML = "";
  metricResponse.textContent = "0s";
  lastPrimaryEta = 0;
  engine.reset();
  resetVisualAgents();
  renderCoverageList(engine.getCoverage(false));
  updateCoverageVisuals(engine.getCoverage(false));
  addDecisionCard({
    title: "Shift reset",
    body: "Seeded amusement park roster loaded: 10 zones, 16 agents, 2 reserves.",
    tone: "neutral"
  });
  updateMetrics();
}

function speak(detail) {
  if (!voiceEnabled || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(detail.text);
  utterance.rate = detail.speaker === "Conductor" ? 0.95 : 1.02;
  utterance.pitch = detail.speaker === "Conductor" ? 0.86 : 1 + (hash(detail.speaker) % 5) * 0.04;
  utterance.volume = 0.92;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) {
    const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
    utterance.voice = english[hash(detail.speaker) % Math.max(english.length, 1)] || voices[hash(detail.speaker) % voices.length];
  }
  window.speechSynthesis.speak(utterance);
}

function hash(text) {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) {
    value = (value * 31 + text.charCodeAt(i)) >>> 0;
  }
  return value;
}

function triggerCollapse(zoneId, options = {}) {
  engine.triggerIncident(zoneId, options);
  updateMetrics();
}

function bindUi() {
  document.querySelectorAll(".incident-button[data-zone]").forEach((button) => {
    button.addEventListener("click", () => {
      const zoneId = button.dataset.zone;
      triggerCollapse(zoneId, { language: button.dataset.language });
    });
  });

  document.querySelector("#randomCollapseBtn").addEventListener("click", () => {
    const zones = zoneSeed.filter((zone) => zone.id !== "Z10");
    const zone = zones[Math.floor(Math.random() * zones.length)];
    triggerCollapse(zone.id);
  });

  timeoutToggle.addEventListener("change", () => {
    engine.setForceTimeout(timeoutToggle.checked);
  });

  protectToggle.addEventListener("change", () => {
    engine.setConstraint("protectGrandHuitRcp", protectToggle.checked);
  });

  approveBtn.addEventListener("click", () => {
    const summary = currentPlanSummary();
    addDecisionCard({
      title: "Operator approved plan",
      body: summary,
      tone: "success"
    });
    speak({ speaker: "Conductor", text: "Operator approved the current dispatch plan." });
  });

  whyBtn.addEventListener("click", () => {
    addDecisionCard({
      title: "Why this dispatch?",
      body: `${currentPlanSummary()} Selection balances qualified skill, travel time, and coverage impact before moving anyone.`,
      tone: "neutral"
    });
    speak({ speaker: "Conductor", text: "This choice balances required skill, travel time, and coverage impact." });
  });

  overrideBtn.addEventListener("click", () => {
    protectToggle.checked = true;
    engine.setConstraint("protectGrandHuitRcp", true);
    addDecisionCard({
      title: "Manual override queued",
      body: "Grand Huit CPR pair is now protected for future pulls unless no safer responder exists.",
      tone: "warning"
    });
    speak({ speaker: "Conductor", text: "Override accepted. Protecting the Grand Huit CPR pair on future dispatches." });
  });

  voiceToggle.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    voiceToggle.textContent = voiceEnabled ? "Voice enabled" : "Enable voice";
    voiceToggle.classList.toggle("primary", !voiceEnabled);
    if (voiceEnabled) {
      window.speechSynthesis?.cancel();
      speak({ speaker: "Conductor", text: "Conductor voice enabled. Dispatch updates will be spoken." });
    } else {
      window.speechSynthesis?.cancel();
    }
  });

  resetBtn.addEventListener("click", resetSimulation);

  cameraBtn.addEventListener("click", () => {
    cameraMode = cameraMode === "orbit" ? "follow" : "orbit";
    cameraBtn.textContent = cameraMode === "orbit" ? "Camera: orbit" : "Camera: follow";
  });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...zoneMeshes.values()]);
    if (hits[0]?.object?.userData?.zoneId) {
      triggerCollapse(hits[0].object.userData.zoneId);
    }
  });
}

function bindEngine() {
  engine.on("incident", ({ incident }) => {
    createIncidentVisual(incident);
    updateMetrics();
  });
  engine.on("decision", addDecisionCard);
  engine.on("coverage", (coverage) => {
    updateCoverageVisuals(coverage);
    renderCoverageList(coverage);
  });
  engine.on("move", startVisualMove);
  engine.on("speak", speak);
  engine.on("timeout-toggle-consumed", () => {
    timeoutToggle.checked = false;
  });
}

function resize() {
  const width = sceneHost.clientWidth;
  const height = sceneHost.clientHeight;
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function updateCamera(delta) {
  if (cameraMode !== "follow" || !lastIncidentId) return;
  const incidentVisual = incidentVisuals.get(lastIncidentId);
  if (!incidentVisual) return;
  const target = incidentVisual.group.position.clone();
  const desired = target.clone().add(new THREE.Vector3(12, 14, 16));
  camera.position.lerp(desired, 1 - Math.pow(0.03, delta));
  controls.target.lerp(target, 1 - Math.pow(0.02, delta));
}

function animateObjects(delta, elapsed) {
  for (const item of animatedObjects) {
    if (item.axis === "z") item.object.rotation.z += delta * item.speed;
    if (item.axis === "pulse") item.object.position.y = item.object.userData.baseY + Math.sin(elapsed * item.speed) * 0.04;
  }
  for (const visual of incidentVisuals.values()) {
    const pulse = 1 + Math.sin(elapsed * 4.5) * 0.18;
    visual.ring.scale.setScalar(pulse);
    visual.beacon.position.y = 1.2 + Math.sin(elapsed * 7) * 0.14;
    visual.light.intensity = 16 + Math.sin(elapsed * 6) * 6;
  }
  for (const ring of zoneRings.values()) {
    ring.rotation.z += delta * 0.35;
  }
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  engine.tick(delta);
  updateMoves(delta);
  updateBeams(delta);
  updateCamera(delta);
  animateObjects(delta, elapsed);
  controls.update();
  updateLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function init() {
  createGround();
  createLighting();
  createPaths();
  createZones();
  createAttractions();
  createCrowd();
  createAgents();
  bindEngine();
  bindUi();
  resize();
  window.addEventListener("resize", resize);
  renderCoverageList(engine.getCoverage(false));
  updateCoverageVisuals(engine.getCoverage(false));
  addDecisionCard({
    title: "Ready for live demo",
    body: "Click a collapse scenario or click any 3D zone. Voice can be enabled from the lower-left control.",
    tone: "neutral"
  });
  updateMetrics();
  animate();
}

init();

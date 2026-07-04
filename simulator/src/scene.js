// scene.js — renderer + caméra + lumières. Rendu "nuit d'opération" : tone mapping ACES,
// ombres douces, fog, auto-orbite lente (grand écran vivant) avec reprise manuelle et
// cadrage doux automatique sur incident.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export const PALETTE = {
  bg: "#0a0d13",
  ground: "#101720",
  grass: "#12211a",
  path: "#232d3b",
  ok: "#2ea043",
  warn: "#e3b341",
  bad: "#f85149",
  accent: "#388bfd",
  txt: "#e6edf3",
  dim: "#8b949e",
};

const AUTO_ORBIT_SPEED = 0.035;      // rad/s — rotation ambiante lente
const IDLE_BEFORE_AUTO = 14;         // s sans interaction avant reprise auto
const FOCUS_DURATION = 2.4;          // s de travelling vers un incident

export function createSceneContext(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bg);
  scene.fog = new THREE.Fog(PALETTE.bg, 40, 95);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 160);
  camera.position.set(20, 26, 33);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.set(-2, 0, 1);
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minDistance = 14;
  controls.maxDistance = 70;
  controls.enablePan = true;

  // --- lumières -------------------------------------------------------------
  scene.add(new THREE.HemisphereLight("#b9c8ee", "#0c1512", 0.85));
  const moon = new THREE.DirectionalLight("#dbe6ff", 1.7);
  moon.position.set(-22, 34, 14);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -42; moon.shadow.camera.right = 42;
  moon.shadow.camera.top = 36; moon.shadow.camera.bottom = -36;
  moon.shadow.camera.far = 110;
  moon.shadow.bias = -0.0006;
  scene.add(moon);
  const warm = new THREE.PointLight("#ffb36b", 30, 46, 1.8); // halo chaud place centrale
  warm.position.set(0, 9, 0);
  scene.add(warm);

  // --- caméra vivante ---------------------------------------------------------
  let idleTime = IDLE_BEFORE_AUTO; // auto-orbite active au boot
  let focus = null;                // { from, to, targetFrom, targetTo, t }
  const _sph = new THREE.Spherical();

  const markInteraction = () => { idleTime = 0; focus = null; };
  controls.addEventListener("start", markInteraction);

  /** Travelling doux vers un point (incident) puis l'auto-orbite reprend autour. */
  function focusOn(point, distance = 24) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    const to = point.clone().add(dir.multiplyScalar(distance)).setY(Math.max(15, distance * 0.7));
    focus = {
      from: camera.position.clone(), to,
      targetFrom: controls.target.clone(), targetTo: point.clone().setY(0.5),
      t: 0,
    };
    idleTime = IDLE_BEFORE_AUTO; // l'auto-orbite reprend juste après le travelling
  }

  function updateCamera(dt) {
    if (focus) {
      focus.t += dt / FOCUS_DURATION;
      const k = THREE.MathUtils.smoothstep(Math.min(focus.t, 1), 0, 1);
      camera.position.lerpVectors(focus.from, focus.to, k);
      controls.target.lerpVectors(focus.targetFrom, focus.targetTo, k);
      if (focus.t >= 1) focus = null;
    } else {
      idleTime += dt;
      if (idleTime >= IDLE_BEFORE_AUTO) {
        // orbite lente autour de la cible courante
        _sph.setFromVector3(camera.position.clone().sub(controls.target));
        _sph.theta += AUTO_ORBIT_SPEED * dt;
        camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(_sph));
      }
    }
    controls.update();
  }

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener("resize", resize);
  resize();

  return { scene, camera, renderer, controls, updateCamera, focusOn, resize };
}

// main.js — orchestration du simulateur 3D CONDUCTOR.
// Moteur abstrait (live = vrai cerveau via WS · ?mode=demo = cerveau local scripté) -> scène 3D.
// Le rendu ne décide RIEN : il visualise les events du bus (incident/decision/coverage/move/…).
import * as THREE from "three";
import "./styles.css";
import { createEngine } from "./engineFactory.js";
import { createSceneContext } from "./scene.js";
import { buildPark } from "./park.js";
import { createAgentManager } from "./agents.js";
import { createEffects } from "./effects.js";
import { createHud } from "./hud.js";
import { zonePos } from "./graph.js";

const mode = new URLSearchParams(location.search).get("mode") || "live";
const engine = createEngine();

const container = document.getElementById("scene");
const ctx = createSceneContext(container);
// Filet projecteur : ?bright=1 relève les noirs si le beamer de la salle les mange.
if (new URLSearchParams(location.search).get("bright")) {
  ctx.renderer.domElement.style.filter = "brightness(1.18) contrast(1.03)";
}
const park = buildPark(ctx.scene);
const effects = createEffects(ctx.scene);
const hud = createHud(document.getElementById("hud"), { mode });

const agents = createAgentManager(ctx.scene, engine, {
  onArrival: (agent, move) => {
    if (move.role === "backfill") effects.ackFlash(agents.agentPosition(agent.id));
  },
});
agents.syncRoster();

// --- voix (opt-in, synthèse navigateur) -------------------------------------
let voiceOn = false;
function speak({ text }) {
  if (!voiceOn || !("speechSynthesis" in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

// --- HUD contrôles ------------------------------------------------------------
hud.buildControls({
  onScenario: (zoneId) => engine.triggerIncident(zoneId),
  onReset: () => engine.reset(),
  onVoice: (on) => { voiceOn = on; if (!on) window.speechSynthesis?.cancel(); },
});
if (mode === "demo") {
  hud.setModel("local brain");
  hud.setConnection("hidden");
} else {
  hud.setConnection("off");
}

// --- couverture -> anneaux, labels, bandeau ------------------------------------
function applyCoverage(coverage) {
  agents.syncRoster();  // agents découverts en live
  agents.reconcile();   // resync doux des positions "posées"
  for (const z of coverage) {
    park.setZoneStatus(z.zoneId, z.ok ? "ok" : "bad");
    const zone = engine.zone(z.zoneId);
    const short = zone?.short || z.zoneId;
    park.setZoneLabel(z.zoneId, z.requiredMin > 0 ? `${short} · ${z.headcount}/${z.requiredMin}` : short);
  }
  hud.setCoverage(coverage);
}

// --- bus moteur -> scène ---------------------------------------------------------
engine.on("incident", ({ incident }) => {
  effects.spawnIncident(incident);
  ctx.focusOn(zonePos(incident.zoneId));
});
engine.on("decision", (d) => {
  hud.addDecision(d);
  if (d.kind === "warning" && d.zoneId) park.pulseZoneWarning(d.zoneId);
});
engine.on("coverage", applyCoverage);
engine.on("move", (detail) => {
  const route = agents.startMove(detail);
  if (route) {
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push(route.sample(i / 40).position);
    effects.spawnBeam(pts, detail.role);
  }
});
engine.on("speak", speak);
engine.on("ack", ({ agentId }) => effects.ackFlash(agents.agentPosition(agentId)));
engine.on("reset", () => {
  effects.clearAll();
  agents.hardReset();
  closedSeen.clear(); // les IDs d'incidents repartent de zéro après un reset demo
});
// Events additionnels du mode live
engine.on("connection", ({ connected }) => hud.setConnection(connected ? "on" : "off"));
engine.on("brain", ({ degraded, model }) => {
  hud.setDegraded(!!degraded);
  if (model) hud.setModel(model);
});
engine.on("density", ({ zoneId, ratio }) => park.setZoneHeat(zoneId, ratio || 0));

// --- interactions : clic zone ------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
ctx.renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
ctx.renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) { downAt = null; return; } // drag = orbite
  downAt = null;
  const rect = ctx.renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, ctx.camera);
  const hit = raycaster.intersectObjects(park.zoneMeshes, false)[0];
  if (!hit) return;
  const zoneId = hit.object.userData.zoneId;
  if (mode === "demo") engine.triggerIncident(zoneId);
  else ctx.focusOn(zonePos(zoneId)); // live : vue seule -> focus caméra
});

// --- boucle ------------------------------------------------------------------------
const closedSeen = new Set(); // clôtures déjà traitées (évite le re-scan par frame)
const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  engine.tick(dt);
  // Clôture visuelle : un incident passé en status "closed" (demo) voit sa balise se replier.
  for (const inc of engine.incidents) {
    if (inc.status === "closed" && !closedSeen.has(inc.id)) {
      closedSeen.add(inc.id);
      effects.closeIncident(inc.id);
    }
  }
  agents.update(dt, t);
  park.update(dt, t);
  effects.update(dt, t);
  ctx.updateCamera(dt);
  ctx.renderer.render(ctx.scene, ctx.camera);
  requestAnimationFrame(animate);
}

applyCoverage(engine.getCoverage(false));
animate();

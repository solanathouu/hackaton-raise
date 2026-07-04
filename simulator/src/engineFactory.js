// engineFactory.js — choisit le moteur du simulateur selon le mode (query ?mode=).
//   live (défaut) : LiveCoordinatorEngine, branché au VRAI coordinateur via WS (vue live).
//   demo          : DispatchEngine scripté d'origine (offline / dev standalone / fallback résilience).
import { DispatchEngine } from "./engine.js";
import { LiveCoordinatorEngine } from "./liveEngine.js";

export function createEngine() {
  const mode = new URLSearchParams(typeof location !== "undefined" ? location.search : "").get("mode") || "live";
  return mode === "demo" ? new DispatchEngine() : new LiveCoordinatorEngine();
}

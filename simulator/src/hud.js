// hud.js — overlay DOM du grand écran : marque + badges d'état (LIVE/DÉMO, connexion, mode
// dégradé), feed des décisions du cerveau (avec justification Crusoe), bandeau de couverture
// par zone, contrôles du mode demo. Aucune dépendance — DOM pur.

const TONE_CLASS = { hot: "hot", danger: "danger", warning: "warning", success: "success", neutral: "" };
const MAX_CARDS = 7;

export function createHud(root, { mode }) {
  root.innerHTML = `
    <header class="hud-brand">
      <div class="brand-row">
        <span class="pulse-dot"></span>
        <strong>CONDUCTOR</strong>
        <span class="badge mode">${mode === "demo" ? "DEMO" : "LIVE"}</span>
        <span class="badge conn" id="hudConn" style="display:none">CONNECTING…</span>
        <span class="badge degraded" id="hudDegraded" style="display:none">⚠ DEGRADED MODE</span>
        <span class="badge model" id="hudModel" style="display:none"></span>
      </div>
      <span class="brand-sub">${mode === "demo" ? "scripted local simulation · embedded brain" : "live brain view · real-time dispatch"}</span>
    </header>

    <nav class="surface-tabs">
      <span class="tab on">3D</span>
      <a class="tab" href="/crowd/">Camera</a>
    </nav>

    <section class="hud-feed" id="hudFeed" aria-live="polite"></section>

    <footer class="hud-bottom">
      <div class="hud-controls" id="hudControls"></div>
      <div class="hud-coverage" id="hudCoverage"></div>
    </footer>
  `;

  const connEl = root.querySelector("#hudConn");
  const degradedEl = root.querySelector("#hudDegraded");
  const modelEl = root.querySelector("#hudModel");
  const feedEl = root.querySelector("#hudFeed");
  const coverageEl = root.querySelector("#hudCoverage");
  const controlsEl = root.querySelector("#hudControls");

  function setConnection(state) {
    // state: "on" | "off" | "hidden"
    if (state === "hidden") { connEl.style.display = "none"; return; }
    connEl.style.display = "";
    connEl.textContent = state === "on" ? "● CONNECTED" : "○ DISCONNECTED";
    connEl.classList.toggle("ok", state === "on");
    connEl.classList.toggle("ko", state !== "on");
  }

  function setDegraded(on) {
    degradedEl.style.display = on ? "" : "none";
  }

  function setModel(name) {
    if (!name) { modelEl.style.display = "none"; return; }
    modelEl.style.display = "";
    modelEl.textContent = `🧠 ${String(name).split("/").pop()}`;
  }

  function addDecision({ title, body, tone }) {
    const card = document.createElement("article");
    card.className = `card ${TONE_CLASS[tone] || ""}`;
    card.innerHTML = `<h3></h3><p></p>`;
    card.querySelector("h3").textContent = title || "";
    card.querySelector("p").textContent = body || "";
    feedEl.prepend(card);
    requestAnimationFrame(() => card.classList.add("in"));
    while (feedEl.children.length > MAX_CARDS) feedEl.lastChild.remove();
  }

  const chips = new Map();
  function setCoverage(coverage) {
    for (const z of coverage) {
      let chip = chips.get(z.zoneId);
      if (!chip) {
        chip = document.createElement("div");
        chip.className = "chip";
        chip.innerHTML = `<span class="chip-name"></span><span class="chip-count"></span>`;
        coverageEl.appendChild(chip);
        chips.set(z.zoneId, chip);
      }
      chip.querySelector(".chip-name").textContent = z.name;
      chip.querySelector(".chip-count").textContent = `${z.headcount}/${z.requiredMin}`;
      const status = !z.ok ? "bad" : z.surplus > 0 ? "surplus" : "ok";
      chip.dataset.status = z.requiredMin === 0 && z.headcount === 0 ? "idle" : status;
    }
  }

  /** Contrôles : demo = scénarios + reset ; live = rien (vue seule). Voix commune. */
  function buildControls({ onScenario, onReset, onVoice }) {
    const mk = (label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `hud-btn ${cls || ""}`;
      b.textContent = label;
      b.addEventListener("click", fn);
      controlsEl.appendChild(b);
      return b;
    };
    let voiceOn = false;
    const voiceBtn = mk("🔇 Voice off", "", () => {
      voiceOn = !voiceOn;
      voiceBtn.textContent = voiceOn ? "🔊 Voice on" : "🔇 Voice off";
      onVoice?.(voiceOn);
    });
    if (mode === "demo") {
      mk("S1 · Grand Huit", "sc", () => onScenario?.("Z2"));
      mk("S2 · Extreme", "sc hot", () => onScenario?.("Z8"));
      mk("S3 · Enfants", "sc", () => onScenario?.("Z6"));
      mk("S4 · Entry ES", "sc", () => onScenario?.("Z1"));
      mk("Reset", "danger", () => onReset?.());
    }
    return { isVoiceOn: () => voiceOn };
  }

  return { setConnection, setDegraded, setModel, addDecision, setCoverage, buildControls };
}

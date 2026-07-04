import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import morgan from "morgan";
import { Server } from "socket.io";

import { coordinatorRoot, loadConfig } from "./src/p2/config.js";
import { IncidentStore } from "./src/p2/persistence.js";
import { createInitialState, loadSeed } from "./src/p2/state.js";
import { CoordinatorRuntime } from "./src/p2/runtime.js";

dotenv.config({ path: path.resolve(coordinatorRoot, ".env") });

const config = loadConfig();
const seed = loadSeed(config);
const state = createInitialState(seed);
const store = new IncidentStore(config.sqlitePath);
const runtime = new CoordinatorRuntime({ state, seed, store, config });

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(morgan("dev"));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "conductor-coordinator",
    mode: config.useMocks ? "mock/local-first" : "real-apis-with-fallback",
    protocol: config.https.enabled ? "https" : "http",
    sqlitePath: config.sqlitePath,
    localIps: config.localIps,
    ackTimeoutMs: config.ackTimeoutMs,
    reconnectGraceMs: config.reconnectGraceMs
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    protocol: config.https.enabled ? "https" : "http",
    host: config.host,
    port: config.port,
    localIps: config.localIps,
    useMocks: config.useMocks
  });
});

app.get("/api/state", (req, res) => {
  res.json(runtime.publicState());
});

app.get("/api/incidents", (req, res) => {
  res.json({ incidents: store.listIncidents(Number(req.query.limit) || 50) });
});

app.post("/api/demo/reset", (req, res) => {
  res.json({ ok: true, state: runtime.resetDemo() });
});

app.post("/api/demo/sim_incident", async (req, res, next) => {
  try {
    const scenario = scenarioPayload(req.body?.scenario);
    const result = await runtime.handleIncidentAudio({
      agentId: req.body?.agentId || scenario.agentId,
      transcript: req.body?.transcript || scenario.transcript,
      lang: req.body?.lang || scenario.lang,
      zoneId: req.body?.zoneId || scenario.zoneId,
      ts: Date.now()
    });
    res.json({ ok: true, incident: result.incident });
  } catch (error) {
    next(error);
  }
});

app.post("/api/assignments/:assignmentId/ack", (req, res) => {
  res.json(runtime.handleAck(req.params.assignmentId));
});

app.post("/api/operator/override", async (req, res, next) => {
  try {
    const result = await runtime.handleOperatorOverride(req.body || {});
    res.json({ ok: true, assignment: result.assignment, constraint: result.constraint });
  } catch (error) {
    next(error);
  }
});

app.get("/mock/tts-sample.mp3", (req, res) => {
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Cache-Control", "no-store");
  res.send(createSilentWav());
});

if (fs.existsSync(config.externalAppDir)) {
  app.use(express.static(config.externalAppDir));
}
if (fs.existsSync(config.staticDir)) {
  app.use(express.static(config.staticDir));
}

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ ok: false, error: error.message });
});

const server = config.https.enabled
  ? https.createServer(
      {
        key: fs.readFileSync(config.https.keyPath),
        cert: fs.readFileSync(config.https.certPath)
      },
      app
    )
  : http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

runtime.attachIo(io);
io.on("connection", (socket) => runtime.handleConnection(socket));

server.listen(config.port, config.host, () => {
  const protocol = config.https.enabled ? "https" : "http";
  const urls = [`${protocol}://localhost:${config.port}`].concat(
    config.localIps.map((ip) => `${protocol}://${ip}:${config.port}`)
  );
  console.log(`CONDUCTOR coordinator listening on ${config.host}:${config.port}`);
  console.log(`Mode: ${config.useMocks ? "USE_MOCKS=true" : "USE_MOCKS=false"} | SQLite: ${config.sqlitePath}`);
  console.log(`Open: ${urls.join(" | ")}`);
  if (!config.https.enabled) {
    console.log("HTTPS disabled. Set HTTPS_KEY_PATH and HTTPS_CERT_PATH for phone microphone support.");
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}

function scenarioPayload(name = "S2") {
  const scenarios = {
    S1: {
      agentId: "A2",
      transcript: "malaise au grand huit, besoin RCP près de l'entrée du manège",
      lang: "fr",
      zoneId: "Z2"
    },
    S2: {
      agentId: "A2",
      transcript: "arrêt cardiaque au manège extrême, il ne respire plus",
      lang: "fr",
      zoneId: "Z8"
    },
    S4: {
      agentId: "A2",
      transcript: "un hombre se desplomó en la entrada, no respira",
      lang: "es",
      zoneId: "Z1"
    }
  };
  return scenarios[String(name || "S2").toUpperCase()] || scenarios.S2;
}

function createSilentWav() {
  const sampleRate = 8000;
  const durationSeconds = 0.25;
  const samples = Math.floor(sampleRate * durationSeconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

export { app, server, runtime };

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const coordinatorRoot = path.resolve(__dirname, "../..");

function bool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveFromRoot(value, fallback) {
  const selected = value || fallback;
  if (!selected) return null;
  return path.isAbsolute(selected) ? selected : path.resolve(coordinatorRoot, selected);
}

export function getLocalIPv4Addresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === "IPv4" && !iface.internal)
    .map((iface) => iface.address);
}

export function loadConfig(env = process.env) {
  const httpsKeyPath = resolveFromRoot(env.HTTPS_KEY_PATH, null);
  const httpsCertPath = resolveFromRoot(env.HTTPS_CERT_PATH, null);
  const hasHttpsFiles =
    httpsKeyPath && httpsCertPath && fs.existsSync(httpsKeyPath) && fs.existsSync(httpsCertPath);

  return {
    host: env.HOST || "0.0.0.0",
    port: int(env.PORT, 3000),
    useMocks: bool(env.USE_MOCKS, true),
    ackTimeoutMs: int(env.ACK_TIMEOUT_MS, 15000),
    reconnectGraceMs: int(env.RECONNECT_GRACE_MS, 30000),
    sqlitePath: resolveFromRoot(env.SQLITE_PATH, "./data/conductor.sqlite"),
    zonesPath: resolveFromRoot(env.ZONES_PATH, "../data/zones.json"),
    rosterPath: resolveFromRoot(env.ROSTER_PATH, "../data/roster.json"),
    constraintsPath: resolveFromRoot(env.CONSTRAINTS_PATH, "../data/learned_constraints.json"),
    staticDir: resolveFromRoot(env.STATIC_DIR, "./public"),
    externalAppDir: resolveFromRoot(env.EXTERNAL_APP_DIR, "../app/dist"),
    https: {
      enabled: hasHttpsFiles,
      keyPath: httpsKeyPath,
      certPath: httpsCertPath
    },
    crusoe: {
      apiKey: env.CRUSOE_API_KEY || "",
      baseUrl: env.CRUSOE_BASE_URL || "https://api.inference.crusoecloud.com/v1",
      model: env.CRUSOE_MODEL || "openai/gpt-oss-120b"
    },
    gradium: {
      apiKey: env.GRADIUM_API_KEY || ""
    },
    localIps: getLocalIPv4Addresses()
  };
}

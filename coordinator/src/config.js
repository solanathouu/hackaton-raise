// Chargement config + seed. Point unique de vérité runtime.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');

const master = String(process.env.USE_MOCKS ?? 'true').toLowerCase() !== 'false';
// Mock par intégration : MOCK_CRUSOE / MOCK_GRADIUM surchargent le master USE_MOCKS.
// -> permet cerveau réel + voix mockée (ou l'inverse) pendant l'intégration incrémentale.
const perInt = (v) => (v === undefined ? master : String(v).toLowerCase() !== 'false');

export const config = {
  port: Number(process.env.PORT || 3000),
  useMocks: master,
  mockCrusoe: perInt(process.env.MOCK_CRUSOE),
  mockGradium: perInt(process.env.MOCK_GRADIUM),
  ackTimeoutMs: Number(process.env.ACK_TIMEOUT_MS || 15000),
  crusoe: {
    apiKey: process.env.CRUSOE_API_KEY || '',
    baseURL: process.env.CRUSOE_BASE_URL || 'https://api.inference.crusoecloud.com/v1',
    // DeepSeek V4 Flash = meilleur compromis latence/JSON sur ce endpoint (cf compare-models.js).
    model: process.env.CRUSOE_MODEL || 'deepseek-ai/Deepseek-V4-Flash',
    modelFallback: process.env.CRUSOE_MODEL_FALLBACK || 'google/gemma-4-31b-it',
  },
  gradium: { apiKey: process.env.GRADIUM_API_KEY || '' },
  tls: { cert: process.env.TLS_CERT || 'certs/cert.pem', key: process.env.TLS_KEY || 'certs/key.pem' },
  // Log SQLite (node:sqlite natif). Vide/désactivable via PERSIST=false.
  persist: String(process.env.PERSIST ?? 'true').toLowerCase() !== 'false',
  sqlitePath: process.env.SQLITE_PATH
    ? resolve(process.env.SQLITE_PATH)
    : resolve(__dirname, '../data/conductor.sqlite'),
};

export function loadSeed() {
  const zones = JSON.parse(readFileSync(resolve(DATA_DIR, 'zones.json'), 'utf8'));
  const roster = JSON.parse(readFileSync(resolve(DATA_DIR, 'roster.json'), 'utf8'));
  return { zones, roster };
}

export function loadMockFixtures() {
  return JSON.parse(readFileSync(resolve(DATA_DIR, 'mock-fixtures.json'), 'utf8'));
}

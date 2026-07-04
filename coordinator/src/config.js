// Chargement config + seed. Point unique de vérité runtime.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');

export const config = {
  port: Number(process.env.PORT || 3000),
  useMocks: String(process.env.USE_MOCKS ?? 'true').toLowerCase() !== 'false',
  ackTimeoutMs: Number(process.env.ACK_TIMEOUT_MS || 15000),
  crusoe: {
    apiKey: process.env.CRUSOE_API_KEY || '',
    baseURL: process.env.CRUSOE_BASE_URL || 'https://api.inference.crusoecloud.com/v1',
    model: process.env.CRUSOE_MODEL || 'openai/gpt-oss-120b',
    modelFallback: process.env.CRUSOE_MODEL_FALLBACK || 'meta-llama/Llama-3.3-70B-Instruct',
  },
  gradium: { apiKey: process.env.GRADIUM_API_KEY || '' },
  tls: { cert: process.env.TLS_CERT || 'certs/cert.pem', key: process.env.TLS_KEY || 'certs/key.pem' },
};

export function loadSeed() {
  const zones = JSON.parse(readFileSync(resolve(DATA_DIR, 'zones.json'), 'utf8'));
  const roster = JSON.parse(readFileSync(resolve(DATA_DIR, 'roster.json'), 'utf8'));
  return { zones, roster };
}

export function loadMockFixtures() {
  return JSON.parse(readFileSync(resolve(DATA_DIR, 'mock-fixtures.json'), 'utf8'));
}

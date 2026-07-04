// Chargement config + seed. Point unique de vérité runtime.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');

/** Modèles Crusoe autorisés — liste stricte (compte hackathon). */
export const ALLOWED_CRUSOE_MODELS = [
  'deepseek-ai/Deepseek-V4-Flash',
  'nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B',
  'moonshotai/Kimi-K2.6',
  'google/gemma-4-31b-it',
  'nvidia/NVIDIA-Nemotron-3-Ultra-550B',
];

const CRUSOE_DEFAULT_MODEL = 'deepseek-ai/Deepseek-V4-Flash';
const CRUSOE_DEFAULT_FALLBACK = 'nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B';

export function assertCrusoeModel(model, label = 'CRUSOE_MODEL') {
  if (!ALLOWED_CRUSOE_MODELS.includes(model)) {
    throw new Error(
      `[config] ${label}="${model}" non autorisé. Modèles autorisés uniquement :\n  - ${ALLOWED_CRUSOE_MODELS.join('\n  - ')}`,
    );
  }
}

function resolveCrusoeModel(raw, fallback, label) {
  const model = (raw || '').trim() || fallback;
  assertCrusoeModel(model, label);
  return model;
}

/** Vérifie que le workflow réel Crusoe est prêt (clé + modèles allowlist). */
export function validateCrusoeLiveWorkflow(cfg = config) {
  const errors = [];
  if (!cfg.crusoe.apiKey) errors.push('CRUSOE_API_KEY manquante');
  try {
    assertCrusoeModel(cfg.crusoe.model, 'CRUSOE_MODEL');
    assertCrusoeModel(cfg.crusoe.modelFallback, 'CRUSOE_MODEL_FALLBACK');
  } catch (e) {
    errors.push(e.message);
  }
  if (cfg.crusoe.model === cfg.crusoe.modelFallback) {
    errors.push('CRUSOE_MODEL et CRUSOE_MODEL_FALLBACK doivent être différents');
  }
  return { ok: errors.length === 0, errors };
}

/** Bloque le démarrage si USE_MOCKS=false et config Crusoe invalide. */
export function assertCrusoeLiveWorkflowOrExit(cfg = config) {
  if (cfg.useMocks) return;
  const { ok, errors } = validateCrusoeLiveWorkflow(cfg);
  if (!ok) {
    console.error('\n❌ Workflow Crusoe réel bloqué (USE_MOCKS=false) :');
    for (const e of errors) console.error(`   - ${e}`);
    console.error(`\n   Modèles autorisés uniquement :\n   - ${ALLOWED_CRUSOE_MODELS.join('\n   - ')}\n`);
    process.exit(1);
  }
}

export const config = {
  port: Number(process.env.PORT || 3000),
  useMocks: String(process.env.USE_MOCKS ?? 'true').toLowerCase() !== 'false',
  ackTimeoutMs: Number(process.env.ACK_TIMEOUT_MS || 15000),
  crusoe: {
    apiKey: process.env.CRUSOE_API_KEY || '',
    baseURL: process.env.CRUSOE_BASE_URL || 'https://api.inference.crusoecloud.com/v1',
    model: resolveCrusoeModel(process.env.CRUSOE_MODEL, CRUSOE_DEFAULT_MODEL, 'CRUSOE_MODEL'),
    modelFallback: resolveCrusoeModel(process.env.CRUSOE_MODEL_FALLBACK, CRUSOE_DEFAULT_FALLBACK, 'CRUSOE_MODEL_FALLBACK'),
    allowedModels: ALLOWED_CRUSOE_MODELS,
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

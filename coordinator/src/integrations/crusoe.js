// crusoe.js — Cerveau LLM (Contrat E). decide(snapshot, transcript) -> Decision (Contrat C).
// OpenAI-compatible (Crusoe Managed Inference). Résilient : timeout + fallback déterministe.
import OpenAI from 'openai';
import { config } from '../config.js';
import { SYSTEM_PROMPT, buildUserMessage } from '../prompt.js';
import { deterministicDecide } from '../engine.js';

const DECIDE_TIMEOUT_MS = 8000;

let client = null;
function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: config.crusoe.apiKey || 'missing',
      baseURL: config.crusoe.baseURL,
      timeout: DECIDE_TIMEOUT_MS,
      maxRetries: 0, // pas de retry : on tombe direct sur le fallback déterministe (latence démo)
    });
  }
  return client;
}

// decide : renvoie TOUJOURS une Decision valide. Ne throw jamais (résilience F9).
export async function decide(snapshot, transcript) {
  if (config.mockCrusoe) {
    // Mode mock/offline = fallback déterministe piloté par le transcript (detectZone + moteur).
    // Fait tourner TOUT le pipeline sans clé et incarne la résilience F9. Reproduit S2 (Hugo+Marco).
    return { ...deterministicDecide(snapshot, transcript), _source: 'mock:deterministic' };
  }
  if (!config.crusoe.apiKey) {
    return { ...deterministicDecide(snapshot, transcript), _source: 'fallback:no-key' };
  }
  try {
    const raw = await callCrusoe(snapshot, transcript, config.crusoe.model);
    return { ...raw, _source: 'crusoe' };
  } catch (err) {
    console.warn(`[crusoe] échec (${err?.message || err}) -> fallback déterministe`);
    return { ...deterministicDecide(snapshot, transcript), _source: 'fallback:error' };
  }
}

async function callCrusoe(snapshot, transcript, model) {
  const resp = await getClient().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(snapshot, transcript) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });
  const content = resp.choices?.[0]?.message?.content || '{}';
  return JSON.parse(content);
}

// Smoke-test unitaire : latence + validité JSON (utilisé par scripts/smoke-crusoe.js).
export async function pingCrusoe(snapshot, transcript) {
  const t0 = Date.now();
  const raw = await callCrusoe(snapshot, transcript, config.crusoe.model);
  return { ms: Date.now() - t0, decision: raw };
}

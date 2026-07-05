// crusoe.js — Cerveau LLM (Contrat E). decide(snapshot, transcript) -> Decision (Contrat C).
// OpenAI-compatible (Crusoe Managed Inference). Validation stricte + fallback LLM + déterministe.
import OpenAI from 'openai';
import { config, assertCrusoeModel, ALLOWED_CRUSOE_MODELS } from '../config.js';
import { SYSTEM_PROMPT, buildUserMessage, buildRepairMessage } from '../prompt.js';
import { deterministicDecide } from '../engine.js';

const DECIDE_TIMEOUT_MS = 12000;
// Budget de sortie. 1024 suffit aux modèles directs (DeepSeek/Gemma ~500 tokens), mais
// ÉTRANGLE les modèles de RAISONNEMENT (Nemotron pense ~1800-2200 tokens AVANT le JSON ->
// finish=length, content vide). 4096 les débloque, AVEC de la marge pour le prompt de
// REPAIR (plus long) — sans quoi une 1re réponse invalide part en réponse vide puis
// fallback lent (~25 s). Max = plafond, pas cible : DeepSeek s'arrête bien avant. Surchargeable.
const MAX_OUTPUT_TOKENS = Number(process.env.CRUSOE_MAX_TOKENS || 4096);
const RETRYABLE_STATUS = new Set([412, 429, 503]);

let client = null;
function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: config.crusoe.apiKey || 'missing',
      baseURL: config.crusoe.baseURL,
      timeout: DECIDE_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return client;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Extrait et parse le JSON même si le modèle entoure de \`\`\`json. */
export function extractDecisionJson(message) {
  let text = message?.content?.trim() || '';
  if (!text && message?.reasoning_content?.trim()) {
    text = message.reasoning_content.trim();
  }
  if (!text) throw new Error('réponse LLM vide');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text;
  return JSON.parse(raw);
}

function backfillPool(snapshot, targetZone) {
  return snapshot?.candidates_backfill_by_zone?.[targetZone] || [];
}

function agentHasSkill(agentSkills, skillsNeeded) {
  if (!skillsNeeded?.length) return true;
  return (agentSkills || []).some((sk) => skillsNeeded.includes(sk));
}

/** Aligne primary_id sur le candidat qualifié le plus proche (déterministe). */
export function alignPrimaryToOptimal(decision, snapshot) {
  const pool = snapshot?.candidates_primary || [];
  const skills = decision.skills_needed?.length
    ? decision.skills_needed
    : (snapshot?.zones || []).find((z) => z.id === decision.zone_id)?.required_skills || [];
  const qualified = pool.filter((c) => agentHasSkill(c.skills, skills));
  const optimal = qualified[0] || pool[0];
  if (!optimal?.id || optimal.id === decision.primary_id) return decision;
  const applied = [...(decision.constraints_applied || [])];
  applied.push(`primary realigné ${decision.primary_id} → ${optimal.id} (proximité+compétences)`);
  return { ...decision, primary_id: optimal.id, constraints_applied: applied };
}

function normalizeTranscriptAnalysis(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    summary: String(raw.summary || ''),
    symptoms_or_facts: Array.isArray(raw.symptoms_or_facts)
      ? raw.symptoms_or_facts.map(String)
      : [],
    explicit_location: raw.explicit_location != null ? String(raw.explicit_location) : null,
    caller_language: String(raw.caller_language || ''),
  };
}

/** Valide et normalise une Decision (Contrat C) contre le snapshot (Contrat B). */
export function validateDecision(raw, snapshot) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['Decision n\'est pas un objet JSON'], decision: null };
  }

  const primaryPool = snapshot?.candidates_primary || [];
  const primaryIds = new Set(primaryPool.map((c) => c.id));
  const incidentZone = snapshot?.incident?.zone_id;

  const decision = {
    transcript_analysis: normalizeTranscriptAnalysis(raw.transcript_analysis),
    incident_type: String(raw.incident_type || 'incident'),
    zone_id: String(raw.zone_id || incidentZone || ''),
    skills_needed: Array.isArray(raw.skills_needed) ? raw.skills_needed.map(String) : [],
    severity: Math.min(5, Math.max(1, Number(raw.severity) || 3)),
    primary_id: raw.primary_id != null ? String(raw.primary_id) : null,
    backfills: [],
    warning: raw.warning ?? null,
    nearby_notice: raw.nearby_notice != null ? String(raw.nearby_notice) : null,
    justification: String(raw.justification || ''),
    constraints_applied: Array.isArray(raw.constraints_applied)
      ? raw.constraints_applied.map(String)
      : [],
  };

  const required = ['incident_type', 'zone_id', 'primary_id', 'justification'];
  for (const k of required) {
    if (decision[k] === null || decision[k] === undefined || decision[k] === '') {
      errors.push(`champ manquant ou vide: ${k}`);
    }
  }

  if (decision.primary_id && !primaryIds.has(decision.primary_id)) {
    errors.push(
      `primary_id "${decision.primary_id}" hors pool [${[...primaryIds].join(', ')}]`,
    );
  }

  // Zone détectée (detectZone) prime sur le LLM : on aligne au lieu de rejeter (apport P4).
  if (incidentZone && decision.zone_id !== incidentZone) {
    decision.zone_id = incidentZone;
  }

  const rawBackfills = Array.isArray(raw.backfills) ? raw.backfills.slice(0, 2) : [];
  for (const [i, bf] of rawBackfills.entries()) {
    const agentId = bf?.agent_id != null ? String(bf.agent_id) : '';
    const targetZone = bf?.target_zone != null ? String(bf.target_zone) : '';
    if (!agentId || !targetZone) {
      errors.push(`backfills[${i}] incomplet`);
      continue;
    }
    const pool = backfillPool(snapshot, targetZone);
    const allowed = new Set(pool.map((c) => c.id));
    if (!allowed.has(agentId)) {
      errors.push(
        `backfills[${i}] agent "${agentId}" absent du pool ${targetZone} [${[...allowed].join(', ')}]`,
      );
    } else {
      decision.backfills.push({ agent_id: agentId, target_zone: targetZone });
    }
  }

  return { ok: errors.length === 0, errors, decision };
}

async function callCrusoeOnce(snapshot, transcript, model, userContent) {
  assertCrusoeModel(model, 'model');
  const resp = await getClient().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: MAX_OUTPUT_TOKENS,
  });
  const parsed = extractDecisionJson(resp.choices?.[0]?.message);
  const { ok, errors, decision } = validateDecision(parsed, snapshot);
  if (!ok) {
    const err = new Error(`validation: ${errors.join('; ')}`);
    err.validationErrors = errors;
    err.raw = parsed;
    throw err;
  }
  return alignPrimaryToOptimal(decision, snapshot);
}

async function callCrusoeWithRetry(snapshot, transcript, model) {
  let userContent = buildUserMessage(snapshot, transcript);
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callCrusoeOnce(snapshot, transcript, model, userContent);
    } catch (err) {
      lastErr = err;
      if (err.validationErrors) {
        userContent = buildRepairMessage(snapshot, transcript, err.validationErrors);
        console.warn(`[crusoe] ${model} validation échouée, retry repair (${attempt + 1}/2)`);
        continue;
      }
      const status = err?.status ?? err?.response?.status;
      if (RETRYABLE_STATUS.has(status) && attempt === 0) {
        const wait = status === 412 ? 2000 : 1500;
        console.warn(`[crusoe] ${model} HTTP ${status}, retry dans ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function tryModel(snapshot, transcript, model) {
  return callCrusoeWithRetry(snapshot, transcript, model);
}

// Snapshot représentatif (S2 : arrêt cardiaque Z8) pour une pré-chauffe qui exerce le VRAI chemin
// (system prompt + snapshot réel) et amorce le cache de préfixe côté Crusoe s'il existe — contrairement
// à un ping trivial qui ne réchauffe que la connexion/le chargement du modèle.
const PREWARM_SNAPSHOT = {
  incident: { transcript: 'arrêt cardiaque au manège extrême, il ne respire plus', lang: 'fr', zone_id: 'Z8' },
  zones: [
    { id: 'Z8', name: 'Manège Extrême', headcount: 2, required_min: 2, surplus: 0, required_skills: ['RCP'] },
    { id: 'Z2', name: 'Grand Huit', headcount: 3, required_min: 2, surplus: 1, required_skills: ['RCP'] },
  ],
  constraints: [],
  candidates_primary: [
    { id: 'A7', name: 'Hugo', skills: ['RCP'], current_zone: 'Z8', travel_time_s: 0, is_reserve: false },
    { id: 'A1', name: 'Marco', skills: ['RCP', 'DAE'], current_zone: 'Z2', travel_time_s: 60, is_reserve: false },
  ],
  candidates_backfill_by_zone: {
    Z8: [{ id: 'A1', name: 'Marco', skills: ['RCP', 'DAE'], current_zone: 'Z2', travel_time_s: 60, is_reserve: false, safe: true }],
  },
};

/** Pré-chauffe primary + fallback avec un prompt REPRÉSENTATIF (system + snapshot réel).
 *  Réduit le TTFT en démo et amorce le cache de préfixe s'il existe ; chauffer AUSSI le fallback
 *  évite un premier appel dégradé à froid (F9). max_tokens bas = on chauffe sans générer.
 *  Renvoie le temps total (ms) ou null si mock/pas de clé. Ne throw pas au boot (Promise.allSettled). */
export async function prewarmCrusoe() {
  if (config.mockCrusoe || !config.crusoe.apiKey) return null;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(PREWARM_SNAPSHOT, PREWARM_SNAPSHOT.incident.transcript) },
  ];
  const models = [...new Set([config.crusoe.model, config.crusoe.modelFallback])].filter(Boolean);
  for (const m of models) assertCrusoeModel(m, 'CRUSOE_MODEL');
  const t0 = Date.now();
  await Promise.allSettled(
    models.map((model) =>
      getClient().chat.completions.create({
        model,
        messages,
        max_tokens: 64,
        response_format: { type: 'json_object' },
      }),
    ),
  );
  return Date.now() - t0;
}

/** Contrat E — renvoie TOUJOURS une Decision. Ne throw jamais (F9). */
export async function decide(snapshot, transcript) {
  if (config.mockCrusoe) {
    // Mode mock/offline = fallback déterministe piloté par le transcript (detectZone + moteur).
    // Fait tourner TOUT le pipeline sans clé et incarne la résilience F9. Reproduit S2 (Hugo+Marco).
    return { ...deterministicDecide(snapshot, transcript), _source: 'mock:deterministic' };
  }
  if (!config.crusoe.apiKey) {
    return { ...deterministicDecide(snapshot, transcript), _source: 'fallback:no-key' };
  }

  const primary = config.crusoe.model;
  const fallback = config.crusoe.modelFallback;
  assertCrusoeModel(primary, 'CRUSOE_MODEL');
  assertCrusoeModel(fallback, 'CRUSOE_MODEL_FALLBACK');

  for (const [model, sourceTag] of [
    [primary, 'crusoe'],
    [fallback, 'crusoe:fallback'],
  ]) {
    try {
      const decision = await tryModel(snapshot, transcript, model);
      return { ...decision, _source: sourceTag, _model: model };
    } catch (err) {
      console.warn(`[crusoe] échec ${model}: ${err?.message || err}`);
    }
  }

  console.warn('[crusoe] -> fallback déterministe');
  return { ...deterministicDecide(snapshot, transcript), _source: 'fallback:error' };
}

export async function pingCrusoe(snapshot, transcript) {
  const t0 = Date.now();
  const decision = await tryModel(snapshot, transcript, config.crusoe.model);
  return { ms: Date.now() - t0, decision };
}

export { ALLOWED_CRUSOE_MODELS };

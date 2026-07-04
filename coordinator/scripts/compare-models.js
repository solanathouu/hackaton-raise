// Compare les modèles Crusoe autorisés sur la VRAIE tâche de décision (snapshot S2 -> Decision JSON).
// Mesure : latence, JSON valide, primary dans le pool, backfill cohérent. (node scripts/compare-models.js)
import OpenAI from 'openai';
import { config, loadSeed } from '../src/config.js';
import { buildState } from '../src/state.js';
import { buildSnapshot } from '../src/engine.js';
import { SYSTEM_PROMPT, buildUserMessage } from '../src/prompt.js';

const MODELS = [
  'deepseek-ai/Deepseek-V4-Flash',
  'moonshotai/Kimi-K2.6',
  'google/gemma-4-31b-it',
  'nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B',
  'nvidia/NVIDIA-Nemotron-3-Ultra-550B',
];

if (!config.crusoe.apiKey) { console.error('❌ CRUSOE_API_KEY manquante dans .env'); process.exit(2); }

const client = new OpenAI({ apiKey: config.crusoe.apiKey, baseURL: config.crusoe.baseURL, timeout: 30000, maxRetries: 0 });
const state = buildState(loadSeed());
const transcript = 'arrêt cardiaque au manège extrême, il ne respire plus';
const snapshot = buildSnapshot(state, 'Z8', { transcript, lang: 'fr' });
const primaryIds = snapshot.candidates_primary.map((c) => c.id);

// Extrait un objet JSON même noyé dans du texte / des fences / du raisonnement.
function extractJson(s) {
  if (!s) return null;
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < 0) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

async function callModel(model, useJsonFormat) {
  const req = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(snapshot, transcript) },
    ],
    temperature: 0.2,
  };
  if (useJsonFormat) req.response_format = { type: 'json_object' };
  const resp = await client.chat.completions.create(req);
  return resp.choices?.[0]?.message?.content || '';
}

console.log(`\nTâche : ${transcript}\nPool primary attendu : [${primaryIds}] · zone Z8\n`);
const rows = [];
for (const model of MODELS) {
  const short = model.split('/')[1];
  process.stdout.write(`→ ${short} … `);
  const t0 = Date.now();
  let content, mode = 'json_object';
  try {
    content = await callModel(model, true);
  } catch (e) {
    // Modèle sans response_format json_object -> retry en texte libre.
    try { content = await callModel(model, false); mode = 'texte->extract'; }
    catch (e2) { console.log(`❌ ${e2.status || ''} ${(e2.message || '').slice(0, 80)}`); rows.push({ short, ok: false, err: e2.message }); continue; }
  }
  const ms = Date.now() - t0;
  const dec = extractJson(content);
  if (!dec) { console.log(`⚠ ${ms}ms JSON illisible`); rows.push({ short, ms, ok: false, err: 'JSON illisible', mode }); continue; }
  const hasFields = ['incident_type', 'zone_id', 'primary_id', 'skills_needed', 'severity'].every((k) => dec[k] !== undefined);
  const primaryInPool = primaryIds.includes(dec.primary_id);
  const zoneOk = dec.zone_id === 'Z8';
  const good = hasFields && primaryInPool && zoneOk;
  console.log(`${good ? '✅' : '⚠'} ${ms}ms  primary=${dec.primary_id}${primaryInPool ? '' : '(HORS POOL)'}  bf=${(dec.backfills || []).map((b) => b.agent_id).join(',') || '∅'}  [${mode}]`);
  rows.push({ short, ms, ok: good, primary: dec.primary_id, primaryInPool, zoneOk, hasFields, mode });
}

console.log('\n===== RÉCAP (trié par latence, seuls les valides) =====');
rows.filter((r) => r.ok).sort((a, b) => a.ms - b.ms).forEach((r, i) =>
  console.log(`  ${i === 0 ? '⭐' : '  '} ${r.short.padEnd(42)} ${String(r.ms).padStart(6)}ms  primary=${r.primary}  [${r.mode}]`));
const bad = rows.filter((r) => !r.ok);
if (bad.length) { console.log('\n  À éviter :'); bad.forEach((r) => console.log(`     ${r.short} — ${r.err || 'primary hors pool / zone KO'}`)); }
console.log('\nRappel : le moteur re-valide TOUJOURS (même un primary hors pool est réparé). Choisir = latence + JSON fiable.\n');

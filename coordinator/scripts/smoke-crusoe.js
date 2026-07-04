// Smoke-test Crusoe : tool-calling/JSON + latence. (npm run smoke:crusoe)
// Exige CRUSOE_API_KEY dans .env. Valide que la Decision est du JSON strict cohérent.
import { config, loadSeed, assertCrusoeModel } from '../src/config.js';
import { buildState } from '../src/state.js';
import { buildSnapshot } from '../src/engine.js';
import { pingCrusoe } from '../src/integrations/crusoe.js';

if (!config.crusoe.apiKey) {
  console.error('❌ CRUSOE_API_KEY manquante. Copie .env.example -> .env et remplis la clé (Intelligence Foundry).');
  process.exit(2);
}

assertCrusoeModel(config.crusoe.model, 'CRUSOE_MODEL');
assertCrusoeModel(config.crusoe.modelFallback, 'CRUSOE_MODEL_FALLBACK');
if (config.crusoe.model === config.crusoe.modelFallback) {
  console.error('❌ CRUSOE_MODEL et CRUSOE_MODEL_FALLBACK doivent être différents.');
  process.exit(2);
}

const state = buildState(loadSeed());
const transcript = 'arrêt cardiaque au manège extrême, il ne respire plus';
const snapshot = buildSnapshot(state, 'Z8', { transcript, lang: 'fr' });

console.log(`→ Modèle : ${config.crusoe.model} @ ${config.crusoe.baseURL}`);
console.log(`→ Fallback : ${config.crusoe.modelFallback}`);
console.log(`→ Autorisés : ${config.crusoe.allowedModels.length} modèles\n`);
console.log(`→ Transcript : "${transcript}"\n`);

try {
  const { ms, decision } = await pingCrusoe(snapshot, transcript);
  console.log(`⏱  Latence : ${ms} ms\n`);
  console.log(JSON.stringify(decision, null, 2), '\n');

  const errs = [];
  const req = ['incident_type', 'zone_id', 'skills_needed', 'severity', 'primary_id'];
  for (const k of req) if (decision[k] === undefined) errs.push(`champ manquant: ${k}`);
  const primaryIds = snapshot.candidates_primary.map((c) => c.id);
  if (decision.primary_id && !primaryIds.includes(decision.primary_id))
    errs.push(`primary_id "${decision.primary_id}" hors du pool candidates_primary [${primaryIds}]`);
  if (decision.zone_id !== 'Z8') errs.push(`zone_id attendu Z8, reçu ${decision.zone_id}`);
  const bfPool = snapshot.candidates_backfill_by_zone?.Z8?.map((c) => c.id) || [];
  const bfId = decision.backfills?.[0]?.agent_id;
  if (bfId && !bfPool.includes(bfId))
    errs.push(`backfill "${bfId}" hors pool Z8 [${bfPool}]`);

  if (errs.length) { console.error('⚠ Anomalies :\n - ' + errs.join('\n - ')); process.exit(1); }
  console.log(`✅ Crusoe OK — JSON strict valide, primary dans le pool, ${ms} ms.`);
  if (ms > 3000) console.warn('⚠ Latence > 3s : pré-chauffe le modèle et garde le fallback déterministe prêt pour la démo.');
} catch (e) {
  console.error('❌ Appel Crusoe échoué :', e.message);
  console.error('   Vérifie clé, baseURL, nom de modèle. Fallback déterministe garanti côté runtime.');
  process.exit(1);
}

// Éval décisions — scorecard du CERVEAU sur le jeu golden.  (npm run eval)
// Par défaut = brain configuré par .env. Pour PROUVER Crusoe avant la démo :
//   MOCK_CRUSOE=false npm run eval
// Affiche par cas : zone détectée, primary + qualif, RCP/sévérité (cardiaque), latence, source/modèle.
// Sort en échec (exit 1) UNIQUEMENT sur violation d'INVARIANT (sécurité) ; les manques de
// QUALITÉ sont signalés ⚠ (informatif) — un hoquet LLM ne fait pas crier au loup.
import { config, loadSeed } from '../src/config.js';
import { buildState } from '../src/state.js';
import { decide } from '../src/integrations/crusoe.js';
import { GOLDEN, buildEvalSnapshot, evaluateCase } from '../test/golden-decisions.js';

const brain = config.mockCrusoe ? 'MOCK (déterministe)' : `Crusoe RÉEL (${config.crusoe.model})`;
console.log(`\n🧠 Éval décisions — cerveau : ${brain}`);
console.log(`   ${GOLDEN.length} cas · invariants = sécurité (bloquants) · qualité = jugement clinique (informatif)\n`);
if (config.mockCrusoe) console.log('   ⚠ brain MOCKÉ. Pour valider le vrai cerveau : MOCK_CRUSOE=false npm run eval\n');

let invariantFails = 0, qualityWarns = 0, perfect = 0;
const latencies = [];

for (const gold of GOLDEN) {
  const state = buildState(loadSeed());
  const { snapshot, zoneGuess } = buildEvalSnapshot(state, gold);
  const t0 = Date.now();
  const decision = await decide(snapshot, gold.transcript); // ne throw jamais (F9)
  const ms = Date.now() - t0;
  latencies.push(ms);

  const { checks, invariantOk, allOk } = evaluateCase(decision, snapshot, gold);
  const badInv = checks.filter((c) => c.level === 'invariant' && !c.pass);
  const badQual = checks.filter((c) => c.level === 'quality' && !c.pass);
  if (!invariantOk) invariantFails++;
  if (invariantOk && badQual.length) qualityWarns++;
  if (allOk) perfect++;

  const icon = !invariantOk ? '❌' : badQual.length ? '⚠ ' : '✅';
  const tag = decision._model ? decision._model.split('/').pop() : decision._source;
  console.log(`${icon} ${gold.id.padEnd(11)} ${gold.lang}  zone ${zoneGuess ?? '∅'}→${gold.zone}  primary=${decision.primary_id}  ${String(ms).padStart(5)}ms  [${tag}]`);
  for (const c of [...badInv, ...badQual]) {
    console.log(`     ${c.level === 'invariant' ? '❌' : '⚠ '} ${c.name} — ${c.detail}`);
  }
}

const mean = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
const max = latencies.length ? Math.max(...latencies) : 0;
console.log(`\n===== ${perfect}/${GOLDEN.length} parfaits · ${invariantFails} invariant(s) KO · ${qualityWarns} qualité ⚠ · latence moy ${mean}ms / max ${max}ms =====`);
if (invariantFails) {
  console.log('❌ Des invariants de sécurité sont violés — le moteur les répare à l\'exécution, mais à corriger côté décision.\n');
} else if (qualityWarns) {
  console.log('⚠  Invariants OK (dispatch sûr). Manques de qualité ci-dessus : jugement clinique à surveiller.\n');
} else {
  console.log('✅ Toutes les décisions sont sûres ET cliniquement correctes sur le jeu golden.\n');
}
process.exit(invariantFails ? 1 : 0);

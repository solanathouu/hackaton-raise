// Éval décisions — OFFLINE (chemin déterministe). Garde de non-régression du routage :
// tourne dans `npm test`, sans réseau ni clé, quelle que soit la config .env.
// Force le mock AVANT tout import (dotenv n'écrase pas une var déjà posée) : un .env
// avec MOCK_CRUSOE=false ne fait pas fuiter un appel réseau dans la suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.USE_MOCKS = 'true';
process.env.MOCK_CRUSOE = 'true';
process.env.MOCK_GRADIUM = 'true';

const { loadSeed } = await import('../src/config.js');
const { buildState } = await import('../src/state.js');
const { decide } = await import('../src/integrations/crusoe.js');
const { GOLDEN, buildEvalSnapshot, evaluateCase } = await import('./golden-decisions.js');

const fresh = () => buildState(loadSeed());

// Le chemin déterministe garantit : Decision valide, zone détectée, primary dans le pool,
// et (par construction de deterministicDecide) RCP+sévérité sur les cas cardiaques.
// « primary-qualifié » N'EST PAS garanti hors LLM (départage lexical du pool) -> non asserté ici,
// mais mesuré par `npm run eval` contre Crusoe (où alignPrimaryToOptimal le garantit).
for (const gold of GOLDEN) {
  test(`golden ${gold.id} (${gold.lang}) -> ${gold.zone} : invariants + RCP/sévérité déterministes`, async () => {
    const state = fresh();
    const { snapshot } = buildEvalSnapshot(state, gold);
    const decision = await decide(snapshot, gold.transcript);
    const { checks } = evaluateCase(decision, snapshot, gold);

    for (const c of checks) {
      if (c.level === 'invariant' || c.name === 'RCP-si-cardiaque' || c.name === 'sévérité-haute') {
        assert.ok(c.pass, `[${gold.id}] ${c.name} : ${c.detail}`);
      }
    }
  });
}

test('le jeu golden couvre les 3 langues et les 4 scénarios de démo', () => {
  const langs = new Set(GOLDEN.map((g) => g.lang));
  for (const l of ['fr', 'en', 'es']) assert.ok(langs.has(l), `langue ${l} présente`);
  for (const s of ['S1', 'S2', 'S3', 'S4']) assert.ok(GOLDEN.some((g) => g.id === s), `scénario ${s} présent`);
  assert.ok(GOLDEN.some((g) => g.cardiac) && GOLDEN.some((g) => !g.cardiac), 'cas cardiaques ET non-cardiaques');
});

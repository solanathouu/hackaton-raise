import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_CRUSOE_MODELS,
  assertCrusoeModel,
  validateCrusoeLiveWorkflow,
} from '../src/config.js';

test('modèles autorisés — liste stricte à 5 entrées', () => {
  assert.equal(ALLOWED_CRUSOE_MODELS.length, 5);
  assert.ok(ALLOWED_CRUSOE_MODELS.includes('deepseek-ai/Deepseek-V4-Flash'));
  assert.ok(ALLOWED_CRUSOE_MODELS.includes('nvidia/NVIDIA-Nemotron-3-Ultra-550B'));
});

test('modèle hors allowlist rejeté', () => {
  assert.throws(
    () => assertCrusoeModel('openai/gpt-oss-120b'),
    /non autorisé/,
  );
});

test('validateCrusoeLiveWorkflow — primary et fallback différents requis', () => {
  const bad = validateCrusoeLiveWorkflow({
    useMocks: false,
    crusoe: {
      apiKey: 'test-key',
      model: 'deepseek-ai/Deepseek-V4-Flash',
      modelFallback: 'deepseek-ai/Deepseek-V4-Flash',
    },
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('différents')));
});

test('validateCrusoeLiveWorkflow — config valide passe', () => {
  const ok = validateCrusoeLiveWorkflow({
    useMocks: false,
    crusoe: {
      apiKey: 'test-key',
      model: 'nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B',
      modelFallback: 'deepseek-ai/Deepseek-V4-Flash',
    },
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.errors, []);
});

// dispatch-lang.test.js — la langue du TTS/dispatch suit l'incident (langue du témoin),
// pas la langue du roster de l'agent (bug jury EN : W1 fr recevait un message français).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSeed } from '../src/config.js';
import { buildState } from '../src/state.js';
import { dispatchText } from '../src/agent.js';

const state = buildState(loadSeed('demo'));
const primary = { id: 'AS1', agent_id: 'W1', role: 'primary', target_zone: 'Z8' };
const witness = { id: 'AS2', agent_id: 'W2', role: 'witness', target_zone: 'Z8' };

test('dispatchText uses the incident language over the agent roster language', () => {
  const incident = { id: 'I1', language: 'en', type: 'arret_cardiaque', primary_id: 'W1' };
  const { text, lang } = dispatchText(primary, incident, state);
  assert.equal(lang, 'en');
  assert.match(text, /Cardiac arrest at .+ you are the closest\. Go now\./);
});

test('dispatchText falls back to the agent language when incident has none', () => {
  const incident = { id: 'I2', language: null, type: 'arret_cardiaque', primary_id: 'W1' };
  const { text, lang } = dispatchText(primary, incident, state);
  assert.equal(lang, 'fr'); // W1 languages = [fr, en]
  assert.match(text, /Arrêt cardiaque/);
});

test('dispatchText normalizes free-text LLM incident types (« arrêt cardiaque »)', () => {
  // Nemotron renvoie parfois le type en texte libre au lieu de la clé arret_cardiaque.
  const incident = { id: 'I4', language: 'en', type: 'arrêt cardiaque', primary_id: 'W1' };
  const { text } = dispatchText(primary, incident, state);
  assert.match(text, /^Cardiac arrest at /);
});

test('dispatchText witness message follows the incident language too', () => {
  const incident = { id: 'I3', language: 'es', type: 'malaise', primary_id: 'W1' };
  const { text, lang } = dispatchText(witness, incident, state);
  assert.equal(lang, 'es');
  assert.match(text, /interviene Nathan Skwarek/);
});

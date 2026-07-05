import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState } from '../src/state.js';
import { computeRepositionHints, nearestZone, hintForAgentId, resolveGpsZone } from '../src/guidance.js';
import { setPosition } from '../src/state.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const zones = JSON.parse(readFileSync(join(root, 'data/zones.json'), 'utf8'));
const roster = JSON.parse(readFileSync(join(root, 'data/roster.json'), 'utf8'));

test('nearestZone picks closest zone by lat/lon', () => {
  const z5 = zones.find((z) => z.id === 'Z5');
  assert.equal(nearestZone(zones, z5.lat, z5.lon), 'Z5');
  const z8 = zones.find((z) => z.id === 'Z8');
  assert.equal(nearestZone(zones, z8.lat, z8.lon), 'Z8');
});

test('resolveGpsZone rejects point too far from park', () => {
  assert.equal(resolveGpsZone(zones, 0, 0, 800), null);
});

test('computeRepositionHints suggests surplus agent toward understaffed zone', () => {
  const state = buildState({ zones, roster });
  // Z8 min 2 — ne laisser qu'un agent
  for (const a of state.agents) {
    if (a.current_zone === 'Z8' && a.id !== 'A8') setPosition(state, a.id, 'Z2');
  }
  setPosition(state, 'R1', 'Z9'); // réserviste en zone surplus
  const hints = computeRepositionHints(state);
  const forR1 = hints.find((h) => h.agentId === 'R1');
  assert.ok(forR1, 'R1 en surplus Z9 devrait recevoir un hint vers zone sous-staffée');
  assert.equal(forR1.targetZone, 'Z8');
  assert.ok(forR1.etaSec > 0);
});

test('hintForAgentId returns null when agent not in surplus', () => {
  const state = buildState({ zones, roster });
  // Marco seul à Z2 avec min 2 → pas de surplus
  for (const a of state.agents) if (a.current_zone === 'Z2' && a.id !== 'A1') setPosition(state, a.id, 'Z5');
  assert.equal(hintForAgentId(state, 'A1'), null);
});

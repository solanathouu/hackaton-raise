import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSeed, loadDemoRoster } from '../src/config.js';
import { buildState } from '../src/state.js';

test('loadDemoRoster returns 5 team agents W1-W5', () => {
  const roster = loadDemoRoster();
  const team = roster.filter((a) => !a.is_reserve);
  assert.equal(team.length, 5);
  assert.deepEqual(team.map((a) => a.id), ['W1', 'W2', 'W3', 'W4', 'W5']);
  assert.ok(!team.some((a) => /Emma|Sophia|Marco|Hugo/i.test(a.name)));
});

test('loadSeed demo mode builds state with demo roster', () => {
  const state = buildState(loadSeed('demo'));
  assert.equal(state.agents.length, 8);
  assert.equal(state.agents.find((a) => a.id === 'W1')?.name, 'Nathan Skwarek');
});

test('loadSeed real mode keeps production roster', () => {
  const state = buildState(loadSeed('real'));
  assert.equal(state.agents.length, 16);
  assert.ok(state.agents.some((a) => a.id === 'A10' && a.name === 'Emma'));
});

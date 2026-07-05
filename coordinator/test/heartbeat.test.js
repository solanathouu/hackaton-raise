// Presence heartbeat — sans réseau : joignabilité des pools de candidats (additif).
// Règle : heartbeat < 30 s -> joignable ; silencieux > 30 s -> exclu primary/backfill ;
// AUCUN heartbeat (agent simulé, ancien client) -> joignable par défaut (démo intacte).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.USE_MOCKS = 'true';

const { loadSeed } = await import('../src/config.js');
const { buildState, serializeState } = await import('../src/state.js');
const { isReachable, markHeartbeat, REACHABLE_MS } = await import('../src/presence.js');
const { candidatesPrimary, candidatesBackfill, buildSnapshot } = await import('../src/engine.js');

const fresh = () => buildState(loadSeed());

test('isReachable : sans heartbeat -> joignable par défaut (rétrocompatible)', () => {
  assert.equal(isReachable({ id: 'A1' }), true);
});

test('isReachable : heartbeat récent -> oui ; silencieux 40 s -> non', () => {
  const now = Date.now();
  assert.equal(isReachable({ last_heartbeat: now - 5000 }, now), true);
  assert.equal(isReachable({ last_heartbeat: now - 40000 }, now), false);
  assert.equal(REACHABLE_MS, 30000);
});

test('markHeartbeat : pose last_heartbeat (horloge serveur) + batterie arrondie', () => {
  const s = fresh();
  const before = Date.now();
  const a = markHeartbeat(s, 'A1', { battery: 87.6 });
  assert.ok(a.last_heartbeat >= before);
  assert.equal(a.battery, 88);
  assert.equal(markHeartbeat(s, 'ZZZ'), null); // agent inconnu -> no-op
});

test('candidatesPrimary : silencieux 40 s -> exclu du pool, réintégré au heartbeat suivant', () => {
  const s = fresh();
  const before = candidatesPrimary(s, 'Z8', ['RCP']);
  assert.ok(before.length >= 2, 'pool primary non vide sur le seed');
  const top = before[0]; // A7 (Hugo) sur le seed
  s.agents.find((x) => x.id === top.id).last_heartbeat = Date.now() - 40000;
  const after = candidatesPrimary(s, 'Z8', ['RCP']);
  assert.ok(!after.some((c) => c.id === top.id), `${top.id} silencieux doit sortir du pool`);
  markHeartbeat(s, top.id, { battery: 61 });
  const again = candidatesPrimary(s, 'Z8', ['RCP']);
  assert.ok(again.some((c) => c.id === top.id), `${top.id} revient après un heartbeat`);
});

test('candidatesBackfill : silencieux 40 s -> exclu du pool backfill', () => {
  const s = fresh();
  const before = candidatesBackfill(s, 'Z8');
  assert.ok(before.length >= 1, 'pool backfill non vide sur le seed');
  const top = before[0]; // A1 (Marco) sur le seed
  s.agents.find((x) => x.id === top.id).last_heartbeat = Date.now() - 40000;
  const after = candidatesBackfill(s, 'Z8');
  assert.ok(!after.some((c) => c.id === top.id), `${top.id} silencieux doit sortir du backfill`);
});

test('buildSnapshot : battery exposée sur les candidats si connue, absente sinon (fixtures intactes)', () => {
  const s = fresh();
  markHeartbeat(s, 'A7', { battery: 42 });
  const snap = buildSnapshot(s, 'Z8', { transcript: 'x', lang: 'fr' });
  const withBat = snap.candidates_primary.find((c) => c.id === 'A7');
  const without = snap.candidates_primary.find((c) => c.id !== 'A7');
  assert.equal(withBat.battery, 42);
  assert.ok(!('battery' in without), 'pas de champ battery sans heartbeat');
});

test('serializeState : last_heartbeat/battery additifs, émis seulement si présents', () => {
  const s = fresh();
  markHeartbeat(s, 'A2', { battery: 55 });
  const st = serializeState(s);
  const a2 = st.agents.find((a) => a.id === 'A2');
  const a1 = st.agents.find((a) => a.id === 'A1');
  assert.ok(a2.last_heartbeat > 0);
  assert.equal(a2.battery, 55);
  assert.ok(!('last_heartbeat' in a1) && !('battery' in a1));
});

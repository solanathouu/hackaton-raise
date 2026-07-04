// Test du log SQLite (node:sqlite natif). node --test test/persistence.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { createStore } from '../src/persistence.js';

test('createStore(null) = no-op sûr (persistance désactivée)', () => {
  const s = createStore(null);
  assert.equal(s.enabled, false);
  assert.doesNotThrow(() => s.logIncident({ id: 'x' }));
  assert.deepEqual(s.listIncidents(), []);
  s.close();
});

test('log + relecture des incidents/assignments (SQLite natif)', () => {
  const path = resolve(tmpdir(), `conductor-test-${process.pid}.sqlite`);
  rmSync(path, { force: true });
  const s = createStore(path);
  // node:sqlite peut être absent (Node < 22) -> on skip proprement.
  if (!s.enabled) { console.log('  (node:sqlite indispo, skip)'); return; }

  s.logIncident({ id: 'inc_1', created_at: 1000, transcript: 'arrêt cardiaque', lang: 'fr', type: 'arret_cardiaque', zone_id: 'Z8', severity: 5, primary_id: 'A7', source: 'mock', degraded: false, justification: 'ok' });
  s.logAssignment({ id: 'as_1', incident_id: 'inc_1', agent_id: 'A7', role: 'primary', target_zone: 'Z8', status: 'sent', sent_at: 1000 });
  s.logAssignment({ id: 'as_2', incident_id: 'inc_1', agent_id: 'A1', role: 'backfill', target_zone: 'Z8', status: 'sent', sent_at: 1001 });
  s.setAssignmentStatus('as_1', 'ack');
  s.logEvent('dispatch', { assignmentId: 'as_1' });

  const list = s.listIncidents(10);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'inc_1');
  assert.equal(list[0].primary_id, 'A7');
  assert.equal(list[0].zone_id, 'Z8');
  assert.equal(list[0].degraded, 0);

  // idempotence (INSERT OR REPLACE)
  s.logIncident({ id: 'inc_1', created_at: 2000, zone_id: 'Z8' });
  assert.equal(s.listIncidents(10).length, 1, 'même id -> pas de doublon');

  s.close();
  rmSync(path, { force: true });
});

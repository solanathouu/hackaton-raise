import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDecision, extractDecisionJson, alignPrimaryToOptimal } from '../src/integrations/crusoe.js';

const SNAPSHOT = {
  incident: { transcript: 'arrêt cardiaque au manège extrême', lang: 'fr', zone_id: 'Z8' },
  zones: [{ id: 'Z8', name: 'Manège Extrême', headcount: 2, required_min: 2, surplus: 0, required_skills: ['RCP'] }],
  constraints: [],
  candidates_primary: [
    { id: 'A7', name: 'Hugo', skills: ['RCP'], current_zone: 'Z8', travel_time_s: 0, is_reserve: false, safe: true },
    { id: 'A1', name: 'Marco', skills: ['RCP', 'DAE'], current_zone: 'Z2', travel_time_s: 60, is_reserve: false, safe: true },
  ],
  candidates_backfill_by_zone: {
    Z8: [
      { id: 'A1', name: 'Marco', skills: ['RCP', 'DAE'], current_zone: 'Z2', travel_time_s: 60, is_reserve: false, safe: true },
      { id: 'R1', name: 'Paul', skills: ['RCP'], current_zone: 'Z9', travel_time_s: 130, is_reserve: true, safe: true },
    ],
  },
};

test('validateDecision — décision kickoff valide', () => {
  const raw = {
    incident_type: 'arret_cardiaque',
    zone_id: 'Z8',
    skills_needed: ['RCP'],
    severity: 5,
    primary_id: 'A7',
    backfills: [{ agent_id: 'A1', target_zone: 'Z8' }],
    warning: null,
    justification: 'Hugo sur zone, Marco backfill.',
    constraints_applied: [],
  };
  const { ok, errors, decision } = validateDecision(raw, SNAPSHOT);
  assert.equal(ok, true, errors.join('; '));
  assert.equal(decision.primary_id, 'A7');
  assert.deepEqual(decision.backfills, [{ agent_id: 'A1', target_zone: 'Z8' }]);
});

test('validateDecision — rejette primary hors pool', () => {
  const { ok, errors } = validateDecision(
    { incident_type: 'x', zone_id: 'Z8', primary_id: 'A99', backfills: [], justification: 'x' },
    SNAPSHOT,
  );
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('primary_id')));
});

test('validateDecision — rejette backfill hors pool', () => {
  const { ok, errors } = validateDecision(
    {
      incident_type: 'x',
      zone_id: 'Z8',
      primary_id: 'A7',
      backfills: [{ agent_id: 'A3', target_zone: 'Z8' }],
      justification: 'x',
    },
    SNAPSHOT,
  );
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('backfills[0]')));
});

test('extractDecisionJson — parse fence markdown', () => {
  const obj = extractDecisionJson({ content: '```json\n{"primary_id":"A7"}\n```' });
  assert.equal(obj.primary_id, 'A7');
});

test('alignPrimaryToOptimal — choisit le plus proche qualifié', () => {
  const raw = {
    incident_type: 'arret_cardiaque',
    zone_id: 'Z8',
    skills_needed: ['RCP'],
    severity: 5,
    primary_id: 'A1',
    backfills: [],
    justification: 'test',
    constraints_applied: [],
  };
  const { decision } = validateDecision(raw, SNAPSHOT);
  const aligned = alignPrimaryToOptimal(decision, SNAPSHOT);
  assert.equal(aligned.primary_id, 'A7');
  assert.ok(aligned.constraints_applied.some((c) => c.includes('realigné')));
});

// --- zone_source : la zone LLM prime quand detectZone n'a RIEN reconnu (défaut) -------------
const SNAPSHOT_DEFAULT_ZONE = {
  // detectZone a raté -> zone_id = première zone (Z1), marquée 'default'.
  incident: { transcript: 'a man collapsed at the merry-go-round', lang: 'en', zone_id: 'Z1', zone_source: 'default' },
  zones: [
    { id: 'Z1', name: 'Entrance', headcount: 1, required_min: 1, surplus: 0, required_skills: [] },
    { id: 'Z8', name: 'Extreme Ride', headcount: 2, required_min: 2, surplus: 0, required_skills: ['RCP'] },
  ],
  constraints: [],
  candidates_primary: [
    { id: 'A7', name: 'Hugo', skills: ['RCP'], current_zone: 'Z8', travel_time_s: 0, is_reserve: false, safe: true },
  ],
  candidates_backfill_by_zone: {},
};
const rawLlm = (zone) => ({
  incident_type: 'cardiac_arrest', zone_id: zone, skills_needed: ['RCP'], severity: 5,
  primary_id: 'A7', backfills: [], justification: 'test', constraints_applied: [],
});

test('zone_source=default — la zone comprise par le LLM est CONSERVÉE (pas de retour forcé au défaut)', () => {
  const { ok, decision } = validateDecision(rawLlm('Z8'), SNAPSHOT_DEFAULT_ZONE);
  assert.ok(ok);
  assert.equal(decision.zone_id, 'Z8'); // avant le fix : forcée à Z1 (Entrée)
});

test('zone_source=default — une zone LLM INCONNUE retombe sur le défaut (pas de zone fantôme)', () => {
  const { decision } = validateDecision(rawLlm('Z99'), SNAPSHOT_DEFAULT_ZONE);
  assert.equal(decision.zone_id, 'Z1');
});

test('zone_source absent/détecté — comportement historique intact : la zone détectée prime', () => {
  const snapDetected = { ...SNAPSHOT_DEFAULT_ZONE, incident: { ...SNAPSHOT_DEFAULT_ZONE.incident, zone_source: 'detected' } };
  assert.equal(validateDecision(rawLlm('Z8'), snapDetected).decision.zone_id, 'Z1');
  const snapLegacy = { ...SNAPSHOT_DEFAULT_ZONE, incident: { transcript: 'x', lang: 'en', zone_id: 'Z1' } };
  assert.equal(validateDecision(rawLlm('Z8'), snapLegacy).decision.zone_id, 'Z1');
});

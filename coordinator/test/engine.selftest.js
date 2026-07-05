// Self-test du moteur (node test/engine.selftest.js). Exit != 0 si un check casse.
// Valide : graphe, snapshot Z8 (vs mock kickoff), detectZone, scénarios S1..S4.
import { loadSeed } from '../src/config.js';
import { buildState } from '../src/state.js';
import {
  buildSnapshot, applyDecision, detectZone, travelTime, headcount, surplus, cascadeBackfill,
  candidatesBackfill, protectedAgentIds,
} from '../src/engine.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.log(`  ✗ ${msg}`); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (attendu ${JSON.stringify(b)}, reçu ${JSON.stringify(a)})`);

const fresh = () => buildState(loadSeed());

console.log('\n[1] Graphe de trajets (Floyd-Warshall)');
{
  const s = fresh();
  eq(travelTime(s, 'Z8', 'Z8'), 0, 'Z8->Z8 = 0');
  eq(travelTime(s, 'Z2', 'Z8'), 60, 'Z2->Z8 = 60 (adjacent)');
  eq(travelTime(s, 'Z8', 'Z2'), 60, 'symétrique Z8->Z2 = 60');
  eq(travelTime(s, 'Z9', 'Z8'), 205, 'Z9->Z8 = 205 (Z9->Z5->Z2->Z8) — la fixture kickoff dit 130 (approx à la main)');
  eq(travelTime(s, 'Z1', 'Z5'), 60, 'Z1->Z5 = 60');
}

console.log('\n[2] État de départ : couverture & surplus');
{
  const s = fresh();
  eq(headcount(s, 'Z8'), 2, 'Z8 headcount = 2');
  eq(surplus(s, 'Z8'), 0, 'Z8 surplus = 0');
  eq(surplus(s, 'Z2'), 1, 'Z2 surplus = +1');
  eq(surplus(s, 'Z5'), 1, 'Z5 surplus = +1');
  eq(surplus(s, 'Z4'), 0, 'Z4 surplus = 0');
}

console.log('\n[3] buildSnapshot(Z8) vs Mock Snapshot kickoff');
{
  const s = fresh();
  const snap = buildSnapshot(s, 'Z8', { transcript: 'cardiac arrest at the extreme ride', lang: 'en' });
  const z8 = snap.zones.find((z) => z.id === 'Z8');
  eq({ h: z8.headcount, m: z8.required_min, su: z8.surplus }, { h: 2, m: 2, su: 0 }, 'zone Z8 snapshot');
  const cp = snap.candidates_primary;
  eq([cp[0].id, cp[0].travel_time_s], ['A7', 0], 'primary #1 = Hugo (A7) @0s');
  eq([cp[1].id, cp[1].travel_time_s], ['A1', 60], 'primary #2 = Marco (A1) @60s');
  ok(!!snap.candidates_backfill_by_zone.Z8, 'pool backfill pour Z8 présent');
  const bf = snap.candidates_backfill_by_zone.Z8;
  eq([bf[0].id, bf[0].travel_time_s, bf[0].safe], ['A1', 60, true], 'backfill #1 = Marco (A1) @60s safe');
  ok(bf.every((c) => c.skills.includes('RCP')), 'tous les backfills Z8 ont RCP (skill de la zone préservé)');
  ok(!bf.some((c) => c.id === 'A3'), 'Karim (A3, secu) EXCLU du backfill Z8 (ne couvre pas RCP)');
}

console.log('\n[4] detectZone (déterministe, multilingue)');
{
  const s = fresh();
  eq(detectZone('cardiac arrest at the extreme ride, he is not breathing', s.zones), 'Z8', 'EN "extreme ride" -> Z8');
  eq(detectZone('un hombre se desplomó en la entrada, no respira', s.zones), 'Z1', 'ES "entrada" -> Z1');
  eq(detectZone('medical issue at the roller coaster', s.zones), 'Z2', 'EN "roller coaster" -> Z2');
  eq(detectZone('arrêt cardiaque au manège extrême, il ne respire plus', s.zones), 'Z8', 'FR "manège extrême" -> Z8 (legacy alias)');
  eq(detectZone('malaise au grand huit', s.zones), 'Z2', 'FR "grand huit" -> Z2 (legacy alias)');
}

console.log('\n[S1] Ponction de surplus, zéro cascade (incident Z2)');
{
  const s = fresh();
  const dec = { incident_type: 'malaise', zone_id: 'Z2', skills_needed: ['RCP'], severity: 3, primary_id: 'A1', backfills: [], warning: null };
  const r = applyDecision(dec, s, { incidentId: 'inc_s1' });
  eq(r.assignments.map((a) => `${a.role}:${a.agent_id}`), ['primary:A1'], 'un seul appel : primary Marco, aucun backfill');
  eq(r.warnings.length, 0, 'aucun warning (Z2 reste à 2 = min, RCP couvert par Ana)');
}

console.log('\n[S2] Cascade 2-hop : arrêt cardiaque Z8 (au min) -> backfill RCP');
{
  const s = fresh();
  // Le LLM ne propose AUCUN backfill : le moteur doit réparer tout seul.
  const dec = { incident_type: 'arret_cardiaque', zone_id: 'Z8', skills_needed: ['RCP'], severity: 5, primary_id: 'A7', backfills: [], warning: null };
  const r = applyDecision(dec, s, { incidentId: 'inc_s2' });
  const primary = r.assignments.find((a) => a.role === 'primary');
  const backfill = r.assignments.find((a) => a.role === 'backfill');
  eq(primary.agent_id, 'A7', 'primary = Hugo (sur zone)');
  ok(!!backfill, 'un backfill a été généré (Z8 tombait sous le min)');
  eq([backfill.agent_id, backfill.target_zone], ['A1', 'Z8'], 'backfill = Marco (RCP surplus Z2) vers Z8');
  eq(r.warnings.length, 0, 'aucun warning : cascade résolue proprement');
}

console.log('\n[S2b] Le moteur REJETTE un backfill LLM invalide (Karim secu) et répare');
{
  const s = fresh();
  const dec = { incident_type: 'arret_cardiaque', zone_id: 'Z8', skills_needed: ['RCP'], severity: 5, primary_id: 'A7', backfills: [{ agent_id: 'A3', target_zone: 'Z8' }], warning: null };
  const r = applyDecision(dec, s, { incidentId: 'inc_s2b' });
  const bf = r.assignments.filter((a) => a.role === 'backfill');
  ok(!bf.some((a) => a.agent_id === 'A3'), 'Karim (secu) refusé : ne restaure pas RCP');
  ok(bf.some((a) => a.agent_id === 'A1'), 'réparé avec Marco (RCP)');
}

console.log('\n[S3] Alerte proactive : surplus épuisé -> aucun backfill sûr -> warning');
{
  const s = fresh();
  // Épuise réservistes + surplus : R1,R2 en mission ; Z2 et Z5 ramenés au minimum.
  for (const id of ['R1', 'R2', 'A1', 'A4']) s.agents.find((a) => a.id === id).status = 'responding';
  const dec = { incident_type: 'arret_cardiaque', zone_id: 'Z8', skills_needed: ['RCP'], severity: 5, primary_id: 'A7', backfills: [], warning: null };
  const r = applyDecision(dec, s, { incidentId: 'inc_s3' });
  ok(r.assignments.some((a) => a.role === 'primary' && a.agent_id === 'A7'), 'Hugo part quand même (urgence)');
  ok(r.assignments.every((a) => a.role !== 'backfill'), 'aucun backfill possible (rien de safe)');
  ok(r.warnings.length >= 1, 'warning proactif émis');
  ok(/Z8|Extreme Ride/.test(r.warnings[0].message), `message warning cohérent : "${r.warnings[0]?.message}"`);
}

console.log('\n[S4] Reserve + entrance report -> Paul (free puncture)');
{
  const s = fresh();
  const dec = { incident_type: 'arret_cardiaque', zone_id: 'Z1', skills_needed: ['RCP'], severity: 5, primary_id: 'R1', backfills: [], warning: null };
  const r = applyDecision(dec, s, { incidentId: 'inc_s4' });
  eq(r.assignments.map((a) => `${a.role}:${a.agent_id}`), ['primary:R1'], 'primary = Paul (réserviste), zéro backfill');
  eq(r.warnings.length, 0, 'aucun trou : un réserviste ne vide aucun poste');
}

console.log('\n[Invariant] Une Decision LLM ne peut jamais laisser une zone sous le min sans warning');
{
  const s = fresh();
  // primary_id bidon + backfill bidon : le moteur doit réparer ou warn, jamais casser.
  const dec = { zone_id: 'Z8', skills_needed: ['RCP'], severity: 5, primary_id: 'ZZZ', backfills: [{ agent_id: 'ZZZ', target_zone: 'Z8' }], warning: null };
  const r = applyDecision(dec, s, { incidentId: 'inc_inv' });
  ok(r.assignments.some((a) => a.role === 'primary'), 'primary réparé malgré un id LLM invalide');
}

console.log('\n[F8a] Override appris (protège un agent) : le moteur ne ponctionne PLUS Marco');
{
  const s = fresh();
  s.constraints.push({ id: 'c1', scope: 'global', rule_text: 'protège Marco', source_override: 'inc_x' });
  const { protectedSet, applied } = protectedAgentIds(s);
  ok(protectedSet.has('A1'), 'Marco (A1) reconnu comme protégé');
  ok(applied.includes('protège Marco'), 'contrainte listée dans applied');
  // LLM propose quand même Marco en backfill -> le moteur DOIT le refuser et réparer avec Ana.
  const dec = { incident_type: 'arret_cardiaque', zone_id: 'Z8', skills_needed: ['RCP'], severity: 5, primary_id: 'A7', backfills: [{ agent_id: 'A1', target_zone: 'Z8' }], warning: null };
  const r = applyDecision(dec, s, { incidentId: 'inc_f8a' });
  const bf = r.assignments.find((a) => a.role === 'backfill');
  ok(bf && bf.agent_id !== 'A1', `backfill n'est PAS Marco [reçu ${bf?.agent_id}]`);
  eq(bf?.agent_id, 'A2', 'backfill = Ana (A2), prochain RCP safe non protégé');
  ok(r.incident.constraints_applied.includes('protège Marco'), 'incident.constraints_applied renseigné');
}

console.log('\n[F8b] Zone constraint: "protect the Roller Coaster" protects all Z2 agents');
{
  const s = fresh();
  s.constraints.push({ id: 'c2', scope: 'zone', rule_text: 'protect the Roller Coaster', source_override: 'inc_y' });
  const { protectedSet } = protectedAgentIds(s);
  ok(['A1', 'A2', 'A3'].every((id) => protectedSet.has(id)), 'Marco+Ana+Karim (Z2) protégés');
  const bf = candidatesBackfill(s, 'Z8');
  ok(!bf.some((c) => ['A1', 'A2'].includes(c.id)), 'aucun agent de Z2 dans le pool backfill Z8');
  eq(bf[0]?.id, 'A4', 'backfill Z8 tombe sur Léa (A4, Z5 surplus)');
}

console.log('\n[H1] Surplus épuisé : le backfill tombe sur un RÉSERVISTE, sans warning');
{
  const s = fresh();
  for (const id of ['A1', 'A4']) s.agents.find((a) => a.id === id).status = 'responding'; // vide surplus Z2 et Z5
  const dec = { incident_type: 'arret_cardiaque', zone_id: 'Z8', skills_needed: ['RCP'], severity: 5, primary_id: 'A7', backfills: [], warning: null };
  const r = applyDecision(dec, s, { incidentId: 'inc_h1' });
  const bf = r.assignments.find((a) => a.role === 'backfill');
  ok(bf && ['R1', 'R2'].includes(bf.agent_id), `backfill = réserviste [reçu ${bf?.agent_id}]`);
  ok(r.warnings.length === 0, 'aucun warning (le réserviste couvre proprement)');
}

console.log('\n[H2] Primary protégé : le moteur choisit un autre répondant');
{
  const s = fresh();
  s.constraints.push({ id: 'c3', scope: 'agent', rule_text: 'ne bouge pas Hugo', source_override: 'inc_z' });
  const dec = { incident_type: 'arret_cardiaque', zone_id: 'Z8', skills_needed: ['RCP'], severity: 5, primary_id: 'A7', backfills: [], warning: null };
  const r = applyDecision(dec, s, { incidentId: 'inc_h2' });
  const prim = r.assignments.find((a) => a.role === 'primary');
  ok(prim && prim.agent_id !== 'A7', `primary n'est PAS Hugo (protégé) [reçu ${prim?.agent_id}]`);
  eq(prim?.agent_id, 'A1', 'primary = Marco (RCP le plus proche non protégé)');
}

console.log(`\n===== ${pass} OK / ${fail} KO =====\n`);
process.exit(fail === 0 ? 0 : 1);

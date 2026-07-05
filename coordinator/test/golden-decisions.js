// golden-decisions.js — jeu de référence pour l'éval du CERVEAU (Contrat E : decide()).
// Partagé, SANS effet de bord (ni exit, ni I/O) : consommé par
//   - test/eval-decisions.test.js  (offline, chemin déterministe, garde de non-régression)
//   - scripts/eval-decisions.js    (npm run eval — Crusoe RÉEL, scorecard + latence)
//
// On teste ce que la démo utilise vraiment : detectZone -> buildSnapshot -> decide.
// Deux niveaux de check :
//   INVARIANTS (sécurité, garantis par construction sur les DEUX cerveaux) :
//     Decision bien formée · zone détectée correcte · primary dans le pool.
//   QUALITÉ (jugement clinique, ce qu'on veut PROUVER sur Crusoe) :
//     cardiaque -> RCP dans les skills · sévérité haute · primary réellement qualifié.
import { detectZone, buildSnapshot } from '../src/engine.js';

// Transcripts réels de la démo + cas adverses (multilingue, alias de zone, zone sans
// skill médical). `cardiac` = l'appel décrit un arrêt/inconscience -> RCP attendu.
export const GOLDEN = [
  // --- Scénarios de démo (doivent être béton) ---
  { id: 'S1', lang: 'fr', transcript: 'malaise au grand huit, une personne au sol', zone: 'Z2', cardiac: false },
  { id: 'S2', lang: 'fr', transcript: 'arrêt cardiaque au manège extrême, il ne respire plus', zone: 'Z8', cardiac: true },
  { id: 'S3', lang: 'fr', transcript: 'malaise à la zone enfants, personne inconsciente', zone: 'Z6', cardiac: true },
  { id: 'S4', lang: 'es', transcript: 'un hombre se desplomó en la entrada, no respira', zone: 'Z1', cardiac: true },
  // --- Robustesse : langues + alias + zone sans required_skills ---
  { id: 'EN-cardiac', lang: 'en', transcript: 'a man is unconscious at the food court, not breathing', zone: 'Z7', cardiac: true },
  { id: 'ES-alias', lang: 'es', transcript: 'accidente en la montaña rusa, está inconsciente', zone: 'Z2', cardiac: true },
  { id: 'FR-alias', lang: 'fr', transcript: 'chute à la rivière sauvage, il ne respire plus', zone: 'Z4', cardiac: true },
  { id: 'FR-secu', lang: 'fr', transcript: 'bagarre à la place centrale, deux personnes se battent', zone: 'Z5', cardiac: false },
  { id: 'EN-faint', lang: 'en', transcript: 'someone fainted near the ferris wheel', zone: 'Z3', cardiac: false },
];

// Mirroir EXACT du pipeline (agent.js handleIncident) : zone détectée -> snapshot.
export function buildEvalSnapshot(state, gold) {
  const zoneGuess = detectZone(gold.transcript, state.zones);
  const incidentZone = zoneGuess || state.zones[0]?.id; // jamais de zone nulle (apport P4)
  const snapshot = buildSnapshot(state, incidentZone, { transcript: gold.transcript, lang: gold.lang });
  return { snapshot, zoneGuess, incidentZone };
}

function poolHasSkill(agent, skillsNeeded) {
  if (!skillsNeeded?.length) return true;
  return (agent?.skills || []).some((sk) => skillsNeeded.includes(sk));
}

// Renvoie les checks nommés d'un cas. Aucun throw : le consommateur décide quoi asserter.
export function evaluateCase(decision, snapshot, gold) {
  const pool = snapshot?.candidates_primary || [];
  const ids = new Set(pool.map((c) => c.id));
  const primary = pool.find((c) => c.id === decision?.primary_id);
  const skills = Array.isArray(decision?.skills_needed) ? decision.skills_needed : [];
  const sev = Number(decision?.severity);

  const shapeOk =
    !!decision &&
    !!decision.incident_type &&
    !!decision.zone_id &&
    !!decision.primary_id &&
    !!decision.justification &&
    Array.isArray(decision.backfills) &&
    sev >= 1 && sev <= 5;

  const checks = [
    { name: 'decision-valide', level: 'invariant', pass: shapeOk, detail: shapeOk ? '' : 'champs requis manquants ou sévérité hors 1-5' },
    { name: 'zone-correcte', level: 'invariant', pass: decision?.zone_id === gold.zone, detail: `attendu ${gold.zone}, reçu ${decision?.zone_id}` },
    { name: 'primary-dans-pool', level: 'invariant', pass: !!decision?.primary_id && ids.has(decision.primary_id), detail: `${decision?.primary_id} ∉ [${[...ids].join(',')}]` },
    { name: 'primary-qualifié', level: 'quality', pass: poolHasSkill(primary, skills), detail: `${decision?.primary_id} (${(primary?.skills || []).join(',') || '∅'}) vs besoin [${skills.join(',') || '∅'}]` },
  ];
  if (gold.cardiac) {
    checks.push({ name: 'RCP-si-cardiaque', level: 'quality', pass: skills.includes('RCP'), detail: `skills=[${skills.join(',') || '∅'}]` });
    checks.push({ name: 'sévérité-haute', level: 'quality', pass: sev >= 4, detail: `severity=${sev}` });
  }

  const invariantOk = checks.filter((c) => c.level === 'invariant').every((c) => c.pass);
  const allOk = checks.every((c) => c.pass);
  return { checks, invariantOk, allOk };
}

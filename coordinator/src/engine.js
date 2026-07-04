// engine.js — Moteur déterministe surplus-aware. PUR : aucune API externe, aucune I/O.
// Garantit la math de couverture (Contrat F). Le LLM propose ; le moteur valide et répare.
//
// Invariants (voir CONTRACTS.md) :
//   1. Jamais une zone sous required_min ni ses required_skills découverts, sans coverage_warning.
//   2. Ponction : réservistes (gratuit) -> surplus -> (forcé => warning).
//   3. Cascade 2 hops max, sinon warning.

export const EMERGENCY_SKILLS = ['RCP', 'DAE', 'medic', 'first-aid', 'secu'];

// ---------------------------------------------------------------------------
// Graphe des trajets — Floyd-Warshall sur les adjacences (traitées symétriques).
// ---------------------------------------------------------------------------
export function computeTravelMatrix(zones) {
  const ids = zones.map((z) => z.id);
  const INF = Infinity;
  const dist = {};
  for (const a of ids) {
    dist[a] = {};
    for (const b of ids) dist[a][b] = a === b ? 0 : INF;
  }
  for (const z of zones) {
    for (const edge of z.adjacency || []) {
      const t = edge.t;
      // symétrique : on garde le min des deux sens si les deux existent
      dist[z.id][edge.z] = Math.min(dist[z.id][edge.z], t);
      dist[edge.z][z.id] = Math.min(dist[edge.z][z.id], t);
    }
  }
  for (const k of ids)
    for (const i of ids)
      for (const j of ids)
        if (dist[i][k] + dist[k][j] < dist[i][j]) dist[i][j] = dist[i][k] + dist[k][j];
  return dist;
}

// ---------------------------------------------------------------------------
// Accès
// ---------------------------------------------------------------------------
export const zoneById = (state, id) => state.zones.find((z) => z.id === id);
export const agentById = (state, id) => state.agents.find((a) => a.id === id);

export function travelTime(state, fromZone, toZone) {
  if (!fromZone || !toZone) return null;
  const d = state.travel?.[fromZone]?.[toZone];
  return d === undefined ? null : d;
}

// ---------------------------------------------------------------------------
// Couverture
// ---------------------------------------------------------------------------
export function availableInZone(state, zoneId) {
  return state.agents.filter((a) => a.status === 'available' && a.current_zone === zoneId);
}
export function headcount(state, zoneId) {
  return availableInZone(state, zoneId).length;
}
export function surplus(state, zoneId) {
  const z = zoneById(state, zoneId);
  if (!z) return 0;
  return headcount(state, zoneId) - z.required_min;
}
// Toutes les compétences requises de la zone sont-elles présentes parmi un ensemble d'agents ?
function skillsSatisfied(requiredSkills, agents) {
  return (requiredSkills || []).every((sk) => agents.some((a) => (a.skills || []).includes(sk)));
}
export function skillsCovered(state, zoneId, excludeId = null) {
  const z = zoneById(state, zoneId);
  const present = availableInZone(state, zoneId).filter((a) => a.id !== excludeId);
  return skillsSatisfied(z?.required_skills, present);
}

// Un agent est-il "safe to pull" ? (réserviste OU surplus qui laisse la zone couverte)
export function safeToPull(state, agent) {
  if (!agent || agent.status !== 'available') return false;
  if (agent.is_reserve) return true;
  const z = agent.current_zone;
  if (surplus(state, z) <= 0) return false;
  return skillsCovered(state, z, agent.id); // les skills restent couverts après son départ
}

// ---------------------------------------------------------------------------
// Candidats
// ---------------------------------------------------------------------------
function annotate(state, agent, refZone, extra = {}) {
  return {
    id: agent.id,
    name: agent.name,
    skills: agent.skills,
    current_zone: agent.current_zone,
    travel_time_s: travelTime(state, agent.current_zone, refZone),
    is_reserve: agent.is_reserve,
    ...extra,
  };
}

// Pool PRIMARY : available + qualifié, trié par temps de trajet (le plus proche d'abord).
// On NE filtre PAS "safe to pull" ici : une urgence part au plus proche, le trou est backfillé.
export function candidatesPrimary(state, incidentZoneId, skillsNeeded) {
  const z = zoneById(state, incidentZoneId);
  const relevant =
    skillsNeeded && skillsNeeded.length
      ? skillsNeeded
      : z?.required_skills?.length
      ? z.required_skills
      : EMERGENCY_SKILLS;
  return state.agents
    .filter((a) => a.status === 'available')
    .filter((a) => (a.skills || []).some((sk) => relevant.includes(sk)))
    .map((a) => annotate(state, a, incidentZoneId, { safe: safeToPull(state, a) }))
    .sort((x, y) => (x.travel_time_s ?? 1e9) - (y.travel_time_s ?? 1e9) || x.id.localeCompare(y.id));
}

// Pool BACKFILL pour une zone : safe-to-pull, restaure les required_skills, trié par trajet.
export function candidatesBackfill(state, targetZoneId, excludeIds = []) {
  const z = zoneById(state, targetZoneId);
  const need = z?.required_skills || [];
  return state.agents
    .filter((a) => a.status === 'available' && !excludeIds.includes(a.id))
    .filter((a) => a.current_zone !== targetZoneId) // déjà sur zone = inutile
    .filter((a) => safeToPull(state, a))
    .filter((a) => need.length === 0 || (a.skills || []).some((sk) => need.includes(sk)))
    .map((a) => annotate(state, a, targetZoneId, { safe: true }))
    .sort((x, y) => (x.travel_time_s ?? 1e9) - (y.travel_time_s ?? 1e9) || x.id.localeCompare(y.id));
}

// ---------------------------------------------------------------------------
// Snapshot (Contrat B) — passé tel quel au LLM.
// ---------------------------------------------------------------------------
export function buildSnapshot(state, incidentZoneId, { transcript = '', lang = 'fr' } = {}) {
  const z = zoneById(state, incidentZoneId);
  const skillsHint = z?.required_skills?.length ? z.required_skills : [];
  const cPrimary = candidatesPrimary(state, incidentZoneId, skillsHint);

  // Zones à risque = zones-source des candidats primaires qui sont au minimum (donc un trou si on les tire).
  const backfillByZone = {};
  for (const c of cPrimary) {
    const src = c.current_zone;
    if (backfillByZone[src]) continue;
    const zsrc = zoneById(state, src);
    if (!zsrc || zsrc.required_min === 0) continue;
    // tirer ce candidat laisserait-il un trou ? (min non tenu OU skill découvert)
    const wouldHole = headcount(state, src) - 1 < zsrc.required_min || !skillsCovered(state, src, c.id);
    if (wouldHole) backfillByZone[src] = candidatesBackfill(state, src, [c.id]);
  }

  return {
    incident: { transcript, lang, zone_id: incidentZoneId },
    zones: state.zones.map((zz) => ({
      id: zz.id,
      name: zz.name,
      headcount: headcount(state, zz.id),
      required_min: zz.required_min,
      surplus: surplus(state, zz.id),
      required_skills: zz.required_skills,
    })),
    constraints: (state.constraints || []).map((c) => ({ scope: c.scope, rule_text: c.rule_text })),
    candidates_primary: cPrimary,
    candidates_backfill_by_zone: backfillByZone,
  };
}

// ---------------------------------------------------------------------------
// Simulation : clone léger de l'état (seuls les agents mutent) + inbound backfillers.
// ---------------------------------------------------------------------------
function makeSim(state) {
  return {
    zones: state.zones,
    travel: state.travel,
    constraints: state.constraints,
    agents: state.agents.map((a) => ({ ...a })),
    inbound: {}, // zoneId -> [agent] backfillers en route (comptent pour la couverture future)
  };
}
function inboundAgents(sim, zoneId) {
  return sim.inbound[zoneId] || [];
}
// Zone couverte en tenant compte des backfillers entrants ?
function zoneCovered(sim, zoneId) {
  const z = zoneById(sim, zoneId);
  if (!z || z.required_min === 0) return true;
  const here = availableInZone(sim, zoneId);
  const coming = inboundAgents(sim, zoneId);
  const effective = here.length + coming.length;
  if (effective < z.required_min) return false;
  return skillsSatisfied(z.required_skills, [...here, ...coming]);
}

function coverageWarning(sim, zoneId) {
  const z = zoneById(sim, zoneId);
  // etaSec = trajet du plus proche agent qualifié (même non-safe), proxy "dans combien de temps on pourrait couvrir".
  const need = z?.required_skills || [];
  const closest = sim.agents
    .filter((a) => a.status === 'available' && a.current_zone !== zoneId)
    .filter((a) => need.length === 0 || (a.skills || []).some((sk) => need.includes(sk)))
    .map((a) => travelTime(sim, a.current_zone, zoneId) ?? 1e9)
    .sort((x, y) => x - y)[0];
  const etaSec = Number.isFinite(closest) ? closest : 180;
  const mins = Math.max(1, Math.round(etaSec / 60));
  return {
    zoneId,
    etaSec,
    message: `${z?.name || zoneId} tombera sous le minimum ~${mins} min. Accepter / réassigner ?`,
  };
}

// ---------------------------------------------------------------------------
// Cascade backfill (2 hops max). Mute `sim`. Retourne { assignments, warnings }.
// ---------------------------------------------------------------------------
export function cascadeBackfill(sim, vacatedZoneId, depth, ctx) {
  if (zoneCovered(sim, vacatedZoneId)) return { assignments: [], warnings: [] };
  if (depth > 2) return { assignments: [], warnings: [coverageWarning(sim, vacatedZoneId)] };

  const pool = candidatesBackfill(sim, vacatedZoneId, ctx.used);
  const pick = pool[0];
  if (!pick) return { assignments: [], warnings: [coverageWarning(sim, vacatedZoneId)] };

  const agent = agentById(sim, pick.id);
  const sourceZone = agent.current_zone;
  agent.status = 'backfilling';
  ctx.used.push(agent.id);
  (sim.inbound[vacatedZoneId] ||= []).push(agent);

  const out = {
    assignments: [ctx.mkAssignment({ agent_id: agent.id, role: 'backfill', target_zone: vacatedZoneId })],
    warnings: [],
  };

  // Un réserviste ne laisse aucun trou. Un surplus reste couvert (safeToPull garanti). Cap 2 hops par sécurité.
  if (!agent.is_reserve && !zoneCovered(sim, sourceZone)) {
    const child = cascadeBackfill(sim, sourceZone, depth + 1, ctx);
    out.assignments.push(...child.assignments);
    out.warnings.push(...child.warnings);
  }
  return out;
}

// ---------------------------------------------------------------------------
// applyDecision (Contrat F) — valide la Decision LLM, répare, produit les Assignments.
// Ne mute PAS `state` : renvoie nextState (le serveur commit).
// ---------------------------------------------------------------------------
export function applyDecision(decision, state, opts = {}) {
  const incidentId = opts.incidentId || 'inc_1';
  let seq = opts.startSeq || 1;
  const mkAssignment = ({ agent_id, role, target_zone }) => ({
    id: `as_${seq++}`,
    incident_id: incidentId,
    agent_id,
    role,
    target_zone,
    status: 'sent',
    sent_at: opts.now ?? null,
  });

  const sim = makeSim(state);
  const incidentZone = decision.zone_id;
  const zoneSkills = zoneById(sim, incidentZone)?.required_skills || [];
  const skillsNeeded = decision.skills_needed?.length ? decision.skills_needed : zoneSkills;

  const assignments = [];
  const warnings = [];
  const ctx = { used: [], mkAssignment };

  // 1) PRIMARY — valide le choix LLM, sinon répare (plus proche qualifié).
  let primary = agentById(sim, decision.primary_id);
  const primaryOk =
    primary &&
    primary.status === 'available' &&
    (skillsNeeded.length === 0 || (primary.skills || []).some((sk) => skillsNeeded.includes(sk)));
  if (!primaryOk) {
    const repaired = candidatesPrimary(sim, incidentZone, skillsNeeded)[0];
    primary = repaired ? agentById(sim, repaired.id) : null;
  }
  if (!primary) {
    return {
      assignments: [],
      warnings: [{ zoneId: incidentZone, etaSec: 0, message: `Aucun répondant qualifié disponible pour ${incidentZone}.` }],
      nextState: state,
      incident: buildIncident(decision, incidentId, null, [], warnings, opts),
      repaired: true,
    };
  }
  const primaryRepaired = primary.id !== decision.primary_id;
  const primarySource = primary.current_zone;
  primary.status = 'responding';
  ctx.used.push(primary.id);
  assignments.push(mkAssignment({ agent_id: primary.id, role: 'primary', target_zone: incidentZone }));

  // 2) BACKFILLS proposés par le LLM — appliqués SEULEMENT s'ils sont safe et utiles.
  for (const bf of decision.backfills || []) {
    const a = agentById(sim, bf.agent_id);
    const target = bf.target_zone;
    if (!a || a.status !== 'available' || ctx.used.includes(a.id)) continue;
    if (!safeToPull(sim, a)) continue; // le moteur refuse tout backfill qui casserait une autre zone
    const need = zoneById(sim, target)?.required_skills || [];
    if (need.length && !(a.skills || []).some((sk) => need.includes(sk))) continue;
    if (zoneCovered(sim, target)) continue; // plus de trou -> inutile
    a.status = 'backfilling';
    ctx.used.push(a.id);
    (sim.inbound[target] ||= []).push(a);
    assignments.push(mkAssignment({ agent_id: a.id, role: 'backfill', target_zone: target }));
  }

  // 3) RÉPARATION déterministe : toute zone encore à découvert est backfillée (cascade) ou warn.
  //    On part du trou créé par le primary, puis on balaie toutes les zones min>0 par sûreté.
  const toRepair = new Set();
  if (!zoneCovered(sim, primarySource)) toRepair.add(primarySource);
  for (const z of sim.zones) if (z.required_min > 0 && !zoneCovered(sim, z.id)) toRepair.add(z.id);
  for (const zid of toRepair) {
    const r = cascadeBackfill(sim, zid, 1, ctx);
    assignments.push(...r.assignments);
    warnings.push(...r.warnings);
  }

  return {
    assignments,
    warnings,
    nextState: commit(state, sim),
    incident: buildIncident(decision, incidentId, primary.id, assignments, warnings, opts),
    repaired: primaryRepaired,
  };
}

// nextState : applique les changements de statut simulés à un nouvel état.
function commit(state, sim) {
  const byId = new Map(sim.agents.map((a) => [a.id, a]));
  return { ...state, agents: state.agents.map((a) => ({ ...a, status: byId.get(a.id)?.status ?? a.status })) };
}

function buildIncident(decision, incidentId, primaryId, assignments, warnings, opts) {
  return {
    id: incidentId,
    transcript: decision._transcript || null,
    language: decision._lang || null,
    type: decision.incident_type || null,
    zone_id: decision.zone_id,
    skills_needed: decision.skills_needed || [],
    severity: decision.severity ?? null,
    primary_id: primaryId,
    backfills: assignments.filter((a) => a.role === 'backfill').map((a) => ({ agent_id: a.agent_id, target_zone: a.target_zone })),
    warning: warnings[0]?.message || decision.warning || null,
    justification: decision.justification || null,
    status: 'open',
    created_at: opts.now ?? null,
  };
}

// ---------------------------------------------------------------------------
// Détection déterministe de zone depuis le transcript (avant l'appel LLM).
// ---------------------------------------------------------------------------
const norm = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, "");

const ZONE_ALIASES = {
  Z1: ['entree', 'entrada', 'entrance', 'porte'],
  Z2: ['grand huit', 'grand-huit', 'montana rusa', 'roller coaster'],
  Z3: ['grande roue', 'noria', 'ferris'],
  Z4: ['riviere', 'river', 'rapids', 'rapide'],
  Z5: ['place centrale', 'plaza', 'central'],
  Z6: ['zone enfants', 'enfants', 'ninos', 'kids', 'children'],
  Z7: ['food court', 'restauration', 'comida', 'food'],
  Z8: ['manege extreme', 'manege', 'extreme'],
  Z9: ['boutique', 'tienda', 'shop', 'magasin'],
  Z10: ['parking', 'aparcamiento'],
};

export function detectZone(transcript, zones) {
  const t = norm(transcript);
  let best = null;
  let bestLen = 0;
  for (const z of zones) {
    const keys = [norm(z.name), ...(ZONE_ALIASES[z.id] || [])];
    for (const k of keys) {
      if (k && t.includes(k) && k.length > bestLen) {
        best = z.id;
        bestLen = k.length;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Fallback déterministe : produit une Decision (Contrat C) SANS LLM.
// Utilisé quand Crusoe est injoignable (résilience F9). applyDecision répare le reste.
// ---------------------------------------------------------------------------
const CARDIAC_RE = /respir|cardiaq|inconscient|desplom|no respira|unconscious|cardiac|arret|arrêt/i;
export function deterministicDecide(snapshot, transcript = '') {
  const t = transcript || snapshot?.incident?.transcript || '';
  const cardiac = CARDIAC_RE.test(t);
  const zoneId = snapshot?.incident?.zone_id || null;
  const zoneSkills = (snapshot?.zones || []).find((z) => z.id === zoneId)?.required_skills || [];
  const skills = cardiac ? Array.from(new Set(['RCP', ...zoneSkills])) : zoneSkills;
  const primary = (snapshot?.candidates_primary || [])[0];
  return {
    incident_type: cardiac ? 'arret_cardiaque' : 'incident',
    zone_id: zoneId,
    skills_needed: skills,
    severity: cardiac ? 5 : 3,
    primary_id: primary?.id || null,
    backfills: [], // applyDecision cascade le backfill déterministiquement
    warning: null,
    justification: 'Dispatch déterministe : plus proche qualifié + backfill surplus-aware (couverture garantie).',
    constraints_applied: [],
    _degraded: true,
  };
}

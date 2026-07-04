// agent.js — Orchestration du pipeline d'incident (le "cerveau" assemblé).
//   audio/transcript -> STT -> detectZone -> buildSnapshot -> decide (LLM) -> applyDecision (moteur)
//   -> textes de dispatch localisés + TTS -> payloads WS `dispatch` (Contrat A).
import {
  buildSnapshot,
  applyDecision,
  detectZone,
  zoneById,
  agentById,
  candidatesNearbyNotice,
} from './engine.js';
import { decide } from './integrations/crusoe.js';
import { transcribe, speak } from './integrations/gradium.js';

// Libellés d'incident par langue (pour le TTS traduit du répondant, F7).
const LABELS = {
  arret_cardiaque: { fr: 'Arrêt cardiaque', en: 'Cardiac arrest', es: 'Paro cardíaco' },
  malaise: { fr: 'Malaise', en: 'Medical issue', es: 'Malestar' },
  incident: { fr: 'Incident', en: 'Incident', es: 'Incidente' },
};
const label = (type, lang) => LABELS[type]?.[lang] || LABELS.incident[lang] || type || 'Incident';

const TEMPLATES = {
  fr: {
    primary: (t, z) => `${t} au ${z}, tu es le plus proche. Vas-y.`,
    backfill: (z) => `Rejoins ${z} pour maintenir la couverture.`,
    witness: (t, z, primaryName) =>
      `${t} au ${z} : ${primaryName} intervient. Ce n'est pas toi — reste en place.`,
  },
  en: {
    primary: (t, z) => `${t} at ${z}, you are the closest. Go now.`,
    backfill: (z) => `Move to ${z} to keep coverage.`,
    witness: (t, z, primaryName) =>
      `${t} at ${z}: ${primaryName} is responding. Not you — stay in position.`,
  },
  es: {
    primary: (t, z) => `${t} en ${z}, eres el más cercano. Ve ahora.`,
    backfill: (z) => `Ve a ${z} para mantener la cobertura.`,
    witness: (t, z, primaryName) =>
      `${t} en ${z}: interviene ${primaryName}. No eres tú — quédate en posición.`,
  },
};

function dispatchText(assignment, incident, state) {
  const agent = agentById(state, assignment.agent_id);
  const lang = agent?.languages?.[0] || 'fr';
  const tpl = TEMPLATES[lang] || TEMPLATES.fr;
  const zoneName = zoneById(state, assignment.target_zone)?.name || assignment.target_zone;
  const incidentLabel = label(incident.type, lang);
  let text;
  if (assignment.role === 'primary') {
    text = tpl.primary(incidentLabel, zoneName);
  } else if (assignment.role === 'witness') {
    const primaryName = agentById(state, incident.primary_id)?.name || incident.primary_id;
    text = tpl.witness(incidentLabel, zoneName, primaryName);
  } else {
    text = tpl.backfill(zoneName);
  }
  return { text, lang };
}

// ttsCache : dédoublonne les synthèses d'un même texte (les witness partagent souvent le même message).
async function buildDispatchPayload(as, incident, state, ttsCache) {
  const { text, lang: rlang } = dispatchText(as, incident, state);
  const key = `${rlang}|${text}`;
  if (!ttsCache.has(key)) {
    ttsCache.set(
      key,
      speak(text, rlang, { id: as.id }).then(
        (r) => r.audioUrl,
        (e) => {
          console.warn(`[agent] TTS échec pour ${as.id} (${e.message}) -> texte seul`);
          return null;
        },
      ),
    );
  }
  const audioUrl = await ttsCache.get(key);
  return {
    assignmentId: as.id,
    incidentId: incident.id,
    role: as.role,
    targetZone: as.target_zone,
    agentId: as.agent_id,
    text,
    audioUrl,
    lang: rlang,
  };
}

// Traite un incident complet. Ne mute PAS `state` (renvoie nextState) — le serveur commit.
export async function handleIncident({ state, audio, transcript, langHint, incidentId, now }) {
  let lang = langHint || 'fr';
  if (!transcript) {
    const stt = await transcribe(audio, { lang: langHint });
    transcript = stt.text;
    lang = stt.lang || lang;
  }

  const zoneGuess = detectZone(transcript, state.zones);
  const incidentZone = zoneGuess || state.zones[0]?.id; // jamais de zone nulle (apport P4)
  const snapshot = buildSnapshot(state, incidentZone, { transcript, lang });
  const decision = await decide(snapshot, transcript);
  decision._transcript = transcript;
  decision._lang = lang;
  if (incidentZone) decision.zone_id = incidentZone; // la zone détectée prime sur le LLM

  const { assignments, warnings, nextState, incident, repaired } = applyDecision(decision, state, {
    incidentId,
    now,
  });

  // Prévenir les agents qualifiés aux alentours (pas le primary ni les backfills).
  const usedIds = assignments.map((a) => a.agent_id);
  const skills = incident.skills_needed?.length ? incident.skills_needed : decision.skills_needed || [];
  const nearby = candidatesNearbyNotice(state, incident.zone_id, skills, usedIds);
  let witnessSeq = assignments.length + 1;
  const witnessAssignments = nearby.map((agent) => ({
    id: `as_w${witnessSeq++}`,
    incident_id: incident.id,
    agent_id: agent.id,
    role: 'witness',
    target_zone: incident.zone_id,
    status: 'sent',
    sent_at: now ?? null,
  }));

  // TTS : primary + backfill uniquement en parallèle + cache. Les TÉMOINS = texte seul (pas de TTS)
  // -> tient dans la limite ~2 sessions Gradium et coupe la latence/coût (apport P4).
  const ttsCache = new Map();
  const dispatches = await Promise.all(
    [...assignments, ...witnessAssignments].map((as) => {
      if (as.role === 'witness') {
        const { text, lang: rlang } = dispatchText(as, incident, state);
        return { assignmentId: as.id, incidentId: incident.id, role: as.role, targetZone: as.target_zone, agentId: as.agent_id, text, audioUrl: null, lang: rlang };
      }
      return buildDispatchPayload(as, incident, state, ttsCache);
    }),
  );

  if (decision.nearby_notice) {
    incident.nearby_notice = decision.nearby_notice;
  }
  if (decision.transcript_analysis) {
    incident.transcript_analysis = decision.transcript_analysis;
  }

  return { incident, assignments, warnings, dispatches, nextState, decision, snapshot, repaired };
}

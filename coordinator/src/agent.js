// agent.js — Orchestration du pipeline d'incident (le "cerveau" assemblé).
//   audio/transcript -> STT -> detectZone -> buildSnapshot -> decide (LLM) -> applyDecision (moteur)
//   -> textes de dispatch localisés + TTS -> payloads WS `dispatch` (Contrat A).
import { buildSnapshot, applyDecision, detectZone, zoneById, agentById } from './engine.js';
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
  },
  en: {
    primary: (t, z) => `${t} at ${z}, you are the closest. Go now.`,
    backfill: (z) => `Move to ${z} to keep coverage.`,
  },
  es: {
    primary: (t, z) => `${t} en ${z}, eres el más cercano. Ve ahora.`,
    backfill: (z) => `Ve a ${z} para mantener la cobertura.`,
  },
};

function dispatchText(assignment, incident, state) {
  const agent = agentById(state, assignment.agent_id);
  const lang = agent?.languages?.[0] || 'fr'; // le répondant reçoit dans SA langue
  const tpl = TEMPLATES[lang] || TEMPLATES.fr;
  const zoneName = zoneById(state, assignment.target_zone)?.name || assignment.target_zone;
  const text =
    assignment.role === 'primary'
      ? tpl.primary(label(incident.type, lang), zoneName)
      : tpl.backfill(zoneName);
  return { text, lang };
}

// Traite un incident complet. Ne mute PAS `state` (renvoie nextState) — le serveur commit.
export async function handleIncident({ state, audio, transcript, langHint, incidentId, now }) {
  // 1) STT (si audio) sinon transcript direct.
  let lang = langHint || 'fr';
  if (!transcript) {
    const stt = await transcribe(audio, { lang: langHint });
    transcript = stt.text;
    lang = stt.lang || lang;
  }

  // 2) Zone déterministe depuis le transcript.
  const zoneGuess = detectZone(transcript, state.zones);

  // 3) Snapshot (Contrat B).
  const snapshot = buildSnapshot(state, zoneGuess, { transcript, lang });

  // 4) Décision (LLM Crusoe, ou mock, ou fallback déterministe — ne throw jamais).
  const decision = await decide(snapshot, transcript);
  decision._transcript = transcript;
  decision._lang = lang;
  if (!decision.zone_id) decision.zone_id = zoneGuess;

  // 5) Validation + assignments déterministes (garantit la couverture).
  const { assignments, warnings, nextState, incident, repaired } = applyDecision(decision, state, {
    incidentId,
    now,
  });

  // 6) Textes localisés + TTS -> payloads WS `dispatch`.
  const dispatches = [];
  for (const as of assignments) {
    const { text, lang: rlang } = dispatchText(as, incident, state);
    let audioUrl = null;
    try {
      audioUrl = (await speak(text, rlang, { id: as.id })).audioUrl;
    } catch (e) {
      console.warn(`[agent] TTS échec pour ${as.id} (${e.message}) -> texte seul`);
    }
    dispatches.push({
      assignmentId: as.id,
      incidentId: incident.id,
      role: as.role,
      targetZone: as.target_zone,
      agentId: as.agent_id,
      text,
      audioUrl,
      lang: rlang,
    });
  }

  return { incident, assignments, warnings, dispatches, nextState, decision, snapshot, repaired };
}

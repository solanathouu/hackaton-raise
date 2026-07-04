# CONDUCTOR — Les 6 contrats gelés 🔒

> **Source de vérité unique des interfaces.** Ne pas changer sans prévenir toute l'équipe (ping `#conductor` + bump la version).
> `USE_MOCKS=true` : chaque brique consomme les fixtures de `data/mock-fixtures.json` → personne n'attend personne.

**Version : v1 (gelée au kickoff H+0).**

Types partagés (rappel `conductor-PRD.md` §9) :

```
Agent  { id, name, skills[], languages[], current_zone, home_zone|null, is_reserve, status }
Zone   { id, name, required_min, required_skills[], adjacency:[{z, t}] }   // t = temps de trajet (s)
        // calculés live : headcount, surplus
```
`status ∈ "available" | "responding" | "backfilling" | "break" | "offline"`
`skills ∈ RCP | DAE | secu | medic | first-aid` · `languages ∈ fr | en | es`
Seuls les agents `status:"available"` comptent dans `headcount`.

---

## Contrat A — WS events (app ⇄ coordinateur)

**client → serveur**
```
hello             { agentId: "A1" }
position          { agentId: "A1", zoneId: "Z2" }
incident_audio    { agentId: "A2", audio: "<base64>", ts: 1720000000 }   // audio = webm/opus base64 (MediaRecorder)
ack               { assignmentId: "as_1" }
operator_override { incidentId: "inc_1", newAgentId: "A4", reason: "A1 en pause" }
```

**serveur → client**
```
state             { agents: [...], zones: [...] }        // snapshot d'état complet (zones incluent headcount+surplus calculés)
dispatch          { assignmentId, incidentId, role:"primary"|"backfill", targetZone,
                    text, audioUrl, lang }
coverage_warning  { zoneId, etaSec, message }
```
- `dispatch` est émis UNIQUEMENT à l'agent concerné (room `agent:<id>`). `state` et `coverage_warning` sont broadcastés à tous (opérateur + agents).
- `audioUrl` peut être `null` (l'app lit alors `text` en synthèse locale / affichage). En mock : `/mock/tts-sample.mp3`.

## Contrat B — Snapshot JSON (moteur → LLM)
Produit par `buildSnapshot(state, incidentZoneId)`. Passé tel quel à `decide()`. Exemple concret : `data/mock-fixtures.json > snapshot`.
```
{
  incident: { transcript, lang, zone_id },
  zones: [{ id, name, headcount, required_min, surplus, required_skills }],   // toutes les zones
  constraints: [{ scope, rule_text }],
  candidates_primary: [{ id, name, skills, current_zone, travel_time_s, is_reserve, safe }],   // trié par trajet
  candidates_backfill_by_zone: { "<zoneId>": [{ id, name, skills, current_zone, travel_time_s, is_reserve, safe }] }
}
```

## Contrat C — Decision JSON (LLM → moteur)
Retourné par `decide()`. Consommé/**validé** par `applyDecision()`. Exemple : `data/mock-fixtures.json > decision`.
```
{
  incident_type: string,
  zone_id: string,
  skills_needed: string[],
  severity: 1..5,
  primary_id: string,
  backfills: [{ agent_id, target_zone }],   // 0 à 2
  warning: string | null,
  justification: string,                     // 1 phrase, langage clair
  constraints_applied: string[]
}
```
> Le moteur RE-VALIDE toujours : une décision LLM qui ferait passer une zone sous `required_min` est corrigée déterministiquement. Le LLM ne peut jamais violer le minimum.

## Contrat D — Interface voix (Gradium) — `coordinator/src/integrations/gradium.js`
```
transcribe(audioBlob: Buffer|base64) -> Promise<{ text: string, lang: "fr"|"en"|"es" }>
speak(text: string, lang: string)    -> Promise<{ audioUrl: string }>
```

## Contrat E — Interface cerveau (Crusoe) — `coordinator/src/integrations/crusoe.js`
```
decide(snapshot: Snapshot, transcript: string) -> Promise<Decision>   // Decision = Contrat C
```

## Contrat F — Fonctions moteur (déterministe) — `coordinator/src/engine.js`
```
buildSnapshot(state, incidentZoneId) -> Snapshot                 // headcount/surplus + pools candidats
applyDecision(decision, state)       -> { assignments: Assignment[], warnings: CoverageWarning[], nextState }
cascadeBackfill(state, vacatedZoneId, depth) -> { assignments, warnings }   // 2 hops max
```
```
Assignment      { id, incident_id, agent_id, role:"primary"|"backfill", target_zone,
                  status:"sent"|"ack"|"timeout"|"rerouted"|"done", sent_at }
CoverageWarning { zoneId, etaSec, message }
```

---

### Règles d'or (invariants)
1. **Jamais** une zone sous `required_min` sans `coverage_warning`.
2. Ordre de ponction : **réservistes** (gratuit) → **zones en surplus** → (forcé, avec warning) zone au minimum.
3. Cascade **2 hops max**, sinon `coverage_warning` à l'opérateur.
4. Boucle d'accusé : dispatch non acquitté en **15 s** → re-route au candidat suivant, l'incident n'est jamais perdu.
5. Clés API (Crusoe/Gradium) : **serveur uniquement**, jamais côté client.

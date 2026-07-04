# Prompt Rork — CONDUCTOR Console Opérateur (P5)

> **Rôle : P5 uniquement.** Ne pas implémenter l'app staff terrain (P4), Gradium (P3), le serveur WS (P2), ni le moteur (Lead).
> Copier-coller le bloc ci-dessous dans Rork tel quel.

---

## Prompt (copier à partir d'ici)

```
# Prompt Rork — CONDUCTOR Console Opérateur (P5)

## Mission
Construire la **console opérateur** web (React, une page ou panneau dédié) qui se connecte au coordinateur CONDUCTOR existant via **WebSocket Socket.io uniquement**. Client pur : aucune logique de matching, backfill, couverture ou appel Crusoe/Gradium.

Backend déjà codé — ne pas dupliquer :
- `coordinator/src/engine.js` (moteur)
- `coordinator/src/integrations/crusoe.js` (Crusoe)
- `coordinator/src/integrations/gradium.js` (voix)
- `coordinator/src/server.js` (hub WS)

Connexion : `io(<COORDINATOR_URL>)` — ex. `https://<IP-LAN>:3000`

## Périmètre P5 (strict)
- Feed temps réel des incidents et alertes
- Accept / override opérateur
- Badge mode LLM (Crusoe vs dégradé)
- Boutons démo S1–S4 (replay scénarios)
- **Ne pas** : PTT agent, carte Leaflet, onboarding CSV, boussole GPS, app staff terrain

---

## Schémas (CONTRACTS.md v1 + extensions serveur actuelles)

### Incident (event `incident`, broadcast)
{
  "id": "inc_1",
  "transcript": "…",
  "language": "fr",
  "type": "arret_cardiaque",
  "zone_id": "Z8",
  "skills_needed": ["RCP"],
  "severity": 5,
  "primary_id": "A7",
  "backfills": [{ "agent_id": "A1", "target_zone": "Z8" }],
  "warning": null,
  "justification": "…",
  "constraints_applied": [],
  "source": "crusoe",
  "model": "deepseek-ai/Deepseek-V4-Flash",
  "degraded": false,
  "status": "open",
  "created_at": 1720000000000
}

### CoverageWarning (event `coverage_warning`)
{ "zoneId": "Z6", "etaSec": 180, "message": "…" }

### Dispatch log (event `dispatch_log`, broadcast)
{
  "assignmentId": "as_1",
  "incidentId": "inc_1",
  "role": "primary" | "backfill",
  "targetZone": "Z8",
  "text": "…",
  "audioUrl": "/mock/tts-sample.mp3" | null,
  "lang": "fr",
  "agentId": "A7"
}

### State snapshot (event `state`)
{
  "agents": [{ "id", "name", "skills", "languages", "current_zone", "is_reserve", "status" }],
  "zones": [{ "id", "name", "required_min", "required_skills", "adjacency", "headcount", "surplus" }]
}

### Agent.status
"available" | "responding" | "backfilling" | "break" | "offline"

### Agent.skills
"RCP" | "DAE" | "secu" | "medic" | "first-aid"

---

## WebSocket — events opérateur

### Écouter (serveur → client)
| Event | Usage |
|-------|-------|
| `state` | Couverture zones (headcount/surplus) |
| `incident` | Nouvel incident + justification + source LLM |
| `coverage_warning` | Alerte couverture proactive |
| `dispatch_log` | Tous les dispatchs émis |
| `ack_log` | `{ assignmentId, agentId }` |
| `override_log` | `{ incidentId, newAgentId, reason }` |

### Émettre (client → serveur)
| Event | Payload |
|-------|---------|
| `operator_override` | `{ incidentId, newAgentId, reason }` |
| `sim_incident` | `{ transcript, lang }` — boutons démo S1–S4 |
| `reset` | `{}` — recharge le seed |

**Ne pas implémenter côté opérateur** : `hello`, `incident_audio`, `ack`, `position`, `gps_position` (réservés app staff P4 / backend P2).

---

## UI console opérateur

### Zone 1 — Badge statut LLM
- `incident.degraded === true` ou `source` starts with `fallback` → badge amber « MODE DÉGRADÉ »
- `source` starts with `crusoe` → badge vert « Crusoe » + modèle (`incident.model`)

### Zone 2 — Feed chronologique
Items prepend (plus récent en haut) :
- **Incident** : type, zone_id, severity, primary_id, justification
- **Dispatch** : role, agentId, targetZone, text
- **Warning** : message coverage_warning
- **Ack** : « A7 a accusé as_1 »
- **Override** : reason + newAgentId

### Zone 3 — Panneau couverture (depuis `state.zones`)
Grille zones : name, headcount/required_min, surplus
- `surplus > 0` → vert
- `surplus === 0` → orange
- `headcount < required_min` → rouge

### Zone 4 — Actions
- **Accept** sur `coverage_warning` : pour la démo, log local « accepté » (pas d'event WS `operator_accept` aujourd'hui — coordonner P2 si besoin)
- **Override** : modal reason + choix agent (liste `state.agents` status available) → emit `operator_override`
- **Reset** : emit `reset`

### Zone 5 — Boutons démo S1–S4 (PRD §11)
| Bouton | transcript | lang |
|--------|------------|------|
| S1 · surplus Z2 | `malaise au grand huit, une personne au sol` | fr |
| S2 · cascade Z8 | `arrêt cardiaque au manège extrême, il ne respire plus` | fr |
| S3 · warning | `malaise à la zone enfants, personne inconsciente` | fr |
| S4 · réserviste ES | `un hombre se desplomó en la entrada, no respira` | es |

### Zone 6 — Override F8 (démo contrainte apprise)
Bouton « Protège Marco » →
`operator_override { incidentId: lastIncidentId, newAgentId: "A2", reason: "protège Marco" }`
(puis relancer S2 : le moteur ne ponctionnera plus Marco)

---

## Écarts backend (signaler à P2, ne pas coder côté P5)
- Pas d'event `operator_accept` pour coverage_warning
- Pas de `guidance`, `gps_position`, onboarding roster
- Historique : agrégation locale des events WS (pas de REST dédié)

---

## Contraintes
- Zero logique matching/backfill
- Zero appel Crusoe/Gradium direct (clés serveur)
- Socket.io uniquement (pas inventer REST métier)
- Thème sombre, lisible, feed dense type NOC

## Critères d'acceptation P5
- [ ] Feed reçoit incident + dispatch_log + coverage_warning en live
- [ ] Badge Crusoe / dégradé selon incident.source
- [ ] Override émet operator_override et affiche override_log
- [ ] Boutons S1–S4 déclenchent sim_incident
- [ ] Grille zones reflète state.headcount/surplus
- [ ] Reset fonctionne
```

---

## Répartition équipe (rappel)


| Rôle     | Scope                                              |
| -------- | -------------------------------------------------- |
| **P5**   | Ce prompt — console opérateur, prompt Crusoe, démo |
| **P4**   | App staff PWA (PTT, carte, dispatch agent)         |
| **P3**   | Gradium STT/TTS                                    |
| **P2**   | server.js, WS, HTTPS, persistance                  |
| **Lead** | engine.js, fallback déterministe                   |


## Référence implémentation minimale existante

Une version harnais existe déjà dans `app/public/index.html` (feed + démo + override F8). Rork peut s'en inspirer visuellement mais produire une console opérateur dédiée et plus complète.
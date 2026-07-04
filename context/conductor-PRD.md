# CONDUCTOR - PRD (Product Requirements Document)

> Agent de dispatch d'urgence pour environnements physiques (parcs, festivals, stades).
> Hackathon RAISE Summit 2026, track Crusoe. Document de build, source de vérité unique.
> Complète le brief narratif `~/Desktop/conductor-dispatch-brief.md`. Ce PRD est la spec technique.

**Statut :** archi verrouillée, prêt à builder. Nom à confirmer (Conductor / Relay / Nerve).

---

## 1. Vision et problème

Les équipes de terrain utilisent des talkies-walkies : un incident crié ("malaise au grand huit") est entendu par TOUT LE MONDE. Conséquences : sur-mobilisation (la moitié des gens qui bougent ne sont pas qualifiés), postes vidés, incidents de second ordre en cascade, et zéro boucle fermée (personne ne sait qui y va vraiment).

CONDUCTOR remplace la diffusion par la précision : un agent écoute la voix libre, comprend l'incident, envoie exactement la bonne personne (proche + qualifiée + disponible), et re-couvre automatiquement le poste laissé vacant sans jamais vider une zone. L'opérateur override en un tap, l'agent apprend.

**One-liner :** "Le contrôle aérien des secours humains."

---

## 2. Objectifs et métriques de succès

**Hackathon :**
- La démo LIVE de 5 min marche de bout en bout (Demo = 50% de la note).
- Montrer les 3 capacités qu'un talkie ne peut pas avoir : dispatch ciblé, backfill de couverture proactif, boucle d'accusé.
- Impact chiffré au pitch : survie arrêt cardiaque -10%/min sans RCP, donc 90s plus vite = ~15% de survie en plus ; 0 poste laissé aveugle.

**Produit (au-delà) :** réduire le temps de réponse et éliminer les trous de couverture sur tout site à personnel mobile (parcs, festivals, stades, campus, logistique).

---

## 3. Utilisateurs / personas

- **L'opérateur (utilisateur principal)** : chef de sécurité / PC de site, non-technique. Reçoit les advisories, override en un tap, tape des consignes en langage naturel.
- **L'agent de terrain** : porte l'app (toujours ouverte pendant le shift). Signale un incident en voix, reçoit des dispatchs ciblés vocaux, acquitte.
- **Le signaleur** : n'importe quel agent qui constate un incident et le déclare en parlant.

---

## 4. Scope

**Dans le MVP 15h (à builder) :**
- Signalement vocal -> compréhension (STT + LLM) -> incident structuré.
- Dispatch ciblé au meilleur répondant (skill + proximité + surplus).
- Backfill de couverture surplus-aware, cascade 2 hops max.
- Alerte proactive de trou de couverture non résolu.
- Boucle d'accusé + re-route auto sur timeout.
- Alerte vocale traduite (multilingue) au répondant.
- Override opérateur qui devient une contrainte apprise.
- Résilience : réseau local + fallback déterministe.

**Hors scope (roadmap, à dire au pitch, pas à builder) :**
- Auth complète / signup (démo = roster pré-chargé).
- Routage via DAE le plus proche, conscience fatigue/shift, dispatch silencieux sécurité, log conformité, mesh/LoRa "zéro barre", app native Expo store-grade.

---

## 5. Concept et boucle de l'agent

```
Voix (push-to-talk)
 -> STT (Gradium ; Whisper local en secours)
 -> LLM Crusoe : parse incident {type, zone, skills, severite} + applique contraintes NL
 -> Moteur déterministe : candidats (skill + surplus + temps de trajet), backfill, cascade
 -> Dispatch : alerte vocale ciblée (TTS Gradium traduit) + push WebSocket
 -> Accusé (sinon re-route) ; alerte proactive si trou non résolu
 -> Apprentissage : l'override opérateur devient une contrainte ré-injectée
```

Reframe : le talkie est l'entrée ; le produit est l'intelligence qui garde le modèle vivant de qui-peut-quoi-où et agit avant le problème de second ordre. **Le backfill est le héros, pas le dispatch.**

---

## 6. Exigences fonctionnelles

**F1. Signalement vocal.** L'agent maintient un bouton PTT, parle, l'audio part au coordinateur.
- Critère : audio capté (MediaRecorder), envoyé au coordinateur, transcrit avec la langue détectée.

**F2. Compréhension de l'incident.** Le LLM extrait `{type, zone, skills_needed, severity}` depuis la voix libre multilingue.
- Critère : une phrase du type "il est par terre au grand huit, il respire plus" produit `{type: arret_cardiaque, zone: Z2, skills_needed:[RCP], severity:5}`.

**F3. Dispatch ciblé.** Sélection du meilleur répondant (skill requis + safe-to-pull + temps de trajet mini). UNE personne, pas un broadcast.
- Critère : un seul agent est appelé, il a le skill, sa ponction ne casse pas sa zone.

**F4. Backfill surplus-aware + cascade 2 hops.** Si le départ crée un trou, re-couvrir en tirant d'abord des réservistes, puis des zones en surplus, jamais sous le minimum. Max 2 hops.
- Critère : pull d'un agent d'une zone à 3 (min 2) -> zéro cascade (surplus). Pull d'un agent d'une zone au minimum -> backfill déclenché.

**F5. Alerte proactive de trou.** Si aucun backfill propre n'existe, prévenir l'opérateur.
- Critère : message "zone X tombera sous le minimum ~T min, accepter / réassigner ?".

**F6. Boucle d'accusé + re-route.** Chaque appel attend un accusé ; sans réponse en 15s, re-route au candidat suivant.
- Critère : un dispatch non acquitté est réattribué automatiquement, l'incident n'est jamais perdu.

**F7. Alerte vocale traduite.** L'alerte est parlée (TTS) au répondant dans sa langue.
- Critère : incident signalé en espagnol -> alerte parlée à un répondant francophone en français.

**F8. Override qui apprend.** L'opérateur corrige un dispatch ; la consigne (NL) devient une contrainte ré-appliquée au conflit suivant.
- Critère : "protège les 2 médics de la scène A" -> au prochain dispatch, ces 2 ne sont pas ponctionnés sans qu'on le redise.

**F9. Résilience.** Fonctionne sur réseau local ; fallback déterministe si Crusoe injoignable ; STT local possible.
- Critère : couper Crusoe en démo -> le dispatch continue en mode dégradé, pas d'écran figé.

---

## 7. Modèle de couverture (le cœur)

```
headcount(zone) = nb d'agents "available" dont current_zone == zone
surplus(zone)   = headcount(zone) - required_min

safeToPull(agent) =
   agent.is_reserve
   OU (surplus(agent.current_zone) > 0 ET skills_requis toujours couverts après départ)
```

Ordre de ponction : **réservistes** (gratuit) -> **zones en surplus** -> (forcé) zone au minimum = crée un trou = alerte proactive.

Cascade (2 hops) : dispatch primaire (hop 0) -> backfill du trou éventuel (hop 1) -> backfill du trou éventuel du backfill (hop 2) -> stop, sinon alerte opérateur. Avec réservistes + surplus, la plupart des cascades s'arrêtent à hop 1 sans nouveau trou.

Split : **déterministe** garantit la math de couverture (surplus, trajets, pools, récursion, accusés) ; **LLM** fait le jugement (parse voix, contraintes NL, criticité d'un trou, justification). Le LLM ne peut jamais violer le minimum.

---

## 8. Architecture

```
[App staff PWA x N]  <-- WebSocket -->  [Coordinateur (Node)]  -->  [Gradium API]  (STT/TTS/traduction)
 (téléphones, réseau local)              - état vivant :          -->  [Crusoe Inference]  (cerveau LLM)
 - profil (skills, langue)                 agents, zones,          -->  [Whisper local]  (STT fallback)
 - push-to-talk                            headcount, surplus
 - reçoit alertes vocales                - pipeline agent
 - bouton "je m'en occupe"               - moteur cascade
 - envoie zone/position                  - fallback déterministe
```

Le coordinateur est le seul à détenir les clés API et l'état. Toutes les positions, dispatchs et accusés transitent par WebSocket.

---

## 9. Modèle de données

```
Agent {
  id, name, skills[], languages[],
  current_zone, home_zone (null si réserviste),
  is_reserve: boolean,
  status: "available"|"responding"|"backfilling"|"break"|"offline"
}
Zone {
  id, name, required_min, required_skills[],
  adjacency: [{ zone_id, travel_time_s }]
  // calculés live : headcount, surplus
}
Incident {
  id, transcript, language, type, zone_id, skills_needed[], severity,
  primary_id, backfills:[{agent_id, target_zone}], warning, status, created_at
}
Assignment {  // un appel avec sa boucle d'accusé
  id, incident_id, agent_id, role:"primary"|"backfill", target_zone,
  status:"sent"|"ack"|"timeout"|"rerouted"|"done", sent_at
}
Constraint { id, scope:"agent"|"zone"|"global", rule_text, source_override, created_at }
```

---

## 10. Dataset de démo (10 zones + 16 agents dont 2 réservistes)

**Zones** (parc d'attractions) :
```json
[
 {"id":"Z1","name":"Entrée","required_min":1,"required_skills":[],"adjacency":[{"z":"Z5","t":60},{"z":"Z10","t":70}]},
 {"id":"Z2","name":"Grand Huit","required_min":2,"required_skills":["RCP"],"adjacency":[{"z":"Z5","t":90},{"z":"Z8","t":60}]},
 {"id":"Z3","name":"Grande Roue","required_min":1,"required_skills":[],"adjacency":[{"z":"Z5","t":75},{"z":"Z4","t":85}]},
 {"id":"Z4","name":"Rivière Sauvage","required_min":1,"required_skills":["RCP"],"adjacency":[{"z":"Z3","t":85},{"z":"Z8","t":70}]},
 {"id":"Z5","name":"Place Centrale","required_min":2,"required_skills":[],"adjacency":[{"z":"Z1","t":60},{"z":"Z2","t":90},{"z":"Z3","t":75},{"z":"Z6","t":80},{"z":"Z7","t":50},{"z":"Z9","t":55}]},
 {"id":"Z6","name":"Zone Enfants","required_min":2,"required_skills":[],"adjacency":[{"z":"Z5","t":80},{"z":"Z7","t":65}]},
 {"id":"Z7","name":"Food Court","required_min":1,"required_skills":[],"adjacency":[{"z":"Z5","t":50},{"z":"Z6","t":65},{"z":"Z9","t":40}]},
 {"id":"Z8","name":"Manège Extrême","required_min":2,"required_skills":["RCP"],"adjacency":[{"z":"Z2","t":60},{"z":"Z4","t":70}]},
 {"id":"Z9","name":"Boutiques","required_min":0,"required_skills":[],"adjacency":[{"z":"Z5","t":55},{"z":"Z7","t":40}]},
 {"id":"Z10","name":"Parking","required_min":0,"required_skills":[],"adjacency":[{"z":"Z1","t":70}]}
]
```

**Roster** (skills : RCP, DAE, secu, medic, first-aid ; langues : fr, en, es) :
```json
[
 {"id":"A1","name":"Marco","skills":["RCP","DAE"],"languages":["fr","en"],"current_zone":"Z2","home_zone":"Z2","is_reserve":false,"status":"available"},
 {"id":"A2","name":"Ana","skills":["RCP"],"languages":["fr","es"],"current_zone":"Z2","home_zone":"Z2","is_reserve":false,"status":"available"},
 {"id":"A3","name":"Karim","skills":["secu"],"languages":["fr"],"current_zone":"Z2","home_zone":"Z2","is_reserve":false,"status":"available"},
 {"id":"A4","name":"Léa","skills":["RCP","medic"],"languages":["fr","en"],"current_zone":"Z5","home_zone":"Z5","is_reserve":false,"status":"available"},
 {"id":"A5","name":"Tom","skills":["DAE","first-aid"],"languages":["fr"],"current_zone":"Z5","home_zone":"Z5","is_reserve":false,"status":"available"},
 {"id":"A6","name":"Sofia","skills":["secu"],"languages":["fr","es"],"current_zone":"Z5","home_zone":"Z5","is_reserve":false,"status":"available"},
 {"id":"A7","name":"Hugo","skills":["RCP"],"languages":["fr"],"current_zone":"Z8","home_zone":"Z8","is_reserve":false,"status":"available"},
 {"id":"A8","name":"Nadia","skills":["secu"],"languages":["fr","en"],"current_zone":"Z8","home_zone":"Z8","is_reserve":false,"status":"available"},
 {"id":"A9","name":"Yanis","skills":["first-aid"],"languages":["fr"],"current_zone":"Z6","home_zone":"Z6","is_reserve":false,"status":"available"},
 {"id":"A10","name":"Emma","skills":["RCP","medic"],"languages":["fr","en"],"current_zone":"Z6","home_zone":"Z6","is_reserve":false,"status":"available"},
 {"id":"A11","name":"Louis","skills":["RCP"],"languages":["fr"],"current_zone":"Z4","home_zone":"Z4","is_reserve":false,"status":"available"},
 {"id":"A12","name":"Chloé","skills":["first-aid"],"languages":["fr"],"current_zone":"Z7","home_zone":"Z7","is_reserve":false,"status":"available"},
 {"id":"A13","name":"Sami","skills":["secu"],"languages":["fr","en"],"current_zone":"Z1","home_zone":"Z1","is_reserve":false,"status":"available"},
 {"id":"A14","name":"Inès","skills":["first-aid"],"languages":["fr"],"current_zone":"Z3","home_zone":"Z3","is_reserve":false,"status":"available"},
 {"id":"R1","name":"Paul","skills":["RCP","DAE","secu"],"languages":["fr","en"],"current_zone":"Z9","home_zone":null,"is_reserve":true,"status":"available"},
 {"id":"R2","name":"Lucia","skills":["RCP","medic"],"languages":["fr","es"],"current_zone":"Z7","home_zone":null,"is_reserve":true,"status":"available"}
]
```

**État de départ :** toutes les zones couvrent leur minimum. Surplus : Z2 (+1), Z5 (+1). Réservistes : Paul (Z9), Lucia (Z7).

---

## 11. Scénarios de démo (couvrent toutes les capacités)

- **S1 - Ponction de surplus, zéro cascade ("ne pas déplacer les 3").** Incident RCP près du Grand Huit -> l'agent tire UN RCP de Z2 (3 agents, min 2) -> Z2 reste à 2, aucun trou, aucune cascade. Montre le headcount/surplus.
- **S2 - Cascade 2 hops.** Arrêt cardiaque au Manège Extrême (Z8, au minimum) -> Hugo (RCP, sur zone) répond -> Z8 tombe sous le min -> backfill de Z8 depuis la zone adjacente en surplus Z2 (Karim) -> Z2 reste au min, plus de trou -> cascade finie. Montre la préservation de couverture.
- **S3 - Alerte proactive (pas de solution propre).** 2e incident simultané pendant que le surplus est épuisé -> aucune ponction sûre -> l'agent PRÉVIENT l'opérateur ("Zone Enfants tombera sous le minimum ~3 min, accepter / réassigner ?"). Montre le wow de prévention.
- **S4 - Réserviste + multilingue.** Report en espagnol à l'Entrée -> l'agent dispatche le réserviste Paul (ponction gratuite, zéro trou) et lui PARLE l'alerte dans sa langue. Montre réserviste + traduction Gradium.

---

## 12. Le prompt système (Crusoe)

```
Tu es le COORDINATEUR de dispatch d'un site (parc/festival). Tu ne donnes JAMAIS de
conseil médical : tu diriges des humains, c'est tout.

On te fournit un SNAPSHOT JSON :
- zones: [{id, name, headcount, required_min, surplus, required_skills, adjacency}]
- roster: [{id, name, skills, languages, current_zone, is_reserve, status}]
- constraints: [{scope, rule_text}]        # règles opérateur en langage naturel, à respecter
- candidates_primary: [...]                # pool pré-filtré "safe to pull" (par le moteur)
- candidates_backfill_by_zone: {...}       # pools de secours pré-filtrés

Et un TRANSCRIPT vocal (langue variable).

Ta tâche :
1. Extraire l'incident du transcript.
2. Choisir le PRIMARY dans candidates_primary (le plus proche qualifié), en respectant
   les constraints (langue, dispo, règles opérateur).
3. Proposer le BACKFILL si le départ crée un trou : réservistes d'abord, puis surplus.
   Ne JAMAIS faire tomber une zone sous required_min.
4. Si aucun backfill propre n'existe, le signaler dans "warning".

Réponds UNIQUEMENT en JSON strict :
{
  "incident_type": string,
  "zone_id": string,
  "skills_needed": string[],
  "severity": 1-5,
  "primary_id": string,
  "backfills": [{ "agent_id": string, "target_zone": string }],  // 0 à 2
  "warning": string | null,
  "justification": string,          // 1 phrase, langage clair
  "constraints_applied": string[]
}
```

---

## 13. Stack technique

- **App staff :** PWA (React ou vanilla + Vite). Géoloc/zone check-in, bouton PTT (MediaRecorder), lecture alerte audio, bouton "je m'en occupe". Servie par le coordinateur sur réseau local, ouverte via URL (zéro install).
- **Coordinateur :** Node.js + WebSocket (Socket.io ou ws). Détient l'état, le moteur (graphe précalculé, surplus, cascade), les boucles d'accusé, orchestre Gradium/Crusoe. Tourne sur un laptop = nœud local-first.
- **Voix :** Gradium API (STT + TTS + Live Translate), clé côté serveur. Whisper.cpp en fallback local offline.
- **Cerveau :** Crusoe Managed Inference, OpenAI-compatible (`https://api.inference.crusoecloud.com/v1/`, modèle `openai/gpt-oss-120b`, fallback `Llama-3.3-70B`). Appelé aux décisions, pas en continu. Fallback déterministe si injoignable.
- **Carte :** Leaflet + plan de parc stylisé (support, pas héros).
- **Données :** in-memory + seed JSON (section 10). SQLite optionnel pour le log.
- **PAS n8n** pour le cœur temps réel.

---

## 14. Exigences non-fonctionnelles

- **Latence :** voix -> dispatch < ~3s ressenti (STT + 1 appel LLM + moteur).
- **Résilience :** réseau local, payloads de dispatch minuscules, STT local possible, fallback déterministe. Jamais d'écran figé.
- **Fiabilité démo :** répétable 10x, seed déterministe, vidéo de secours.
- **Anti-dashboard :** la voix et la carte de décision sont les héros ; la carte est en support.

---

## 15. Script démo (5 min)

1. **Chaos :** broadcast talkie "tout le monde au grand huit !" -> convergence, postes vides.
2. **Précision :** voix in -> 1 bonne personne, alerte parlée + backfill.
3. **Intelligence (héros) :** "envoyer X laisse l'est découvert, je pré-positionne Y."
4. **Résilience :** 2e incident sur poste couvert -> géré.
5. **Flourish :** report en autre langue -> dispatché traduit ; OU pas d'accusé -> re-route.
6. **Close :** "90s plus vite = ~15% de survie, 0 poste aveugle. Le contrôle aérien des secours."

Démo réelle petite échelle : 3-4 coéquipiers = agents réels, vraie voix, vrai dispatch/backfill, sur réseau local. Répéter 5x + vidéo de secours.

---

## 16. Rôles équipe (5) + timeline 15h

- **Lead (Nathan) :** moteur agent (parse + matching + cascade surplus-aware) + intégration + cap.
- **P2 :** coordinateur backend + WebSocket + réseau local + fallback déterministe.
- **P3 :** intégration voix Gradium (STT/TTS/traduction) + Whisper fallback.
- **P4 :** app PWA staff (géoloc/zone, PTT, alerte, accusé) + carte.
- **P5 :** accès Crusoe + prompt d'agent + modèle de couverture/cascade + scénarios & gestion démo.

**Timeline :** H+0-0:45 kickoff (verrou schémas, smoke-test Crusoe + Gradium, seed dataset). H+2 gate léger (voix->texte->dispatch sur mock). H+3-7 intégration réelle. **H+7 gate : cascade end-to-end ?** sinon couper les bonus. H+7-11 wow (backfill proactif, multilingue, accusé). H+11-13:30 hardening + 5 répétitions + vidéo. H+13:30-15 pitch.

---

## 17. Risques et mitigations

| Risque | Mitigation |
|---|---|
| STT Gradium sur voix bruitée/accentuée | Tester H+0 ; Whisper local secours ; vocabulaire d'incident contraint |
| Réseau saturé (festival + démo Neon Noir) | Local-first, STT embarqué, fallback déterministe, tout en réseau local |
| Crusoe indispo/lag | Appels minuscules + pré-chauffe + fallback déterministe |
| Piège dashboard (DQ) | Voix + décision en héros, carte en support |
| Ban conseil médical | Strictement logistique, jamais de "comment faire un massage" |
| Cascade qui part en vrille | Cap 2 hops + surplus-aware + priorité réservistes |
| Overscoping | Builder F1-F6 d'abord ; F7/F8 wow ; chorégraphie/patterns en bonus |

---

## 18. Prépa Q&A

- **vs CAD/dispatch classique :** le CAD exige un dispatcher + du structuré ; nous = voix libre multilingue + backfill de couverture, sans dispatcher.
- **vs Zello/talkie :** canaux manuels, ne comprend pas l'incident, ne backfill pas, pas de boucle fermée.
- **vs PulsePoint :** volontaires publics via 911, sans coordination staff ni backfill ni voix.
- **Dashboard ?** Non, héros = voix -> décision -> action + override.
- **Conseil médical ?** Non, on dispatche des humains. Logistique.
- **Pourquoi un LLM ?** Voix libre multilingue + politique opérateur qui change en direct + raisonnement de couverture. Un `if` ne parse pas ça.
- **Et le réseau au festival ?** Local-first + STT embarqué + fallback. Ça marche quand le talkie meurt.

---

## 19. Checklist kickoff

- [ ] Nom final.
- [ ] Clé Crusoe récupérée + smoke-test (tool-calling + latence).
- [ ] Gradium testé (STT multilingue + TTS + Live Translate), coupon `RAISE-2026`.
- [ ] Repo public créé (new work only).
- [ ] Dataset (section 10) seedé.
- [ ] Langues de démo choisies (fr + es).
- [ ] Réseau local de démo préparé (hotspot laptop).
- [ ] Audit compétences des coéquipiers + réassignation.
```

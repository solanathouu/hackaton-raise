# CONDUCTOR — Contexte complet (rôle P4 : App Staff PWA)

> Hackathon RAISE Summit 2026, track Crusoe. Équipe de 5.
> Ce document rassemble tout le contexte nécessaire pour builder la partie P4 sans avoir à relire le PRD complet en cours de route.

---

## 1. Le projet en une phrase

Un agent qui remplace le talkie-walkie sur un site physique (parc, festival) : il écoute la voix libre d'un agent de terrain, comprend l'incident, envoie **une seule personne précise** (proche + qualifiée + disponible), et re-couvre automatiquement le poste laissé vacant. L'opérateur peut corriger en un tap.

**One-liner pitch :** "Le contrôle aérien des secours humains."

## 2. Le problème qu'on résout

Talkie-walkie classique = diffusion générale → sur-mobilisation (des gens non qualifiés se déplacent), zones vidées, incidents en cascade non anticipés, aucune boucle fermée (personne ne sait qui répond vraiment).

## 3. Les 5 rôles de l'équipe

| Rôle | Responsabilité | Stack |
|---|---|---|
| Lead (Nathan) | Moteur de calcul déterministe (cascade, surplus, trajets) | Node.js pur |
| P2 | Coordinateur backend, WebSocket, état vivant | Node.js + Socket.io |
| P3 | Intégration voix (STT/TTS/traduction) | Gradium API + Whisper fallback |
| **P4 (moi)** | **App staff PWA — interface mobile-first** | **React/Vite + Leaflet + socket.io-client** |
| P5 | Intégration Crusoe (LLM), prompt d'agent, scénarios démo, console opérateur | Crusoe Managed Inference (SDK OpenAI) |

## 4. Mon rôle (P4) — ce que je dois livrer

**Principe central : mon app est un client fin, elle ne décide/calcule jamais rien.** Toute l'intelligence (compréhension voix, décision de dispatch, calcul de couverture) est côté serveur. Mon app :
1. Capture la voix (bouton Push-to-Talk)
2. Affiche l'état (carte + statut des zones)
3. Affiche/joue les alertes qui arrivent (texte + audio)
4. Envoie des signaux simples (position, audio brut, accusé de réception)

**Hors de mon scope** : WebSocket serveur (P2), appels Gradium/Crusoe (P3/P5), calcul de cascade (Lead), console opérateur (P5 — à reconfirmer avec l'équipe vu le changement de rôle).

## 5. Les pages de l'app

**Page 1 — Identification agent (au lancement)**
Pas d'auth réelle (hors scope hackathon). Liste déroulante/boutons pour choisir son identité parmi le roster pré-chargé (ex: Marco, Ana, Hugo...).

**Page 2 — Écran principal (le cœur, celui montré en démo)**
Un seul écran, pas de navigation complexe :
- Carte Leaflet avec les zones et leur statut (couvert / surplus tiré / trou de couverture)
- Bouton Push-to-Talk, gros et visible, action principale
- Panneau d'alerte : texte + lecture audio auto + zone cible clairement affichée dès qu'un `dispatch` arrive
- Bouton "je m'en occupe" (accusé de réception), visible dès qu'une alerte est active

**Page 3 (optionnelle) — Statut d'envoi**
Retour visuel après PTT ("enregistrement... envoi... transcription en cours...") pour combler les ~3s de latence (STT + LLM + moteur).

## 6. Contrat A — Événements WebSocket (mon interface avec le coordinateur)

**J'émets (client → serveur) :**
```json
hello             { "agentId": "A1" }
position          { "agentId": "A1", "zoneId": "Z2" }
incident_audio    { "agentId": "A2", "audio": "<blob/base64>", "ts": 1720000000 }
ack               { "assignmentId": "as_1" }
```

**Je reçois (serveur → client) :**
```json
state             { "agents": [...], "zones": [...] }   // snapshot d'état complet
dispatch          { "assignmentId":"as_1", "incidentId":"inc_1", "role":"primary",
                    "targetZone":"Z8", "text":"Arrêt cardiaque Manège Extrême, tu es le plus proche. Vas-y.",
                    "audioUrl":"/tts/as_1.mp3", "lang":"fr" }
coverage_warning  { "zoneId":"Z8", "etaSec":240,
                    "message":"Manège Extrême tombera sous le minimum ~4 min. Accepter / réassigner ?" }
```

## 7. Mocks à utiliser en attendant le vrai coordinateur (P2)

Tant que P2 n'est pas prêt (bascule prévue à H+1:30), utiliser un **mock socket** qui émet directement :

```json
// dispatch (au primary A7 puis au backfill A1)
{ "assignmentId":"as_1","incidentId":"inc_1","role":"primary","targetZone":"Z8",
  "text":"Arrêt cardiaque au Manège Extrême, tu es le plus proche. Vas-y.",
  "audioUrl":"/mock/tts-sample.mp3","lang":"fr" }
{ "assignmentId":"as_2","incidentId":"inc_1","role":"backfill","targetZone":"Z8",
  "text":"Rejoins le Manège Extrême pour maintenir la couverture.",
  "audioUrl":"/mock/tts-sample.mp3","lang":"fr" }

// coverage_warning (scénario S3)
{ "zoneId":"Z6","etaSec":180,"message":"Zone Enfants tombera sous le minimum ~3 min. Accepter / réassigner ?" }
```

## 8. Données seed (le contexte du parc)

**Zones (`data/zones.json`)** — 10 zones (Entrée, Grand Huit, Grande Roue, Rivière Sauvage, Place Centrale, Zone Enfants, Food Court, Manège Extrême, Boutiques, Parking), chacune avec un minimum requis d'agents et des compétences requises (ex: RCP).

**Roster (`data/roster.json`)** — 14 agents fixes + 2 réservistes (Paul, Lucia), chacun avec ses compétences (RCP, DAE, secu, first-aid, medic), langues (fr/en/es), et zone actuelle.

État de départ : toutes les zones couvrent leur minimum. Surplus : Z2 (+1), Z5 (+1).

## 9. Les 4 scénarios de démo (pour savoir ce que mon UI doit gérer)

- **S1 — Ponction de surplus, zéro cascade** : incident RCP près du Grand Huit → un agent tiré de Z2 (surplus) → Z2 reste couvert, aucun trou.
- **S2 — Cascade 2 hops** : arrêt cardiaque au Manège Extrême (déjà au minimum) → Hugo répond → trou créé → backfill depuis Z2 (surplus) → couverture rétablie.
- **S3 — Alerte proactive** : aucune solution propre disponible → l'agent **prévient l'opérateur** au lieu de forcer une décision. Mon UI doit pouvoir afficher ce type de `coverage_warning`.
- **S4 — Réserviste + multilingue** : signalement en espagnol → dispatch du réserviste Paul, alerte parlée dans sa langue. Mon UI doit gérer le champ `lang` du `dispatch` et jouer l'audio correspondant.

## 10. Architecture globale (pour comprendre où je m'insère)

```
[App staff PWA x N]  <--WebSocket-->  [Coordinateur Node.js]  --> [Gradium API] (voix)
  (mon rôle, P4)                        (P2)                   --> [Crusoe Inference] (P5, cerveau LLM)
                                                                 --> [Whisper local] (secours)
```

**Flux complet :**
1. Agent appuie sur PTT dans mon app → capture audio → envoi `incident_audio` au coordinateur
2. Coordinateur transcrit via Gradium (P3)
3. Coordinateur construit un snapshot + l'envoie à Crusoe (P5) avec le texte
4. Crusoe répond en JSON structuré (qui envoyer, backfill)
5. Coordinateur **vérifie** la décision avec son moteur déterministe (jamais confiance aveugle au LLM — une zone ne doit jamais tomber sous son minimum)
6. Coordinateur envoie l'alerte (TTS Gradium) → mon app reçoit `dispatch` et l'affiche/joue
7. Destinataire tape "je m'en occupe" dans mon app → `ack` envoyé → sinon re-route auto après 15s

**Principe clé :** deux cerveaux séparés — le moteur déterministe a toujours le dernier mot sur la sécurité de couverture, le LLM ne sert qu'à comprendre le langage naturel et faire des arbitrages de jugement.

## 11. Contraintes de design

Aucune charte graphique imposée. Seule contrainte explicite : **anti-dashboard** — la carte est un support visuel, pas l'élément principal à peaufiner. Priorité à la lisibilité en conditions de démo live (contraste fort, texte gros pour le panneau d'alertes) plutôt qu'à l'esthétique poussée.

Suggestion de statuts couleur pour les zones : vert = couvert, orange = surplus tiré, rouge = trou de couverture.

## 12. Setup technique

```bash
cd app && npm create vite@latest   # React
npm i socket.io-client leaflet
```

**HTTPS local obligatoire** (sinon le micro est bloqué sur mobile) :
```bash
brew install mkcert && mkcert -install && mkcert 192.168.x.x localhost
```

`USE_MOCKS=true` par défaut tant que P2 n'est pas prêt.

## 13. Ma première tâche concrète

> Carte + zones + PTT qui enregistre, et affiche un `dispatch` mocké + joue son audio.

Utiliser le mock socket (section 7 de ce document) pour développer en autonomie, basculer sur le vrai coordinateur à H+1:30.

## 14. Timeline générale du hackathon (15h)

- H+0 à H+0:45 : kickoff commun (geler les contrats, seed dataset, clés API)
- H+2 : gate léger — voix → texte → dispatch sur mocks
- H+3 à H+7 : intégration réelle
- H+7 : gate — cascade end-to-end fonctionnelle ? sinon couper les bonus (F7/F8)
- H+7 à H+11 : capacités "wow" (backfill proactif, multilingue, accusé)
- H+11 à H+13:30 : hardening + 5 répétitions + vidéo de secours
- H+13:30 à H+15 : pitch

## 15. Prépa Q&A jury (à connaître même en tant que P4)

- **Pourquoi pas un dashboard ?** Non — voix → décision → action + override sont les héros, la carte est en support.
- **Pourquoi un LLM (Crusoe) ?** Voix libre multilingue + règles opérateur qui changent en direct + raisonnement de couverture — un simple `if` ne suffit pas à parser ça.
- **Et le réseau au festival ?** Architecture local-first + STT embarqué + fallback déterministe. Ça continue de fonctionner même si le réseau lâche.
- **Conseil médical ?** Non, le système dispatche des humains, c'est purement logistique.

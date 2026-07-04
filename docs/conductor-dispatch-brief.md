# CONDUCTOR (nom de travail) - Brief projet complet

> Agent de dispatch d'urgence pour environnements physiques (parcs, festivals, stades).
> Hackathon RAISE Summit 2026, track Crusoe. Document auto-suffisant : partageable à l'équipe et utilisable comme contexte pour un assistant IA. Rien ici ne suppose de contexte externe.

**Statut :** concept verrouille, prêt à builder. Nom à confirmer (Conductor / Relay / Nerve).

---

## 0. TL;DR

Les équipes de terrain (parcs, festivals) utilisent des talkies-walkies : quand quelqu'un crie "malaise au grand huit", TOUT LE MONDE entend, donc trop de gens se déplacent, la moitié n'est pas qualifiée, et des postes se vident, ce qui crée des incidents de second ordre en cascade.

CONDUCTOR est un coordinateur d'opérations autonome. Un agent parle en langage naturel ("j'ai un malaise, il respire plus"), l'agent comprend l'incident (type, lieu, compétence requise, urgence, dans n'importe quelle langue), envoie UNE alerte ciblée à la personne la plus proche ET qualifiée, et surtout re-couvre automatiquement le poste vacant (backfill) pour qu'aucun trou de sécurité ne s'ouvre. L'opérateur peut override en un tap, et l'agent apprend de ses corrections.

Le pitch : ce n'est pas un talkie-walkie plus malin, c'est **le contrôle aérien des secours humains.**

---

## 1. Le contexte hackathon (contraintes non négociables)

- **Track : Crusoe.** Le cerveau de l'agent DOIT tourner sur **Crusoe Managed Inference** (inference LLM gratuite fournie).
- **Notation : Demo 50% (ça marche ?), Impact 25%, Créativité 15%, Pitch 10%.** La démo qui marche prime sur tout.
- **Interdits (disqualification) :** projet où un dashboard est la feature principale ; basic RAG ; medical advice bot ; image analyzer ; etc.
- **Format :** démo LIVE de 5 min (pas de slides), vidéo d'1 min, repo public, "new work only" (tout codé pendant l'event).
- **Équipe :** 5 personnes, ~15h de build réel (Sam ~11h30 -> Dim 12h, moins repas/sommeil).
- **Cross-sponsor dispo : Gradium** = 145k crédits voix (STT / TTS / traduction / Live Translate), code `RAISE-2026` pour +100k. On l'utilise, c'est un atout.

---

## 2. Le problème (le motiver au pitch)

Talkie-walkie classique = **diffusion à tous**. Conséquences :
1. **Sur-mobilisation** : 8 personnes convergent, la moitié non qualifiée (ex : massage cardiaque).
2. **Postes vidés** : les gens quittent leur poste, créant des zones aveugles.
3. **Cascade** : si un 2e incident tombe sur un poste devenu vacant, plus de friction, plus de retard.
4. **Zéro boucle** : personne ne sait qui y est vraiment allé.

Enjeu chiffré : survie à l'arrêt cardiaque = **-10% par minute** sans RCP. Arriver 90s plus vite = ~15% de survie en plus.

---

## 3. La solution (concept)

Boucle de l'agent :
1. **Écoute** : un agent parle (push-to-talk vocal), n'importe quelle langue.
2. **Comprend** (LLM Crusoe) : extrait `{type d'incident, lieu, compétences requises, urgence}` depuis la voix libre.
3. **Cible** : sélectionne la personne la plus proche ET qualifiée ET disponible (pas un broadcast).
4. **Backfill (le cœur)** : re-couvre le poste vacant en cascade, pour préserver la couverture globale du site.
5. **Actionne** : alerte vocale ciblée (TTS Gradium) dans l'oreille du bon intervenant, traduite si besoin.
6. **Boucle fermée** : le dispatché acquitte ("je m'en occupe") ; sans accusé en 15s, re-route auto au suivant.
7. **Apprend** : l'opérateur override ("non, envoie B") -> l'agent encode la contrainte et la ré-applique au conflit suivant.

**Le reframe qui tue "talkie-walkie augmenté" :** le talkie est juste l'entrée. Le produit, c'est l'intelligence qui maintient un modèle vivant de qui-peut-quoi-où et agit avant que l'humain voie le problème de second ordre.

---

## 4. À qui ça sert et comment le vendre

**Cibles (utilisateur = l'opérateur non-technique, ex : chef de sécurité / PC de site) :**
- Parcs d'attractions (cœur de cible, la douleur est aiguë).
- Festivals et concerts (foule, réseau saturé, enjeux vitaux).
- Stades, salons, campus, grands sites logistiques.
- Extension : aéroports au sol, réponse de crise / catastrophe.

**Positionnement (du plus fort au moins fort) :**
- "Le contrôle aérien des secours humains."
- "Le système nerveux d'un lieu vivant."
- "De la diffusion à la précision."

**One-liner :** "Ce n'est pas un talkie-walkie plus malin. C'est un coordinateur d'opérations qui entend chaque incident, envoie exactement qui il faut, et garde tout le site couvert pendant qu'ils interviennent."

**Argument de vente central (le héros) :** ce n'est pas "dispatcher le plus proche" (tout le monde le fait). C'est **garantir qu'aucune zone ne devient aveugle** quand on tire des intervenants. "Pas de deuxième victime parce qu'un poste s'est éteint."

**Le platform play :** "Le parc, c'est la preuve, pas la limite." Le même moteur avale un stade, un festival, une réponse de crise.

---

## 5. Pourquoi ça colle au brief Crusoe

- **Modèle situationnel vivant depuis des flux** : positions live + statut + incidents en streaming.
- **Spatial + temporel + relationnel** ("where, when, relative to what else") : le backfill raisonne sur la couverture globale, pas sur un incident isolé.
- **Action proactive** : prévient les trous de couverture AVANT qu'ils s'ouvrent.
- **Opérateur non-technique + override in the moment + apprentissage** : coché.
- **On-brief** : "live events" est un exemple explicite de la consigne.

---

## 6. Les features wow (tiered par coût de build)

**À builder (peu cher, wow max) :**
1. **Prévention proactive des trous de couverture** (LE différenciateur) : "envoyer Marco laisse l'est sans RCP 4 min, je pré-positionne Ana."
2. **Dispatch vocal + multilingue (Gradium)** : l'agent PARLE au bon intervenant, traduit. Un talkie ne cible pas et ne traduit pas.
3. **Accusé de réception + re-route auto** ("dead-man's check") : aucun incident perdu.

**À builder si le temps le permet :**
4. **Chorégraphie multi-acteurs** : arrêt cardiaque -> RCP + porteur de DAE + médecin + pré-alerte du portail ambulance, en parallèle.
5. **Détection de patterns** : "3e malaise de chaleur place sud en 20 min -> ouvrir un point d'eau." (garder comme reco de l'agent, jamais une carte de chaleur = piège dashboard).

**À DIRE au pitch, PAS à builder (roadmap, vend gratuitement) :**
routage via le DAE le plus proche ; conscience fatigue/fin de shift ; dispatch silencieux pour la sécurité (broadcast = tu préviens le voleur) ; log d'incident auto (conformité) ; mesh / LoRa "zéro barre".

---

## 7. Architecture technique

### Le pipeline (chemin nominal)
```
Voix (push-to-talk)
  -> STT (Gradium primaire / Whisper local en secours)
  -> LLM Crusoe : parse incident {type, lieu, skills, urgence} + politique NL
  -> Moteur de matching + backfill (déterministe, LLM-assisté pour la nuance)
  -> Alerte ciblée : in-app (son+vibration+visuel) + TTS Gradium dans l'oreille
  -> Accusé de réception -> sinon re-route
  -> Log + apprentissage de l'override
```

### La couche RÉSILIENCE (critique pour les festivals : réseau saturé)
Insight clé : **les payloads de dispatch sont minuscules** (quelques octets de texte). Le gouffre de bande passante, c'est la voix. Donc :
- **STT en local / on-device** (Whisper.cpp) -> seul l'intent (~50 octets) traverse le réseau, pas l'audio. Survit à quasiment n'importe quelle congestion.
- **Local-first** : un coordinateur SUR SITE sur un réseau privé (WiFi local / LTE privé) qu'on contrôle, indépendant du cellulaire public saturé. C'est déjà le standard des comms pro d'événement.
- **Dégradation gracieuse** : Crusoe (cloud) quand connecté = raisonnement riche + multilingue ; **fallback déterministe local** (nearest-qualified + backfill algorithmique) quand coupé. Jamais de système mort.
- **Pré-chargé** : roster, compétences, carte, emplacements DAE sur les appareils -> zéro réseau pour SAVOIR.
- **Store-and-forward + accusé** pour les coupures intermittentes.
- **Roadmap (à dire)** : mesh device-to-device (Bluetooth mesh / WiFi Direct / LoRa) = "marche à zéro barre".

Compatibilité cerveau-cloud + mauvais réseau : les appels Crusoe sont minuscules (intent texte in, dispatch out) -> passent sur l'uplink dédié du site (Starlink / ligne dédiée) ; coupure totale -> fallback local.

**Bonus démo :** faire tourner tout le système sur un réseau LOCAL (hotspot laptop) rend la démo immunisée contre le WiFi saturé du venue (Neon Noir, 150 hackers).

### Réponses à tes questions techniques

**n8n ?** Utile pour GLUER des APIs vite (webhooks, appels HTTP) en low-code. MAIS mauvais pour le temps réel bidirectionnel (websockets, positions live, dispatch sub-seconde) et pour la logique d'agent + backfill + apprentissage. **Reco : ne pas mettre le cœur temps réel sur n8n.** Backend custom léger (Node/FastAPI + WebSockets). n8n optionnel seulement pour du glue non-temps-réel si un coéquipier est plus à l'aise en low-code. Vu ton profil full-stack, le custom sera plus rapide et plus robuste sur le cœur.

**Whisper ?** Oui, mais en SECOURS local. **Reco : Gradium en STT/TTS/traduction primaire** (crédits sponsor + multilingue natif + Live Translate = le wow) ET **whisper.cpp en fallback local offline** (l'histoire de résilience "marche sans réseau"). Best of both : Gradium connecté, Whisper hors-ligne.

---

## 8. Stack recommandé (concret)

- **App staff (frontend) :** PWA / web mobile (React ou vanilla). Géoloc, bouton push-to-talk, alerte in-app premier plan (son+vibration+visuel), bouton "je m'en occupe". Toujours ouverte pendant le shift (contourne le push iOS/UE cassé).
- **Coordinateur (backend) :** Node.js (ou Python FastAPI) + WebSockets. Tourne sur un laptop = le nœud local-first. Détient le modèle situationnel (positions, statut, compétences, carte de couverture).
- **STT / TTS / traduction :** Gradium (primaire) + whisper.cpp (fallback local).
- **Cerveau LLM :** Crusoe Managed Inference. OpenAI-compatible, base URL `https://api.inference.crusoecloud.com/v1/`, clé via l'Intelligence Foundry. Modèle conseillé `openai/gpt-oss-120b` (bon tool-calling), fallback `meta-llama/Llama-3.3-70B-Instruct`. Appelé aux points de décision (parse + plan), pas en continu. Fallback déterministe si injoignable.
- **Carte / UI :** Leaflet + carte de site stylisée. SUPPORT, jamais le héros.
- **Données :** in-memory ou SQLite (roster + compétences + incidents + emplacements DAE, pré-chargés).

---

## 9. Modèle de données (minimal)

```
Agent { id, nom, langues[], competences[] (ex: RCP, DAE, secu, medic),
        position{lat,lon}, statut (dispo|en_mission|pause|fin_shift), poste_assigne, charge }
Incident { id, texte_brut, type, lieu, skills_requis[], severite, timestamp,
           assigne_a, backfill_de, statut (ouvert|acquitte|resolu) }
Zone { id, nom, couverture_min_par_skill{}, agents_presents[] }
Contrainte_apprise { id, portee (agent|zone|global), regle_text, source_override, timestamp }
```

---

## 10. Script démo (5 min)

- **0:00 Le chaos (l'ancien monde) :** joue un vrai broadcast talkie "tout le monde au grand huit !" -> 8 personnes convergent, moitié non qualifiée, postes se vident. Viscéral.
- **1:00 La précision :** même incident, voix in -> UNE bonne personne, alerte PARLÉE dans son oreille, + backfill du poste.
- **2:00 L'intelligence (le héros) :** l'agent annonce "envoyer Marco laisse l'est découvert, je pré-positionne Ana." Il pense en avance.
- **3:00 La résilience :** 2e incident sur le poste couvert -> toujours géré (prouve le backfill).
- **3:45 Le flourish :** report dans une autre langue -> dispatché traduit ; OU l'intervenant n'acquitte pas -> re-route auto.
- **4:30 Impact + close :** "90s plus vite = ~15% de survie en plus, et 0 poste laissé aveugle. Le contrôle aérien des secours."

Démo réelle à petite échelle : 3-4 coéquipiers = les agents, app ouverte, vraie voix, vrai dispatch, vrai backfill, sur un réseau local. Le substrat (humains + tel + voix + alertes) est RÉEL, seule l'échelle est réduite. Répéter 5x, garder une vidéo de secours.

---

## 11. Répartition équipe (5) + timeline 15h

**Rôles :**
- **Lead (Nathan) :** logique d'agent (parse + matching + backfill) + intégration + garde le cap. Bottleneck protégé, pas de front/pitch.
- **P2 :** backend coordinateur + WebSockets + réseau local + fallback déterministe.
- **P3 :** intégration voix Gradium (STT/TTS/traduction) + Whisper fallback.
- **P4 :** app mobile staff (PWA, géoloc, push-to-talk, alerte, accusé) + carte.
- **P5 :** accès Crusoe + prompt d'agent + modèle de couverture/backfill + script démo & gestion des incidents de démo.

**Timeline :**
- H+0 -> 0:45 : kickoff. Verrou des schémas d'interface (JSON incident, message dispatch, event position). Smoke-test Crusoe (1 appel tool-calling + latence) ET Gradium STT (voix bruitée). Audit compétences des coéquipiers.
- 0:45 -> 3 : sprint parallèle sur mocks. **Gate léger H+2** : voix -> texte -> dispatch bout en bout sur données mock.
- 3 -> 7 : intégration réelle (voix réelle + positions + dispatch ciblé + backfill v1). **Gate H+7 : le backfill marche end-to-end ?** Sinon, couper la chorégraphie/patterns et sécuriser le cœur.
- 7 -> 11 : wow (dispatch vocal multilingue, accusé/re-route, trou de couverture prévenu) + apprentissage override.
- 11 -> 13:30 : hardening + 5 répétitions chronométrées + vidéo de secours + fallback déterministe testé.
- 13:30 -> 15 : pitch + buffer.

---

## 12. Prépa Q&A (questions hostiles + réponses)

- **"Pourquoi pas un CAD / dispatch classique ?"** Le CAD exige un dispatcher formé qui saisit du structuré ; nous, n'importe quel agent parle naturellement dans n'importe quelle langue, l'agent cible ET préserve la couverture par backfill, sans dispatcher.
- **"Pourquoi pas Zello / un talkie ?"** Zello route par canaux manuels statiques ; il ne comprend pas l'incident, ne cible pas par compétence+proximité, ne backfill pas, n'a pas de boucle fermée.
- **"C'est pas PulsePoint ?"** PulsePoint alerte des volontaires publics via le 911, sans coordination de staff ni backfill ni intake vocal.
- **"C'est un dashboard ?"** Non : le héros est la boucle voix -> décision -> action + l'override. La carte n'apparaît qu'en support.
- **"C'est un bot de conseil médical ?"** Non : l'agent DISPATCHE des humains, il ne donne JAMAIS de conseil médical. Logistique d'urgence, pas médecine.
- **"Et si le réseau sature au festival ?"** Local-first + STT embarqué (payloads minuscules) + fallback déterministe. Ça marche quand le talkie meurt, c'est-à-dire pile quand l'urgence arrive.
- **"Pourquoi un LLM et pas un `if` ?"** Parce que l'input est de la voix libre multilingue paniquée + une politique opérateur qui change en direct + un raisonnement de couverture en cascade. Un `if` ne parse pas ça et ne se re-configure pas sans redéploiement.

---

## 13. Prior art et différenciation (honnête)

Le domaine est prior-arté (comme tout à ce hackathon) :
- **Drishti AI-Event Guardian** (papier récent) : intake d'incident + classification + dispatch au médical le plus proche pour événements de masse. Le jumeau le plus proche.
- **PulsePoint / GoodSAM** : alerte le secouriste RCP le plus proche (volontaires publics).
- **CAD IA** : dispatch compétence+localisation+sévérité (résolu, commercialisé).
- **Zello** : talkie voix par canaux.
- **Workforce management** : backfill temps réel.

**Nos deux slivers défendables (à mettre au centre) :**
1. **Voix libre multilingue** (Gradium) : Drishti utilise bouton/chatbot/photo, nous la voix + traduction.
2. **Backfill de couverture intégré à la boucle de dispatch** : personne ne montre "le système empêche l'effondrement de second ordre."

La créativité est capée pour tout le monde ici : on gagne sur Demo + Impact + exécution + la couche "apprend d'un override en langage naturel", pas sur l'originalité. Assumer le prior art au pitch = crédibilité.

---

## 14. Risques et mitigations

| Risque | Mitigation |
|---|---|
| Fiabilité STT sur voix bruitée/accentuée | Tester Gradium dès H+0 ; Whisper local en secours ; vocabulaire d'incident contraint |
| Réseau saturé (festival ET démo Neon Noir) | Local-first, STT embarqué, fallback déterministe, tout sur réseau local en démo |
| Crusoe indispo/lag en démo | Appels minuscules + pré-chauffe + fallback déterministe ("mode dégradé") |
| Piège dashboard (DQ) | Voix + carte de décision en héros, carte en support |
| Ban conseil médical | Strictement logistique, jamais de "comment faire un massage" |
| Substrat de démo simulé | Démo réelle à petite échelle (vrais humains + voix + alertes) |
| Overscoping | Builder le trio wow (trou prévenu + voix multilingue + accusé/re-route) ; chorégraphie/patterns en bonus |

---

## 15. Décisions ouvertes (checklist kickoff)

- [ ] Nom final (Conductor / Relay / Nerve / autre).
- [ ] Récupérer + smoke-tester la clé Crusoe (tool-calling + latence).
- [ ] Récupérer + tester Gradium (STT multilingue + TTS + Live Translate), appliquer coupon `RAISE-2026`.
- [ ] Choisir la langue de démo + la 2e langue pour le flourish multilingue.
- [ ] Décider positions démo : phones réels (coarse) vs zones check-in vs stylisé. Rester honnête.
- [ ] Repo public créé, "new work only" (aucun copier-coller de code perso pré-existant).
- [ ] Auditer les compétences des 4 coéquipiers et réassigner si besoin.

---

*Ce brief est la source de vérité du projet. À mettre à jour au fil du build.*

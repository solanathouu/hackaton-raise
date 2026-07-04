# Context brief — CONDUCTOR (build session)
Session Obsidian du 2026-07-04

> Couche CONNAISSANCE du vault, pas la spec. Specs produit à lire en premier : `conductor-PRD.md` + `conductor-team-kickoff.md`. Ce brief apporte ce que le code ne révèle pas.

## Gotchas techniques (vault : apprentissages/_tech/apps-terrain-temps-reel)
- **Micro web = HTTPS obligatoire.** `getUserMedia`/`MediaRecorder` bloqués sur `http://<LAN>`. Monter mkcert / HTTPS local DÈS H+0, sinon le push-to-talk casse à H+3.
- **Web push mort sur iPhone dans l'UE** (DMA, iOS 17.4). Ne pas coder de push. L'app reste ouverte → alerte in-app premier plan (son + vibration).
- **GPS indoor ~30-50m = inutilisable.** Raisonner en ZONES (graphe + temps de trajet), pas en coordonnées. Position = zone (check-in / tap).
- **Résilience** = coordinateur local-first + STT on-device possible + fallback déterministe. Payloads de dispatch minuscules.

## Tactiques build (vault : apprentissages/_business/hackathon-mvp-playbook)
- **1 appel LLM au bon moment**, pas 5 chaînés (latence + points de panne).
- **Fallback en dur** dans la fonction IA : timeout Crusoe → résultat canné, JAMAIS d'écran figé sur scène.
- **Mock-first** (flag `USE_MOCKS`) : chaque brique livre un mock → parallélisation à 5 sans blocage.
- Construire la démo à l'envers depuis le money-shot ; répéter 5× à froid ; vidéo de secours ; zéro dépendance live (tout sur réseau local).

## Intégrations (vérifiées cette session)
- **Crusoe Managed Inference** : OpenAI-compatible, `baseURL=https://api.inference.crusoecloud.com/v1`, modèle `openai/gpt-oss-120b` (bon tool-calling), `response_format: json_object`. Appeler AUX décisions, pas en continu. Rate limits inconnus → smoke-test à H+0.
- **Gradium** : STT / TTS / Live Translate, coupon `RAISE-2026` (+100k crédits). Clés SERVEUR uniquement (jamais côté client). Tester le STT sur voix bruitée/accentuée à H+0.

## Décisions du brainstorm (le rationale que le code ne voit pas)
- **PWA** (pas Expo natif) pour multi-device instantané ; **tout via le coordinateur** (clés serveur, un seul cerveau).
- **Couverture headcount/surplus** : ne ponctionner que le surplus ou un réserviste (« 3 à une attraction → on bouge 1 »).
- **Cascade 2-hop** ; le moteur déterministe garantit la math de couverture, le LLM fait parse voix + contraintes NL + jugement (il ne viole jamais le minimum).

## Alertes
- **Anti-dashboard (risque DQ)** : la voix + la décision sont les héros ; la carte en support.
- **Ban conseil médical** : l'agent DISPATCHE des humains, il ne conseille JAMAIS un geste médical.
- Le local-first règle aussi la démo au venue (WiFi Neon Noir saturé par 150 hackers).

## Instruction
Builder CONDUCTOR : coordinateur Node temps réel (état zones/agents + moteur cascade surplus-aware) + PWA staff (PTT, carte, alertes, accusé) + pipeline voix → Crusoe → dispatch. Démarrer par la checklist kickoff (contrats gelés + seed + mocks) du kit équipe.

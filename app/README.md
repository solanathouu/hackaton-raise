# CONDUCTOR — App staff (P4)

PWA mobile-first pour les agents de terrain. Client fin : capture la voix (PTT),
affiche l'état des zones et les alertes de dispatch, envoie les accusés de
réception. Aucune décision n'est prise ici — voir `conductor-PRD.md`.

## Démarrer

```bash
npm install
npm run dev
```

Par défaut le serveur tourne en **HTTPS** (obligatoire pour le micro sur mobile).
Au premier lancement, `vite-plugin-mkcert` installe une autorité locale via
`sudo` — accepte l'invite système la première fois. Ensuite ouvre l'URL
`https://<ip-de-ton-laptop>:5173` depuis le téléphone connecté au même réseau
(hotspot laptop recommandé, cf. PRD section 19), accepte le certificat.

Si tu es dans un environnement sans `sudo` interactif (CI, sandbox), lance en
HTTP simple (le micro ne fonctionnera pas hors `localhost`) :

```bash
VITE_DISABLE_HTTPS=true npm run dev
```

## Mode mock

`VITE_USE_MOCKS=true` (par défaut, voir `.env`) fait tourner l'app contre
`src/mock/mockSocket.js`, qui rejoue à tour de rôle les 4 scénarios de démo du
PRD (section 11) à chaque appui sur le bouton PTT — utile pour développer/tester
sans attendre le vrai coordinateur (P2). Bascule sur le vrai backend avec :

```
VITE_USE_MOCKS=false
VITE_COORDINATOR_URL=https://<ip-coordinateur>:3000
```

## Structure

- `src/data/` — seed zones/roster (contrat figé, PRD section 10)
- `src/socket.js` — point d'entrée unique WS (mock ou réel, contrat A)
- `src/mock/mockSocket.js` — simulateur de coordinateur
- `src/screens/` — écran 1 (identification) et écran 2 (carte + PTT + alertes)
- `src/components/` — `ParkMap` (SVG custom), `PushToTalkButton` (MediaRecorder),
  `AlertPanel` (dispatch/coverage_warning + TTS), `SendStatusBar` (écran 3, statut d'envoi)

## Choix notables

- **Carte custom SVG plutôt que Leaflet** : le seed dataset ne fournit pas de
  vraies coordonnées GPS, juste un graphe de zones avec adjacence/temps de
  trajet. Leaflet (tuiles, projection géo) serait surdimensionné pour un plan
  de parc stylisé statique — une carte SVG légère fait le même travail avec
  moins de dépendances.
- **Couleur des zones sur la carte** : `conductor-P4-contexte.md` (§11)
  suggérait vert/orange/rouge par statut de couverture, mais
  `conductor-charte-graphique.md` (plus récent) fixe une règle stricte à deux
  couleurs fonctionnelles seulement (rouge = système, vert = action agent) et
  impose que chaque icône de zone soit rouge. J'ai suivi la charte : le
  headcount/minimum de chaque zone est affiché en texte (mono, gris atténué)
  sous l'icône plutôt que par une 3e couleur, pour rester lisible sans
  introduire d'accent supplémentaire.
- **Icône d'incident générique** : le contrat WS (`dispatch`) ne transmet pas
  `incident_type` au client, seulement zone/texte/rôle. Impossible de choisir
  entre les glyphes cœur/croix/bouclier/malaise du §5 de la charte sans cette
  donnée — un seul glyphe "alerte" est utilisé pour toute zone avec un
  dispatch actif.
- **TTS de secours en mode mock** : `audioUrl` mocké ne pointe vers aucun vrai
  fichier. `AlertPanel` tente de jouer l'`<audio>` fourni et, en cas d'échec,
  lit le texte via `speechSynthesis` du navigateur dans la langue de l'alerte
  — utile pour tester le flux vocal sans backend Gradium réel.
- **Fonts self-hosted** (`@fontsource/inter` + `@fontsource/jetbrains-mono`,
  sous-ensembles latin/latin-ext uniquement) plutôt que Google Fonts CDN, pour
  rester cohérent avec l'exigence de résilience réseau local du PRD.

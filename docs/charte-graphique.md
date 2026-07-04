# Charte graphique CONDUCTOR

> Appliquée aux 3 surfaces : app staff (`/index.html`), console opérateur (`/operator.html`),
> vue 3D (`/sim`). Une seule identité, du téléphone au grand écran.
> Contrainte structurante : **offline-first** (hotspot de démo sans internet) → system fonts,
> zéro webfont, zéro CDN, icônes = texte/formes, pas d'images externes.

## Tokens (identiques partout)

| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#0b0e13` | fond (off-black bleuté, jamais de noir pur) |
| `--panel` | `#11151c` | panneaux, cartes |
| `--panel2` | `#171c24` | boutons secondaires, éléments imbriqués |
| `--line` | `#232a35` | bordures, séparateurs |
| `--txt` | `#e8edf4` | texte principal |
| `--dim` | `#8b96a5` | texte secondaire |
| `--accent` | `#4cc2ff` | **accent UNIQUE** (bleu signal) : actions, sélection, backfill, routes |
| `--ok` | `#2ea862` | statut sémantique : couvert / connecté / accusé |
| `--warn` | `#e8b13f` | statut sémantique : alerte couverture / dégradé / en attente |
| `--bad` | `#ff5449` | statut sémantique : sous minimum / urgence / primary |
| `--mono` | `ui-monospace, SF Mono, Menlo…` | **toute donnée chiffrée** (headcounts, ETA, IDs, horloge), `tabular-nums` |
| `--r` | `10px` | radius unique. **Exception documentée : le bouton PTT est le seul cercle.** |

## Règles

1. **Un seul accent** (`#4cc2ff`) sur toute la page ; ok/warn/bad sont réservés aux états sémantiques réels (jamais décoratifs).
2. **Dark unique** (pas de mode clair : environnement PC de régie / grand écran / terrain de nuit).
3. Données chiffrées **toujours en mono tabulaire** ; texte en system sans.
4. Wordmark : `CONDUCTOR` 13px, graisse 800, letter-spacing 3px.
5. Badges d'état : 10px/700, radius 6 (sous-élément), bordure 1px de la couleur d'état.
6. Zéro em-dash visible, zéro emoji décoratif, zéro dot décoratif (le point de connexion est un état réel).
7. Feedback tactile : `:active { scale(.97-.98) }` sur tout élément pressable.
8. Rôles de dispatch : primary = `--bad`, backfill = `--accent`, witness = `--dim` (cohérent 3 surfaces : tags téléphone, tags console, beams 3D).

## Par surface

- **Staff (téléphone)** : logique talkie-walkie. 3 vues (RADIO / CARTE / PLUS), le PTT circulaire
  est l'unique héros de l'écran, un dispatch entrant ramène sur RADIO, un accusé bascule sur
  CARTE (itinéraire). Le reste est replié dans PLUS.
- **Console (PC)** : bandeau de couverture pleine largeur (10 zones d'un coup d'œil), puis
  2 colonnes : alertes + incidents (le travail) / dispatchs + journal + démo.
- **3D (grand écran)** : HUD minimal aux mêmes tokens, la scène raconte ; feed des décisions à
  droite, chips de couverture en bas (mêmes chips que la console).

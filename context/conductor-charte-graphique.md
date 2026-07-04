# CONDUCTOR — Charte graphique

> App staff (P4). Direction : instrument lisible en conditions de stress, pas d'esthétique décorative. Chaque couleur encode une information opérationnelle, aucune n'est purement décorative.

---

## 1. Principe directeur

L'app est un client fin, utilisé par un agent de terrain en mouvement, parfois de nuit, parfois sous stress. La charte priorise la lisibilité instantanée avant l'esthétique : gros contrastes, peu de couleurs, chacune ayant un sens précis et constant.

## 2. Couleurs

| Rôle | Valeur | Usage |
|---|---|---|
| Fond app | `#FFFFFF` | Fond de l'app et de la carte |
| Panneau | `#F5F6F8` | Bandeaux, badges secondaires (ex: identité agent) |
| Ligne / bordure | `#E4E7EC` | Séparateurs, contours de carte et de composants |
| Texte principal | `#161B22` | Tout le texte de contenu |
| Texte atténué | `#7C8494` | Labels secondaires, timestamps, codes de zone |
| **Rouge** | `#E5484D` | Icônes de zone sur la carte, marqueurs de signalement, bouton d'accusé de réception ("je m'en occupe"), bordure du panneau d'alerte |
| Rouge doux | `#FDECEC` | Fond du panneau d'alerte (halo derrière un marqueur de signalement actif) |
| **Vert** | `#14B8A6` | Bouton Push-to-Talk uniquement — la seule action que l'agent déclenche lui-même de son propre chef |

**Règle stricte de sens des couleurs :**
- Le **rouge** signale toujours quelque chose qui vient du système (une zone existante, un incident signalé, une action de réponse attendue en urgence)
- Le **vert** signale toujours l'action volontaire et positive de l'agent (parler, initier)
- Aucune autre couleur d'accent n'est introduite — la charte tient sur ces deux teintes fonctionnelles + neutres

## 3. Typographie

| Rôle | Police | Usage |
|---|---|---|
| Display / données | `JetBrains Mono` | Nom de l'app, codes de zone (Z8), timestamps |
| Corps / instructions | `Inter` | Texte des alertes, noms des agents, labels de bouton |

Deux polices seulement. Le monospace est réservé aux données courtes et identifiants ; jamais utilisé pour des phrases longues.

## 4. Iconographie — zones (carte)

Chaque zone du parc est représentée par une icône rouge distincte, dans un cercle plein de `26px`, posée sur fond blanc :

| Zone | Icône |
|---|---|
| Z1 — Entrée | Porte / flèche d'entrée |
| Z2 — Grand Huit | Ligne de montagnes russes |
| Z3 — Grande Roue | Roue à rayons |
| Z4 — Rivière Sauvage | Vague |
| Z5 — Place Centrale | Étoile |
| Z6 — Zone Enfants | Silhouette parent-enfant |
| Z7 — Food Court | Couverts |
| Z8 — Manège Extrême | Éclair |
| Z9 — Boutiques | Sac |
| Z10 — Parking | Voiture |

Chaque icône est accompagnée du code de zone (ex: "Z2") en `JetBrains Mono`, `8px`, couleur atténuée, juste en dessous.

## 5. Iconographie — types de signalement

Quand un incident est actif, un marqueur plus grand (`34px`) remplace l'icône de zone à cet endroit, avec un halo rouge doux (`box-shadow` en `#FDECEC`) pour le distinguer visuellement des zones au repos :

| Type d'incident | Compétence liée | Icône |
|---|---|---|
| Arrêt cardiaque | RCP, DAE | Cœur |
| Blessure | first-aid | Croix |
| Incident de sécurité | secu | Bouclier |
| Malaise | medic | Point d'exclamation dans un cercle |

## 6. Composants

**Bouton Push-to-Talk**
Cercle plein `58px`, fond vert `#14B8A6`, icône micro blanche centrée. Seul élément vert de l'interface — doit rester unique pour garder sa valeur de signal.

**Panneau d'alerte (dispatch)**
Fond `#FDECEC`, bordure `1px solid #E5484D`, coins arrondis `10px`. Contient : code de zone en rouge + mono (ex: "Z8 · MANEGE EXTREME"), timestamp atténué, texte d'instruction en `Inter` noir, bouton d'action pleine largeur.

**Bouton d'accusé ("je m'en occupe")**
Pleine largeur, fond rouge `#E5484D`, texte blanc, coins `8px`. Rouge choisi ici car c'est une réponse à une alerte système, pas une initiative de l'agent — cohérent avec la règle de sens des couleurs (section 2).

**Badge agent**
Fond `#F5F6F8`, texte `#161B22`, coins `6px`, discret — sert juste à rappeler qui est connecté, jamais l'élément visuel principal.

## 7. Ce qu'on évite

- Pas de dégradés, pas d'ombres décoratives, pas d'effets néon/glow
- Pas de troisième couleur d'accent — chaque nouvelle couleur introduite doit avoir un rôle fonctionnel justifié, sinon elle est refusée
- Pas de carte comme élément "héros" — elle reste un support de repérage, jamais l'élément le plus travaillé visuellement de l'écran (cohérent avec la contrainte anti-dashboard du PRD)
- Pas de troisième police

## 8. Fichier de référence

Les tokens ci-dessus + un aperçu visuel des 2 écrans (carte au repos, carte avec signalement actif) sont disponibles dans `conductor-charte-graphique-v2.html`, à garder ouvert comme référence pendant le développement.

# CONDUCTOR — Runbook de répétition & staging démo

> Produit après exécution de la « Next Immediate Action » (audit + mesure live, 2026-07-04 soir).
> Le code est prêt et **vérifié live**. Ce doc = tout ce qu'il reste, qui est **humain** (réseau, répétition, vidéo),
> plus la mesure de latence (la donnée qui manquait) et l'analyse de staging **corrigée**.

## 0. État vérifié live (ce soir, serveur réel lancé)
- ✅ **CA mkcert installée** sur le laptop + cert `certs/cert.pem` valide (jusqu'à 2028) **couvrant l'IP LAN `192.168.8.91`** (SAN OK). → **Étape 1 côté laptop = déjà faite.**
- ✅ **Crédits Gradium : 143 950 / 145 000** restants. Pré-générer / répéter ne coûte rien de significatif.
- ✅ Serveur lancé en **RÉEL** (`/health` : `liveReady:true`, `mockCrusoe:false`, `mockGradium:false`, `persist:true`, modèle `deepseek-ai/Deepseek-V4-Flash`).
- ✅ Les **3 surfaces servent** (HTTP 200) : `/index.html` (staff), `/operator.html` (console), `/sim` (3D live).
- ✅ **Pipeline réel OK** sur S1/S2/S4 (`smoke-pipeline.js`) — décisions correctes, `source=crusoe`.

## 1. Budget de latence MESURÉ (la donnée manquante)
Mesures réelles ce soir contre le stack Crusoe + Gradium live :

| Segment | Mesure |
|---|---|
| STT — Gradium `transcribe` (sample 104 ko) | **2 301 ms** |
| **Crusoe `decide` (pur, le goulot)** | **3 995 ms** (⚠ le smoke lui-même alerte « >3 s : pré-chauffe ») |
| TTS — Gradium `speak` (par appel) | **1 620–1 820 ms** (primary+backfill **parallélisés + dédup**) |
| Overhead moteur/réseau | ~200–500 ms |
| **`sim_incident` → `incident` (bouton, sans STT)** | **≈ 5,7–6,2 s** (mesuré S1/S2/S4) |
| **micro → audio complet (PTT live)** | **≈ 8–9 s** (= STT 2,3 + Crusoe 4,0 + TTS 1,8 + overhead) |

**À refaire à la main pendant la répétition** : chronométrer le vrai micro→audio bout-en-bout sur un vrai téléphone (le mien mesure côté serveur, pas la capture micro + la latence audio de sortie du haut-parleur). Attendu ≈ 8–9 s.

## 2. Analyse de staging — CORRIGÉE ⚠
L'hypothèse initiale (étape 3 : « pré-générer les TTS pour passer sous 5 s ») est **fausse d'après la mesure** :
- Le TTS ne pèse que **~1,8 s** et il est **déjà parallélisé + dédupliqué** dans `agent.js` (témoins = texte seul).
- Le plancher incompressible = **Crusoe `decide` (~4 s) + STT (~2,3 s)** = **~6,3 s**. Même TTS instantané ne passe pas sous 5 s en mode micro.

**Les vrais leviers, par ordre d'impact :**
1. **Mode d'entrée = boutons scénario** (pas de micro) → supprime le STT → **~6 s** au lieu de ~8-9 s. Les boutons S1–S4 existent déjà dans le staff ET la console (émettent `sim_incident` avec transcript). Chemin **fiable**, marche même sans mkcert sur les téléphones.
2. **Faire ressentir l'attente comme intentionnelle** : sur relâche du PTT / clic bouton, la console montre l'incident + la **justification Crusoe** qui s'affiche → les 6-8 s deviennent la **preuve d'intelligence** (« le dispatcher raisonne sur tout le parc en temps réel »), pas un temps mort. C'est un **argument de pitch**, pas un défaut à cacher.
3. **Pré-chauffe Crusoe** avant la démo (le 1er appel à froid est plus lent) : tirer un S2 « à blanc » 30 s avant de filmer.
4. **Pré-génération TTS** : gain marginal (~1,8 s déjà recouvert) et nécessiterait un cache read-through par hash de texte (modif `speak()` sur `main`). **Non recommandé** sauf si on vise absolument < 5 s en mode bouton — à trancher (voir §6).

## 3. Réseau de démo — URLs exactes
Sur le **même WiFi/hotspot** que le laptop :
- 📱 Téléphones (staff) : **`https://192.168.8.91:3000/index.html`**
- 💻 PC (console opérateur) : **`https://192.168.8.91:3000/operator.html`**
- 🖥️ Grand écran (3D live) : **`https://192.168.8.91:3000/sim`** (`?mode=demo` = scripté offline de secours)

> ⚠ Si le réseau de la démo donne une **autre IP** que `192.168.8.91` : relancer `npm run certs` **sur ce réseau** (régénère le cert feuille avec la nouvelle IP ; la CA est déjà installée/trustée). Les téléphones qui trustent déjà la CA n'ont **rien à refaire**.

### Truster la CA mkcert sur les téléphones (le seul reste de l'étape 1 — À FAIRE UNE FOIS)
Fichier CA : `/Users/nathan/Library/Application Support/mkcert/rootCA.pem`
- **iPhone** : AirDrop/email `rootCA.pem` → l'ouvrir → *Réglages ▸ Profil téléchargé ▸ Installer* → puis *Réglages ▸ Général ▸ Informations ▸ Réglages de confiance des certificats* → **activer la confiance** pour le root mkcert.
- **Android** : *Paramètres ▸ Sécurité ▸ Chiffrement & identifiants ▸ Installer un certificat ▸ Certificat CA* → choisir `rootCA.pem`.
- **Pourquoi obligatoire** : le micro (getUserMedia) exige un *secure context*. HTTPS avec cert non trusté ≠ secure context → **micro bloqué**. Sans CA trustée, on reste sur les **boutons** (qui, eux, marchent).

## 4. Runbook répétition — S1 → S4
Avant chaque scénario : **Reset** (bouton `reset` sur la console, ou event `reset`) → état seed propre (toutes zones à leur minimum, surplus Z2 +1 / Z5 +1).

| # | Déclencheur (bouton OU phrase micro) | Ce qu'on doit VOIR (preuve) |
|---|---|---|
| **S1** | *« malaise au grand huit, une personne au sol »* (fr) | Incident Z2, sévérité modérée, **1 primary, aucun backfill** (Z2 avait du surplus). Simple & rapide. |
| **S2** | *« arrêt cardiaque au manège extrême, il ne respire plus »* (fr) | Incident Z8 sév 5, **primary Hugo (A7) sur zone + backfill Marco (A1)** depuis Z2 (cascade surplus-aware). Le scénario signature. |
| **S3** | *« malaise à la zone enfants, personne inconsciente »* (fr) | Incident + **`coverage_warning`** : une zone tombe sous le minimum → alerte **Accepter / Réassigner** sur la console (F5). |
| **S4** | *« un hombre se desplomó en la entrada, no respira »* (es) | **Multilingue** : transcript ES → dispatch dans la langue de l'agent, réserviste mobilisé. Montre STT/TTS fr/en/es. |

> Les agents exacts choisis par Crusoe **varient un peu d'un run à l'autre** (c'est un vrai LLM). Ne pas scripter « A7 » au mot près dans la narration ; scripter la **logique** (« le plus proche intervient, un renfort en surplus backfill »).

**Bonus à filmer** : l'**override** (staff, bouton « protège Marco ») → contrainte apprise → relancer S2 → le moteur ne ponctionne plus Marco. Argument « le système apprend les règles terrain ».

## 5. Répétition « mode dégradé » (Crusoe coupé) — argument résilience F9
Lancer une passe avec Crusoe forcé en mock (fallback déterministe) → badge **« MODE DÉGRADÉ »** visible, le dispatch continue :
```bash
MOCK_CRUSOE=true MOCK_GRADIUM=false npm start   # cerveau offline, voix réelle
```
À filmer : « même si le cloud IA tombe, CONDUCTOR continue de dispatcher ». Puissant pour l'Impact (25 %).

## 6. Réglages démo recommandés (à valider)
- **`ACK_TIMEOUT_MS`** : défaut = 15000. Pour que le **re-route sur non-accusé (F6)** soit filmable dans une démo courte, lancer avec **`ACK_TIMEOUT_MS=8000`** (pas besoin de modifier le défaut dans `config.js`) :
  ```bash
  ACK_TIMEOUT_MS=8000 npm start
  ```
- **Langue** : narration/pitch en **EN**, dispatch **ES sur S4** = le « flourish » multilingue. À trancher selon le jury.
- **Pré-gen TTS** : *non recommandé* (§2.4) sauf décision explicite de viser < 5 s en mode bouton.

## 7. Livrable OBLIGATOIRE — vidéo 1 min (actuellement 0 %)
1. **Filmer la répétition** (secours + rushes) dès le premier run propre.
2. Structure suggérée (60 s) : problème (5 s) → un incident déclenché (S2) → **la console montre le raisonnement Crusoe + la carte bouge + la 3D live** (20 s) → multilingue S4 (10 s) → mode dégradé (10 s) → tag line + équipe (15 s).
3. Monter à partir des meilleurs rushes. La vidéo pèse dans Demo (50 %) + Pitch (10 %).

## Comment relancer le serveur (rappel)
```bash
cd coordinator
npm start                                  # réel (défaut .env : MOCK=false)
# variantes démo :
ACK_TIMEOUT_MS=8000 npm start              # re-route filmable
MOCK_CRUSOE=true  MOCK_GRADIUM=false npm start   # mode dégradé (Crusoe offline)
```

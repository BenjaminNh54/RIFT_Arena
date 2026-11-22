# RIFT ARENA — RAPPORT D'AUDIT COMPLET

Date : 2026-11-22 — Audit réalisé sur le ZIP fourni (`Rift-Arena(1).zip`, 100 fichiers, 72 fichiers JS).
Méthode : lecture du code, `node --check` sur tous les JS, exécution réelle de la suite de tests,
démarrages réels du serveur (mode dev JSON + mode strict MySQL), grep systématiques de sécurité,
puis **vérification sur un vrai serveur MySQL 9.7.4** (voir §15 — ronde 2 après déploiement Render).

---

## 15. RONDE 2 — Bugs révélés par le premier déploiement Render (corrigés et vérifiés sur MySQL réel)

Le premier déploiement sur Render + Alwaysdata a révélé des bugs invisibles en local (le store
JSON masque tout le SQL). Diagnostic depuis les logs de production, corrections vérifiées en
rejouant le schéma sur un **MySQL 9.7.4 réel** avec les conditions Alwaysdata reproduites.

| # | Gravité | Bug | Correctif |
|---|---------|-----|-----------|
| 12 | **Bloquant (production)** | `errno: 150 "Foreign key constraint is incorrectly formed"` : `users` était créé avec `COLLATE=utf8mb4_unicode_ci` mais les **30 autres tables** n'avaient que `CHARSET=utf8mb4` sans COLLATE → collation par défaut du serveur (`utf8mb4_0900_ai_ci`) ≠ collation de `users` sur les FK CHAR(36) → `sessions` et tout le schéma après elle ne se créaient jamais. | `COLLATE=utf8mb4_unicode_ci` explicite sur les **31 tables** + `SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci` en tête de schéma. Vérifié : 32 tables créées, 10 FK valides, collations toutes cohérentes (information_schema). |
| 13 | **Bloquant (production)** | `auto-migrate` en échec ne stoppait pas le boot (le serveur crashait ensuite sur les tables manquantes, cf. log Render `Table 'events' doesn't exist`). | Échec de replay du schéma MySQL = **arrêt immédiat** (`exit(1)`) avec le statement fautif nommé. `seedContent` rendu résilient par bloc (`safe()`). |
| 14 | **Bloquant (production)** | `INSERT INTO users` : **11 colonnes mais 10 placeholders** → `Column count doesn't match value count` à l'inscription. | Corrigé (11 `?`). Audit automatisé de tous les INSERT du store (26 statements, comptage parenthèses à profondeur) : tous cohérents. |
| 15 | **Bloquant (production)** | Dates ISO-8601 (`2026-…T…Z`) envoyées dans des colonnes `DATETIME` → rejetées par MySQL strict (`Incorrect datetime value`) à l'inscription, sessions, sanctions, matchs… | `now()` produit le format MySQL UTC + normaliseur global `sqlParam` sur les 108 points d'exécution SQL (`_execute`/`_query`) : ISO/Date → `YYYY-MM-DD HH:MM:SS`, `undefined` → `NULL`, objets/tableaux → JSON. Pool en `timezone: 'Z'` + `time_zone='+00:00'` (comparaisons `NOW()` cohérentes UTC). |
| 16 | **Majeur (production)** | Objets JS passés bruts dans les colonnes JSON → valeurs `'[object Object]'`. | Couvert par `sqlParam` (sérialisation automatique). |
| 17 | **Majeur (production)** | Lectures JSON : mysql2 **parse déjà** les colonnes JSON en objets → `JSON.parse(objet)` plantait (`[object Object] is not valid JSON`, `Unexpected end of JSON input`). | Lecteur tolérant `jparse()` sur les 12 points de lecture (objet OU chaîne, NULL → fallback). |
| 18 | **Majeur (production)** | Alias SQL `by_id AS by` — `BY` est un mot réservé MySQL 8 → erreur de syntaxe dans `activeSanctions`. | Alias backtické `` `by` `` (les consommateurs JS lisent `s.by`). |
| 19 | Mineur (production) | Commentaires SQL inline contenant `;` (ex. `-- sha256 of token; raw token never stored`) coupaient les statements du replay. | Scanner à états dans `auto-migrate` (respect des chaînes quotées et des commentaires). |

**Vérification réelle (MySQL 9.7.4, conditions Alwaysdata reproduites)** :
- `autoMigrate` : schéma complet + migration 001 ; re-jouage idempotent (2ᵉ passage : 0 migration).
- 32 tables / 10 FK / collations cohérentes (`information_schema`).
- **76 opérations du store exercées avec succès** (users, sessions, inventaire, trophées, clans+guerre,
  amis+blocage, sanctions, missions, events+progression, pass, ranked+saison, boutique+rotation,
  config, maps (save/get/list/like/update), matchs+joueurs, messages, parties, reports, logs admin, news).
- **Serveur réel booté sur MySQL** : `/healthz` → `MYSQL CONNECTÉ` ; inscription HTTP 200 ; ligne
  utilisateur vérifiée dans MySQL ; **redémarrage du serveur → login 200 (persistance réelle prouvée)**.
- Régression JSON : 50/50 tests toujours verts.

Reste non vérifiable dans la sandbox : Alwaysdata lui-même (hôte distant) — mais le schéma est
maintenant validé sur un MySQL 9.7.4 réel avec ses conditions exactes (collation serveur
`utf8mb4_0900_ai_ci`, mode strict). Au redéploiement, les logs doivent montrer
`[auto-migrate] schema.sql appliqué (toutes les tables)` puis `[db] MYSQL CONNECTÉ`.



---

## 16. RONDE 3 — Page blanche côté client après redéploiement (corrigé et vérifié au navigateur réel)

Le second déploiement (backend désormais vert : `MYSQL CONNECTÉ`, schéma complet, seeds OK) a
revealed un client cassé : `Uncaught SyntaxError: … doesn't provide an export named: 'refreshProfile'`.
La page ne rendait rien car une erreur de liaison de modules ES bloque tout le graphe d'entrée.

| # | Gravité | Bug | Correctif |
|---|---------|-----|-----------|
| 20 | **Bloquant (rendu)** | 4 écrans (`shop`, `collection`, `profile`, `lobby`) importaient `refreshProfile` depuis `state.js` où il n'existe pas (il vit dans `app.js`). | Imports corrigés vers `../app.js` (le cycle écran→app existe déjà pour `auth.js`→`buildShell`). |
| 21 | **Bloquant (rendu)** | `buildShell` référençait `isStaff` sans l'importer → `ReferenceError` au boot avec un token valide → shell jamais construit. | `isStaff` importé depuis `state.js`. |
| 22 | **Bloquant (rendu)** | `initRouter(app)` est appelé au boot et jamais re-pointé : `buildShell` construisait le shell puis `navigate('lobby')` **effaçait le shell** en rendant dans `#app` (aucune erreur console — topbar/navigation absentes). | `initRouter(content)` appelé dans `buildShell` avant la première navigation. |
| 23 | **Bloquant (UX)** | L'onglet Inscription **appelait `/api/auth/login`** (401 « Identifiants incorrects ») : le POST register n'était envoyé que dans le flux bootstrap admin. | Mode register = POST `/api/auth/register` dont la réponse `token+profile` est utilisée directement ; flux bootstrap admin inchangé. |
| 24 | Majeur (rendu) | `editor.js` et `game/client.js` importaient `icon` depuis `ui.js` — il est exporté par `components/icons.js`. | Import corrigé vers `icons.js` (l'import mort d'`app.js` retiré). |
| 25 | Mineur (déploiement) | `sessionVariables` n'est pas une option mysql2 (warning à chaque boot). | Remplacé par un hook `connection` sur le pool sous-jacent : `SET time_zone = '+00:00'` par connexion. |
| 26 | Préventif | Service worker en `v1` avec précache de l'ancien `app.js`. | `VERSION` bumpée `v2` (purge du précache à l'activation) ; stratégie network-first inchangée. |

**Vérifications réelles** :
- **Audit statique du graphe de modules** (34 modules client+shared, 114 exports) : chaque import nommé
  existe dans sa cible, tous les chemins (statiques, dynamiques, `/shared/*`) résolvent — **PROPRE ✅**
  (script conservé : `scripts/client-import-audit.py`).
- **Navigateur headless (Chrome 158) contre le serveur réel** : écran d'auth rendu ; inscription via
  l'UI → 200 → **lobby complet avec shell** (7 items de nav, topbar, chip joueur, portefeuille 300
  crédits / 50 tokens) ; navigation réelle vers **Boutique** (catalogue, rotation, Acheter), **Persos**
  (roster VOLT/VEX/BRAKK/NYX), **Profil** (stats, personnalisation) — **zéro erreur console/page** ;
  capture d'écran validée visuellement.
- MySQL rejoué après le fix warning : `ALL CHECKS PASSED ✅` sans aucun warning.
- Régression : 50/50 tests serveur verts ; `node --check` sur les 10 fichiers client touchés.



---

## 17. RONDE 4 — Réglages cassés, fiches combattants, design PC compact, rotation mobile, fluidité

Trace console en production (16:01) : `render failed settings — ReferenceError: isStaff is not
defined (settings.js:15)`. Bonne nouvelle contenue dans cette trace : le routeur naviguait et le
shell se construisait → la ronde 3 est bien déployée (vérifié en direct sur
`rift-arena-uwyj.onrender.com/src/app.js` : `initRouter(content)` + import `isStaff` présents).

### Bugs corrigés

| # | Gravité | Bug | Correctif |
|---|---------|-----|-----------|
| 27 | **Bloquant (écran Réglages)** | `settings.js:15` utilisait `isStaff()` sans l'importer (référence nue invisible pour l'audit d'imports). | Import ajouté depuis `state.js`. |
| 28 | Majeur (latent) | `renderer.js` utilisait `drawFighter()` sans l'importer — plantait au premier rendu concerné. | Import depuis `components/ui.js`. |
| 29 | Majeur (latent) | `ranked.js` utilisait `modal()` sans l'importer. | Import ajouté. |
| 30 | **Bloquant (fiches combattants)** | `describeSuper/abilityDesc/passiveDesc/describeAttack` construisaient un **objet map** dont toutes les branches (template literals) s'évaluaient immédiatement : pour VOLT (super `zone`), la branche `s.wave.radius` plantait → « Détail combattant » vide + TypeError. | Les 4 fonctions réécrites en `switch` (évaluation paresseuse) ; vérifié : les **6** fiches (VOLT/VEX/BRAKK/NYX/KIRO/PATCH) se rendent avec stats et descriptions, zéro erreur. |

**Nouvel outil** : `client-bare-audit.py` — détecte toute fonction cross-module appelée sans être
importée (la classe exacte des bugs 27-29). Client : **0 référence nue, 0 import manquant** (34 modules).

### Design PC compact (demande « tous les menus sont trop gros »)

Nouveau `styles/compact.css` (chargé en dernier) : couche de densité `@media (min-width: 1101px)` —
topbar 58→50px, sidebar 84→68px, boutons (JOUER ~58→40px), paddings panneaux/cartes/modales,
titres d'écran 20→16px, pill/badges/tabulaires réduits ; largeur de contenu plafonnée (1320px,
1460px au-delà de 1600px) pour éviter le vide sur très grands écrans. Mesuré au navigateur :
topbar 50px, sidebar 68px, bouton JOUER 40px. Identité visuelle conservée.

### Rotation horizontale mobile (demande explicite)

Overlay plein écran `#rotate-hint` en **portrait sur écran tactile** (icône animée + « TOURNE TON
TÉLÉPHONE » + bouton « Continuer en vertical » mémorisé pour la session en sessionStorage).
En partie (`body.in-game`) le bouton est masqué : la rotation est obligatoire. Le HUD paysage
existant (`max-height: 480px landscape`) reste actuel. Détection tactile identique à
`isMobileLayout()` (`pointer: coarse` || `ontouchstart` || `maxTouchPoints`). Validé au navigateur :
masqué sur desktop, dismissal + retour paysage OK, visuel capturé.

### Fluidité (« optimise à fond »)

- **lobby.js** : le hero redessinait le canvas à chaque frame avec `cv.width = clientWidth * devicePixelRatio`
  (reallocation mémoire + reflow forcé 60×/s, DPR brut 3× sur mobile haut de gamme) pour un dessin
  **statique** (le `bob` calculé n'était jamais appliqué). → dessin unique + redraw uniquement au
  resize, DPR plafonné à 2.
- `.screen` : `contain: layout style paint` + `will-change` transitoire (un seul écran en DOM à la fois) ;
  `backface-visibility` sur boot/modal/toast.
- Le jeu plafonnait déjà son DPR à 2 (inchangé) ; aucun `backdrop-filter` dans le projet (déjà fluide).

### Vérification réelle (Chrome 158 headless, serveur local)

Sweep complet sans AUCUNE erreur console : 7 écrans de nav (Lobby, Persos, Events, Clan, Amis,
Boutique, Missions) + Réglages + Profil + Pass de saison + Missions détaillées + liste de clans +
détail event + **6 fiches combattants**. Régression : **50/50 tests serveur verts**, `node --check`
sur tous les fichiers touchés.

**Note déploiement** : après avoir poussé cette version, les joueurs n'ont rien à faire de spécial —
le SW `v2` purge l'ancien cache ; si l'onglet était resté ouvert pendant l'ancien SW `v1`, une
simple fermeture/réouverture de l'onglet suffit.

---

## 18. RONDE 5 — Menus façon Brawl Stars, accès admin, partie jouable de bout en bout

Constats de la ronde (captures + console en production) : la barre latérale desktop était **vide**
(aucun item n'était jamais ajouté par le shell — navigation PC morte depuis la ronde 3), aucun
moyen visible d'accéder au panel admin, et une vraie partie révélait quatre bugs bloquants jamais
testés de bout en bout.

### Navigation « Brawl Stars » (tous les écrans)

- `buildShell` ne remplissait **jamais** la sidebar : bande sombre vide sur PC, aucune navigation.
- Refonte : **barre du bas permanente** sur tous les écrans (7 entrées + « Plus » : Route TR, Classé,
  Pass, Maps, Créer, News, Options + entrée **Admin** pour le staff). Sidebar supprimée (HTML, CSS,
  variables), contenu pleine largeur, menu « Plus » en grille de tuiles.
- Vérifié navigateur : 8 items en bas, écrans principaux (Lobby→Missions) + tous les écrans du
  menu Plus rendent, zéro erreur.

### Accès admin

- Le serveur n'acceptait **aucun code admin** : seulement un bootstrap par clé env
  `ADMIN_BOOTSTRAP_KEY`, premier admin uniquement — le compte « Admin » était resté `player`.
- Nouveau **code admin** (`ADMIN_CODE`, défaut documenté `RIFT-ADMIN-2026`) accepté :
  - à **l'inscription** (`/api/auth/register` + champ `adminCode`) → rôle ADMIN direct ;
  - à la **connexion** via `/api/auth/admin-upgrade` (credentials + code vérifiés, promotion même
    si un admin existe déjà) ;
  - champ visible sur l'écran d'authentification, les deux modes.
- **Entrée admin désormais visible** : bouclier doré dans la barre du haut (staff uniquement) +
  tuile « Admin » dans le menu Plus + bouton dans les Options. Panel admin testé connecté.

### Partie jouable (4 bugs corrigés, testés en match réel contre bots)

| # | Gravité | Bug | Correctif |
|---|---------|-----|-----------|
| 31 | **Bloquant visuel** | Le sol de l'arène était **noir** : `renderer.js` multipliait par `TILE` l'**objet** des types de tuiles (`{WALL:1,...}`) au lieu de la taille 64px (`GAME.TILE`) → canvas texture NaN/0px. | Import `GAME` + 60 usages corrigés. |
| 32 | **Bloquant** | `buildHud()` exposait un objet sans la propriété `hudDebug` (l'élément `#hud-debug` existe dans le DOM) → TypeError à chaque snapshot (~10/s, spam console). | Propriété exposée + garde défensive. |
| 33 | **Bloquant** | L'écran de **chargement restait collé devant le match pour toujours** (`loading` jamais retiré) — le jeu tournait masqué. | Retiré au premier snapshot serveur + filet 6 s. |
| 34 | **Bloquant rétention** | Quitter/fermer en pleine partie laissait la room tourner pour des bots jusqu'au bout du timer, joueur verrouillé (`ALREADY_IN_MATCH`) ; `leaveRoom` ne décrémentait pas `humanCount` en partie. | `leaveRoom` décrémente ; le sweep **termine proprement** toute partie sans humain ; re-queue = match neuf (vérifié : 2 salles distinctes, timer frais 2:29). |

### Reconnexion après refresh (bonus)

Un refresh/reconnexion en pleine partie re-proposait la file au lieu de rebrancher : `join()`
détecte désormais la salle active (`running`/`countdown`) et **re-émet `match_found`** → le client
se reconnecte à sa partie en un clic JOUER. Testé : reload en pleine partie → rebranché sur le
même match (timer continu).

### Vérifications

- Cycle complet en Chrome headless : file → bot fill (8 s) → countdown → jeu (sol, entités,
  HUD, minimap) → fin → écran résultats (VICTOIRE/ÉGALITÉ + récompenses) → REJOUER/Retour lobby.
- Pause (Échap) → Abandonner → retour lobby → re-queue OK. Zéro erreur console pendant tout le cycle.
- Régression : **50/50 tests serveur** ; `node --check` sur tous les fichiers touchés.

**Note déploiement** : `ADMIN_CODE` peut être redéfini dans les variables d'environnement Render
(valeur par défaut `RIFT-ADMIN-2026` sinon). L'ancien flux clé `ADMIN_BOOTSTRAP_KEY` reste disponible.

---

## 19. RONDE 6 — Gameplay réel, textures Brawl Stars, disposition tous appareils

### Audit complet du code de jeu (3 500 lignes lus une à une) — 13 bugs corrigés

| # | Gravité | Fichier | Bug | Correctif |
|---|---------|---------|-----|-----------|
| 35 | **Critique gameplay** | engine.js | `stepEnt` excluait les **bots** (`kind !== 'player' && kind !== 'boss'` → return) : les bots étaient des **statues** — jamais déplacés, jamais tirés, jamais rechargés. | Les bots sont steppés comme les joueurs. |
| 36 | **Critique combat** | combat.js | `stepLob` ré-insérait le projectile dans `room.projectiles` **pendant** son propre `for-of` : chaque tir courbé explosait **10-15 fois dans le même tick** (dégâts ×15) ou disparaissait. | Géré inline, une seule explosion, falloff conservé. |
| 37 | **Critique feel** | combat.js | Les tirs courbes (lob) atterrissaient **toujours à portée max** (`Math.min(range, range)`) — impossible de toucher plus près. | Nouveau champ `aimDist` (souris PC, drag mobile, auto-aim, bots) → le tir atterrit LÀ où on vise. Vérifié : 688/700 dmg sur cible à 400px. |
| 38 | Majeur | combat.js | La mêlée frappait **à travers les murs** (pas de LOS). | `lineBlocked` ajouté. |
| 39 | Majeur | bots.js | Le kite fuyait dès 70% de la portée : les tireurs passaient leur temps à fuir **dos aux murs** sans jamais tirer (LOS bloquée 197/200 ticks). | Fuite seulement à <45% de portée + strafe. |
| 40 | Majeur | input.js | Visée mobile codée en dur `window.innerHeight-60` au lieu du **centre réel du bouton** → angle systématiquement faux. | `getBoundingClientRect()`. |
| 41 | Majeur | websocket | « Abandonner » ne cancelait pas la file d'attente résiduelle → **match fantôme** démarré + `match_found` relançait le jeu derrière le lobby. | `leave_room` → `matchmaker.cancel`. |
| 42 | Majeur HUD | engine.js/client.js | Le timer de réapparition était **figé à 3s** (le serveur n'envoyait pas `respawnAt`). | Champ `ri` dans le snapshot. |
| 43 | HUD | client.js | Les coéquipiers morts **disparaissaient** de la liste (plus de compte d'équipe). | Affichés grisés à 0%. |
| 44 | Moteur | engine.js | Respawn ne réinitialisait pas speedMult/reveal/buff/pierce. | Réinitialisés. |
| 45 | Moteur | engine.js | Ids de projectiles de tourelle « tNaN » (`++undefined`). | Compteur propre. |
| 46 | Rendu | renderer.js | Les ennemis dans les buissons restaient **totalement visibles** (le commentaire promettait l'inverse). | Buissons dessinés **au-dessus** des combattants (on s'y cache comme dans BS). |
| 47 | Robustesse | client.js | Crashes possibles: `local` null dans input.update, `map.grid[y][x]` sans garde (minimap). | Gardes ajoutées. |

### Textures refaites façon Brawl Stars (renderer réécrit)

- Palettes **vives** pour les 8 thèmes (au lieu des tons sombres ternes), sol en dalles à deux tons
  avec taches claires, speckles et joints de dalles.
- **Murs 2.5D** : face avant sombre + face supérieure claire + reflet + contour sombre — comme la
  référence fournie.
- **Caisses en bois** à croisillons X, clous et ombre ; **buissons** en amas à deux tons qui
  ondulent légèrement ; **eau** à vaguelettes ; **pièges** à pointes de lave ; portails à dégradé.
- **Ombres elliptiques** sous chaque combattant/tourelle/ballon, anneaux d'équipe, **noms + barres
  de vie en capsule** façon BS, yeux dessinés, **dégâts flottants** (`-1150`) avec contour noir.
- **Pads d'apparition** colorés par équipe sur la carte.
- Contrôles tactiles agrandis façon BS : joystick 148px, bouton d'attaque orange 96px, super/capacité 66px.

### Disposition vérifiée sur trois tailles (captures)

- **375px** : hero card + gros bouton JOUER orange pleine largeur + cartes dessous + nav 8 entrées
  (labels resserrés à ≤430px pour ne pas se chevaucher).
- **768px** : même disposition, nav équilibrée, bouclier admin visible.
- **1280px** : hero à gauche, colonne droite (Pass/Event), barre du bas — la structure de la
  capture Brawl Stars fournie.
- **HUD en partie 812×375 (paysage)** : gros joystick translucide à gauche, boutons d'attaque
  orange + super à droite — disposition identique à l'image de référence.

### Vérifications (simulateur + navigateur)

- Simulation headless 3v3 de 60s : **28 441 dégâts, 5 kills, cristaux ramassés** — les bots
  jouent vraiment (avant : 0 dégât, 0 déplacement).
- Élimination headless : scores monotones croissants (jamais de reset), fin par target 10.
- Match complet en navigateur (élimination 3v3) : 0-0 → 3-9 → **B atteint 10 → écran de
  résultats DÉFAITE** — checkEnd, récompenses et résultats opérationnels, zéro erreur console.
- Matchs multi-modes testés : Crystal Rush, Élimination. Régression : **50/50 tests serveur**.

---

## 1. Bugs trouvés

| # | Gravité | Bug |
|---|---------|-----|
| 1 | **Bloquant** | `client/src/screens/admin.js` — 3 erreurs de syntaxe (parenthèses) vers la ligne 535 : une manquante (535), une manquante (543), une en trop (549). Le module refusait de se charger (`SyntaxError: missing ) after argument list`) — l'écran Admin était inutilisable. |
| 2 | **Bloquant** | Double inscription en file : lobby, events, ranked et le client de jeu envoyaient à la fois `POST /api/queue` (REST) **et** `{ t:'queue' }` (WebSocket) — deux canaux pour la même action, risque de double traitement et de désynchronisation. |
| 3 | **Majeur** | `server/src/api/index.js:220` — `inQueue: matchmaker.size('crystal_rush', false) >= 0` était **toujours vrai** (une taille est toujours ≥ 0). Le statut de file renvoyé était fictif. |
| 4 | **Majeur** | Le matchmaker autorisait un joueur à être inscrit dans **plusieurs files simultanément** (normal + classé + event), ne refusait pas l'inscription quand le joueur est déjà dans un match, et réinitialisait le timer d'attente à chaque re-clic. |
| 5 | **Majeur** | Aucun nettoyage de file à la déconnexion WebSocket → **files fantômes** (joueur parti, file qui attend un match impossible à constituer). |
| 6 | **Majeur** | File classée : la « fenêtre de rating » annoncée en commentaire n'existait pas (simple tri par RP) → matchs trop disparates possible, et aucun mécanisme garantissant la constitution d'un match classé. |
| 7 | **Majeur (production)** | Si MySQL échouait, bascule **silencieuse** sur le stockage JSON : le serveur acceptait des joueurs sur une base temporaire non persistée sans aucun signal clair. |
| 8 | **Critique (sécurité)** | `POST /api/maps` acceptait un `map.id` fourni par le client et `saveMap` fait un `ON DUPLICATE KEY UPDATE` → **n'importe quel utilisateur pouvait écraser la map d'un autre** (et se réassigner la paternité) en postant son id. |
| 9 | **Majeur (sécurité)** | `objectives` d'une map communautaire accepté comme objet arbitraire → atteignait `bots.js`/`renderer.js` sans validation (valeurs impossibles, clés inconnues, casse de partie possible). |
| 10 | Mineur | Like possible sur une map inexistante (`likeMap(id)` sans vérification). |
| 11 | Mineur | Test d'intégration encore calé sur l'ancien chemin WS de file (devenu obsolète après le fix #2). |

## 2. Bugs corrigés (tous)

1. **admin.js** : parenthèses recalibrées sur les 3 blocs ; `node --check` passe sur **les 72 fichiers JS** du projet ; le panel Admin se charge et app.js n'échoue plus.
2. **Matchmaking — un seul système** : REST (`POST /api/queue`, `DELETE /api/queue`, `GET /api/queue/state`) est l'unique chemin d'inscription/annulation. Les handlers WS `queue` et `cancel_queue` ont été **supprimés côté serveur**, et les 5 appels WS doublons retirés côté client (lobby, events, ranked, replay). WS conservé uniquement pour les notifications serveur→client (`match_found`, chat, emotes).
3. **Statut de file réel** : nouveau `matchmaker.stateOf(userId)` → `{ inQueue, mode, ranked, position, queueSize, partyId, event, waitMs }` + `inRoom`. Plus aucune valeur fictive.
4. **Files uniques** : `join()` vide toutes les autres files du joueur, refuse avec `ALREADY_IN_MATCH` s'il est déjà dans une room, conserve le `joinedAt` d'origine (re-clic ne remet pas le chrono à zéro).
5. **Déconnexions** : fermeture du dernier socket du joueur → `matchmaker.cancel()` (plus de file fantôme).
6. **Fenêtre classée réelle** : ancrée sur le joueur qui attend le plus longtemps, élargie de +25 RP/s, illimitée après 25 s — garantit qu'un match classé finit par se constituer, sans bots (les bots restent interdits en classé).
7. **MySQL strict (exigence Alwaysdata)** :
   - `NODE_ENV=production` (ou `DB_STRICT=1`) : si MySQL est manquant ou injoignable, le serveur **refuse de démarrer** (`exit(1)`) avec des logs explicites — plus de bascule JSON silencieuse qui ferait croire à une persistance.
   - En dev local, le JSON reste disponible et est clairement marqué `MODE JSON LOCAL`.
   - Les trois états sont distinguables partout : **MYSQL CONNECTÉ / MYSQL EN ERREUR / MODE JSON LOCAL** (logs + `/healthz`).
   - `/healthz` retourne désormais un JSON réel : `{ status, db: { mode, state, label, error? }, uptime_s }` — testé en dev (JSON) et en échec strict (ECONNREFUSED → exit 1 vérifié).
   - `MysqlStore.ping()` ajouté (`SELECT 1`) pour la vérification de santé.
8. **Ownership des maps** : un `map.id` existant ne peut être réécrit que par son auteur ou un ADMIN (`403 NOT_YOUR_MAP`) ; l'ownership n'est jamais réassigné ; une édition d'une map publiée conserve son statut (sauf publish explicite → retour en `pending` pour re-modération) ; `version` incrémentée automatiquement.
9. **Objectifs de map validés** : nouveau `validateObjectives()` (whitelist stricte : `crystals`, `ball`, `goalA`, `goalB`, `zones{A,B,C}` ; paires `[x,y]` entières dans les bornes ; **clés inconnues rejetées**). Les maps communautaires restent de la pure donnée.
10. **Like** : 404 si la map n'existe pas (rate limit conservé).
11. **Test d'intégration réécrit** pour le chemin REST unique : vérifie l'ack avec position, l'état réel par joueur, le passage d'une file à l'autre (ancienne file vidée), et l'annulation réelle.

## 3. Fichiers modifiés

- `client/src/screens/admin.js` — syntaxe (3 parenthèses)
- `client/src/screens/lobby.js` — suppression du doublon WS join/cancel
- `client/src/screens/events.js` — idem + `await` du POST
- `client/src/screens/ranked.js` — idem
- `client/src/game/client.js` — suppression du WS join dans `replayQueue()`
- `server/src/api/index.js` — `/api/queue/state` réel ; ownership maps ; `validateObjectives` ; like 404
- `server/src/matchmaking/index.js` — `join()` (files uniques, ALREADY_IN_MATCH, timer), `stateOf()`, `positionOf()`, fenêtre RP ranked
- `server/src/websocket/index.js` — suppression des handlers WS de file ; cancel de file à la déconnexion
- `server/src/database/index.js` — mode strict, messages MYSQL CONNECTÉ/EN ERREUR/MODE JSON LOCAL, `dbHealth()`
- `server/src/database/mysql_store.js` — `ping()`
- `server/src/database/auto-migrate.js` — auto-migration schéma+migrations au boot (tour précédent, conservé)
- `server/src/index.js` — boot : gate strict + auto-migrate + `/healthz` JSON réel
- `shared/validators/index.js` — `validateObjectives()`
- `tests/matchmaking.test.js` — integration réécrite (REST) + bootstrap admin no-shell
- `docs/RENDER.md`, `docs/ADMIN.md`, `README.md` — déploiement sans shell + strict DB

## 4. Améliorations apportées

- `/healthz` JSON : état DB réel exposé (Render healthcheck toujours en 200 quand le process est sain ; en strict, un process sans DB ne démarre pas du tout).
- Auto-migration MySQL au démarrage (schéma + migrations idempotents, suivi `_migrations`) : aucun `npm run db:migrate` à lancer — Render free sans shell fonctionne.
- Création du premier admin **sans shell** depuis l'écran de connexion (clé `ADMIN_BOOTSTRAP_KEY`, refus après existence d'un admin, rate limit) — endpoint testé par le test d'intégration.
- Logs de boot en français et explicites (DB, seeds, migrations).
- Docs RENDER/ADMIN/README alignées sur ce comportement.

## 5. Problèmes de sécurité corrigés

- Écrasement de map d'un autre utilisateur via id (critique) → contrôle d'ownership serveur.
- Injection de valeurs impossibles dans les objectifs de map → validateur whitelist strict.
- Vérification d'existence avant `like`.
- (Tour précédent, conservé) : bootstrap admin protégé par clé d'env, refus si un admin existe, rate limit 3/10 min.

## 6-7. Tests exécutés et résultats

Commande : `npm install` puis `npm test` (node:test). **Résultat : 50 tests, 50 passés, 0 échec, 0 ignoré.**

Couverture réelle vérifiée (extraits) :
- **Gameplay serveur-authoritaire** : mouvement avec murs, tir (munitions + cooldowns), dégâts/kills, mêlée frontale, super (charge par dégâts + zone), destruction de caisses AoE, stun, validation des inputs garbage, snapshot compact/complet.
- **Les 6 modes** : elimination (score par kills + cible), crystal_rush (pickup, compte à rebours, dépôt à la mort, victoire), domination (capture de zone + score), last_core (rétrécissement + victoire en solo), strikeball (but + reset), boss_raid (boss, phases, victoire en tuant le boss).
- **Matchmaking** : file solo remplie par bots, lobby humain complet sans bots, FFA 8 combattants, classé sans remplissage bot, files de groupe, chemins REST avec état réel (nouveaux asserts).
- **Intégration HTTP+WS réelle** : démarrage du serveur, register/login, catalogue, auth WS, chat + rate limit, files REST, maps, events/news seedées, 401 sans token, bootstrap admin (mauvaise clé refusée, bonne clé → ADMIN, 2ᵉ refusée, dashboard accessible).
- **Systèmes** : auth (bad credentials, logout), scrypt salé, récompenses persistées, déblocage combattants, RP/ligues, missions, pass, boutique (fonds insuffisants), coffres, clans (permissions, guerre), amis (blocage), chat (filtre/mute), sanctions (ban bloque le login), events (progression/claim), maps communautaires, logs admin, matrice de permissions admin.
- **Maps officielles** : symétrie, validité, compatibilité modes, encodage/décodage grille.

## 8. Fonctionnalités testées réellement

Tout ce qui précède a été **exécuté** (tests automatisés + démarrages réels du serveur : mode dev, mode strict en échec, healthcheck, curl sur `/healthz`, `/`, assets statiques).

## 9. Fonctionnalités non testées

- **MySQL Alwaysdata réel** : reproduit et validé sur un **MySQL 9.7.4 local réel** (schéma, FK, collations, 76 opérations du store, boot serveur, persistance après redémarrage) — la connexion à l'hôte Alwaysdata distant reste à confirmer au redéploiement (logs `[db] MYSQL CONNECTÉ`, `/healthz` → `state:"connected"`).
- **Rendu visuel multi-appareils réel** (1920/1366/1024/768/430/390/360 px) : structure vérifiée par code (meta viewport, media queries, HUD/overlays en CSS flexible, joystick tactile), mais pas de test navigateur automatisé — à confirmer visuellement.
- **Installation PWA sur iOS Safari** : manifest + SW vérifiés par code (cache shell versionné, `/api/` et `/ws` jamais cachés), installation réelle non testée.
- **Charge multi-joueurs réelle** (latence, concurrence SQL élevée).

## 10. Problèmes restant à résoudre

Aucun bug bloquant connu. Limitations assumées et documentées :
- Les « likes » de maps ne sont pas dédoublonnés par utilisateur (plafonnés par rate limit 10/h/utilisateur) — un dédoublonnage nécessiterait une table supplémentaire.
- Le mode JSON local est volontairement conservé pour le développement ; en production il est impossible (mode strict).
- Les events expirés restent listés côté client mais marqués `live:false` (filtrage d'affichage côté client à affiner si souhaité).

## 11. Instructions d'installation

```bash
npm install
npm test          # 50 tests
npm start         # http://localhost:8080 (MODE JSON LOCAL en dev)
```

Variables optionnelles dev : `PORT`, `DATA_DIR`, `NODE_ENV`, `DB_STRICT=0`.
Premier admin en local : onglet Inscription → créer le compte → Connexion → « Première installation admin » → coller `ADMIN_BOOTSTRAP_KEY`.

## 12. Déploiement Render

1. Pousser le projet sur GitHub → Render → **New → Blueprint** (`render.yaml` fourni : build `npm install`, start `npm start`, healthcheck `/healthz`, `SESSION_SECRET` et `ADMIN_BOOTSTRAP_KEY` générés).
2. Environment : renseigner `MYSQL_HOST`, `MYSQL_PORT` (3306), `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` (Alwaysdata).
3. Déployer. Au boot : schéma + migrations appliqués automatiquement (`[auto-migrate] schema.sql applied`), contenu par défaut inséré (events, news, boutique, Pass, saison).
4. Créer le compte puis le premier admin depuis l'écran de connexion (aucun shell requis).
5. Diagnostic : logs Render (`MYSQL CONNECTÉ` / `MYSQL EN ERREUR`) et `GET /healthz` → `db.state`.

En production, le serveur **ne démarre pas** si MySQL est absent/injoignable (mode strict) — Render affichera l'erreur dans les logs plutôt qu'un jeu sur une base éphémère.

## 13. Configuration Alwaysdata

1. Créer la base : Alwaysdata → Bases de données → ajouter une base MySQL (utf8mb4).
2. Créer/réutiliser un utilisateur avec tous les droits sur cette base.
3. Noter : hôte (ex. `mysql-xxx.alwaysdata.net`), port `3306`, utilisateur, mot de passe, nom de base.
4. Reporter ces 5 valeurs dans les variables d'environnement Render (`MYSQL_*`).
5. Rien d'autre : le schéma et les migrations sont appliqués par le serveur au démarrage.

## 14. Variables d'environnement

| Variable | Obligatoire prod | Description |
|---|---|---|
| `PORT` | non (Render l'injecte) | Port HTTP/WS |
| `NODE_ENV` | `production` sur Render | Active le mode strict DB |
| `DB_STRICT` | non | `1` force le strict ; `0` autorise le JSON (dev seulement) |
| `MYSQL_HOST` | **oui** | Hôte MySQL Alwaysdata |
| `MYSQL_PORT` | non (3306) | Port MySQL |
| `MYSQL_USER` | **oui** | Utilisateur MySQL |
| `MYSQL_PASSWORD` | **oui** | Mot de passe MySQL |
| `MYSQL_DATABASE` | **oui** | Nom de la base |
| `SESSION_SECRET` | **oui** (généré par render.yaml) | Secret de session |
| `ADMIN_BOOTSTRAP_KEY` | **oui** (généré par render.yaml) | Clé du premier admin |
| `DATA_DIR` | non | Dossier du stockage JSON dev |
| `CLIENT_DIR` | non | Dossier client servi (défaut `./client`) |
| `RATE_LIMIT_REGISTER` | non | Inscriptions max / 10 min / IP (défaut 8) |

Aucun secret n'est commis dans le projet (`.env` exclu du ZIP, secrets Render générés).

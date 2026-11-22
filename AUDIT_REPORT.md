# RIFT ARENA — RAPPORT D'AUDIT COMPLET

Date : 2026-11-22 — Audit réalisé sur le ZIP fourni (`Rift-Arena(1).zip`, 100 fichiers, 72 fichiers JS).
Méthode : lecture du code, `node --check` sur tous les JS, exécution réelle de la suite de tests,
démarrages réels du serveur (mode dev JSON + mode strict MySQL), grep systématiques de sécurité.

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

- **MySQL Alwaysdata réel** : aucune instance disponible dans la sandbox de travail. La connexion a été testée en échec contrôlé (ECONNREFUSED → comportement strict vérifié) et le code SQL est couvert indirectement par le store JSON miroir. À valider au premier déploiement Render (les logs `[db] MYSQL CONNECTÉ` et `/healthz` `state:"connected"` le confirmeront).
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

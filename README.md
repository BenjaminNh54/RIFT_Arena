# RIFT ARENA

Jeu navigateur multijoueur compétitif en temps réel — inspiré du genre "arena brawler" (vue top-down, arènes, combattants, supers), avec sa propre identité, ses personnages, ses modes et sa direction artistique.

**Creator : TB_games** · Livraison : repository complet prêt pour GitHub + Render + Alwaysdata.

---

## Présentation

RIFT ARENA est un jeu de combat en arène 100 % navigateur : pas d'installation, une SPA unique (aucun rechargement), des matchs serveur-autoritaires en WebSocket, une progression complète (trophées, Route des TR, Pass de saison, modes classés), des clans, des amis, des events configurables, un éditeur de maps communautaire et un panel d'administration intégré.

### Gameplay

- **6 combattants originaux** aux mécaniques distinctes (pas de simple variation de stats) :

| Combattant | Classe | Mécanique signature |
|---|---|---|
| **VOLT** | Assault | Bolt rapide, Super *Surge Field* (zone électrique), passif vitesse au contact |
| **VEX** | Sniper | Rail longue portée, Super *Scan Pulse* (révélation + tir perce-murs) |
| **BRAKK** | Tank | Slam en arc, Super *Shockwave* (repousse + étourdit), régén bouclier |
| **NYX** | Support | Drones chercheurs (dégâts + soin au passage), Super drone gardien, aura vitesse alliés |
| **KIRO** | Assassin | Lames en éventail, Super *Shadow Step* (dash + crit), passif adrénaline |
| **PATCH** | Engineer | Obus en cloche par-dessus les murs, Super tourelle Mk-II |

- **6 modes de jeu** avec règles réelles : Crystal Rush (3v3, cristaux + compte à rebours), Strikeball (3v3, ball + buts + prolongation), Domination (3v3, zones A/B/C), Elimination (3v3, score par élimination), Last Core (solo 8 joueurs, rift qui se réduit), Boss Raid (co-op vs boss à phases).
- **8 maps officielles** jouables : Neon Yard, Dust Canyon, Moss Temple, Core Station, Frostline, Ember Pit, Sky Circuit, Lost Factory.
- Bots de remplissage (modes normaux uniquement, clairement identifiés `BOT`, jamais en classé).
- Contrôles PC (WASD/flèches, souris, configurable) et mobile (joystick virtuel, boutons, aim assist/auto-visée/auto-attaque configurables).

### Features

- Auth username/password (scrypt), sessions sécurisées, rate limits, sanctions (ban/tempban/mute)
- Lobby complet : combattant sélectionné, mode, events, missions, amis en ligne, clan, news, monnaies
- Progression : trophées par combattant, Route des TR (paliers configurables), niveaux, maîtrise
- Mode Classé : 7 ligues (Bronze → Rift Legend), divisions, RP serveur, saisons, classement global
- Battle Pass saison 1 : 30 paliers, tracks gratuit/premium (cosmétique uniquement — pas de pay-to-win)
- Missions quotidiennes/hebdo/saison avec claim serveur, Events avec modificateurs et récompenses
- Clans (rôles/permissions/XP/guerre hebdo/chat), Amis + demandes + blocage, Groupe (party) jusqu'à 5
- Boutique (rotation quotidienne, catalogues, coffres cosmétiques), monnaies crédits/jetons
- Éditeur de maps intégré (pinceau/gomme/fill/rect/spawns/undo-redo), publication + validation admin
- Panel Admin : dashboard live, gestion joueurs/sanctions/rôles, Event Builder, news, validation maps, équilibrage combattants, config runtime, contrôles serveur (maintenance, annonces, modes/maps on-off, saisons), logs
- PWA installable (manifest + service worker + icônes), layout auto Mobile/Tablette/Desktop (forcable en Options)
- Audio procédural WebAudio (SFX + musiques lobby/match) — aucun asset externe requis

## Technologies

| Couche | Choix |
|---|---|
| Serveur | Node.js ≥ 18 (ESM), HTTP natif, WebSocket `ws` avec protocole applicatif (rooms, snapshots, heartbeats, reconnexion) |
| Simulation | Moteur maison autoritaire à tick fixe 20 Hz, snapshots 15 Hz, interpolation + prédiction côté client |
| Base de données | MySQL (Alwaysdata) via `mysql2` — **fallback JSON automatique** si non configuré (zéro config locale) |
| Client | Vanilla ES modules, Canvas 2D, aucune dépendance front, aucun build step |
| Sécurité | scrypt, tokens hasqués SHA-256, cookies httpOnly SameSite, contrôle CSRF (Origin + header), validation exhaustive des entrées, permissions serveur |
| Tests | `node --test` (unitaires + intégration match complet avec bots) |

## Structure

```
rift-arena/
├── client/                 # SPA (index.html, styles/, src/, assets/, manifest, sw.js)
│   └── src/
│       ├── app.js          # bootstrap + shell + wiring temps réel
│       ├── router.js state.js
│       ├── screens/        # auth, lobby, collection, road, ranked, pass, missions, events,
│       │                   # clan, friends, profile, shop, news, maps, settings, admin
│       ├── editor/         # éditeur de maps
│       ├── game/           # client.js (orchestrateur), renderer.js, input.js, predict.js, audio.js
│       ├── components/     # ui.js (h, modal, toasts, portraits procéduraux), icons.js (SVG)
│       └── network/        # api.js (REST + WebSocket reconnect)
├── server/src/
│   ├── index.js            # HTTP + static + WS + wiring + auto-seed
│   ├── config/ security/ auth/
│   ├── api/                # REST (auth, me, queue, fighters, road, ranked, missions, pass,
│   │                       # shop, events, news, clans, friends, party, maps, report…)
│   ├── websocket/          # gateway (auth handshake, rate limits, chat, input routing)
│   ├── matchmaking/        # queues par mode, fenêtres de rating, parties, bot fill
│   ├── game/               # engine.js (GameRoom), combat.js, movement.js, bots.js, rooms.js
│   │   └── modes/          # un module par mode (règles modulaires)
│   ├── systems/            # rewards (trophées/XP/RP/missions/events/clan), economy, social
│   ├── admin/              # API admin (permissions serveur + logs)
│   └── database/           # DAO dual-backend (mysql_store.js / json_store.js)
├── shared/                 # définitions (fighters, maps, modes), config, validateurs (client+serveur)
├── database/               # schema.sql, migrations/, migrate.js, seed.js
├── docs/                   # INSTALL, RENDER, ALWAYSdata, ADMIN, GAMEPLAY, SECURITY
├── tests/                  # tests node --test
├── scripts/                # create-admin.js, generate-icons.js
├── package.json  render.yaml  .env.example  README  LICENSE
```

## Installation locale

Aucune config nécessaire pour jouer en local (le jeu bascule sur un stockage JSON fichier) :

```bash
npm install
npm start          # → http://localhost:8080
```

Scripts utiles :

```bash
npm run dev          # node --watch (redémarrage auto)
npm test             # tests unitaires + intégration
npm run db:migrate   # applique schema.sql + migrations (MySQL requis)
npm run db:seed      # seed events/news/shop/pass/saison
npm run db:setup     # migrate + seed
npm run admin:create # premier admin (voir docs/ADMIN.md)
```

Variables d'environnement : voir `.env.example` (port, MySQL, SESSION_SECRET, ADMIN_BOOTSTRAP_KEY). **Aucun secret n'est committé.**

### Déploiement sans shell (Render free)
Aucun terminal nécessaire : le serveur applique **automatiquement** le schéma MySQL et les
migrations à chaque démarrage, et le premier admin se crée depuis l'écran de connexion
(bouton « Première installation admin » + variable d'env `ADMIN_BOOTSTRAP_KEY`).
Détails : `docs/RENDER.md` et `docs/ADMIN.md`.

## Déploiement

- **Render** : voir `docs/RENDER.md` (render.yaml fourni, `process.env.PORT` respecté, `/healthz`).
- **Alwaysdata MySQL** : voir `docs/ALWAYSdata.md` (schéma, migrations, pool, limites).
- **Premier admin** : voir `docs/ADMIN.md` (clé d'amorçage, jamais par choix de pseudo).

## Contrôles

| Action | PC | Mobile |
|---|---|---|
| Déplacement | WASD / ZQSD / Flèches (configurable) | Joystick virtuel |
| Visée | Souris | Drag bouton d'attaque + aim assist |
| Attaque | Clic gauche | Gros bouton droit |
| Capacité | Clic droit | Bouton capacité (compteur d'usages) |
| Super | Espace | Bouton étoile |
| Action contextuelle | E | Auto (kick ball) |
| Pause | Escape | — |

## PWA

Le site est installable (PC + mobile) : manifest complet, service worker avec cache versionné et shell hors-ligne, icônes générées. Le multijoueur nécessite un serveur en ligne — le mode hors-ligne affiche un état clair et ne prétend pas jouer en réseau.

## Tests

```bash
npm test
```

Couverture : validateurs, trophées/RP, missions, pass, économie, permissions admin/clan, validation de maps, moteur (mouvement/collision/dégâts/cooldowns/supers/crates), conditions de victoire des 6 modes, matchmaking avec bot fill, et un **match d'intégration complet** (auth → queue → match joué par des bots → récompenses persistées). Résultats réels affichés — rien n'est prétendu sans exécution.

## Troubleshooting

| Problème | Cause probable |
|---|---|
| `EADDRINUSE` | Port occupé → change `PORT` dans `.env` |
| Pas de MySQL | Normal en local : le log `[db] JSON store` indique le fallback |
| Les matchs ne démarrent pas | Les bots rejoignent après ~8 s en file normale ; en classé il faut de vrais joueurs |
| WebSocket fermé | Vérifie le proxy (Render gère WS nativement) et `SESSION_SECRET` persistant |

## Sécurité (résumé)

Serveur autoritaire (le client n'envoie que des intentions), mots de passe scrypt, tokens hasqués, CSRF, rate limits, validation de toutes les entrées, permissions admin côté serveur, logs d'actions sensibles, jamais de code fourni par les joueurs exécuté (maps = données validées). Détails : `docs/SECURITY.md`.

## Roadmap

- Spectateur avancé & replays
- Tournois et modes d'event supplémentaires (déjà prévus dans le moteur via modificateurs)
- Plus de combattants/maps (ajout = données, pas de refonte moteur)
- i18n EN (architecture prête), récupération de compte (sans intégration email inventée)

---

*RIFT ARENA — par TB_games. Code et assets originaux, inspirés du genre, sans contenu tiers protégé.*

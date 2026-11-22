# RENDER — déploiement

## Option A : Blueprint (recommandé)
1. Pousse le repo sur GitHub.
2. Render → New → Blueprint → sélectionne le repo : `render.yaml` crée le service Web.
3. Dans l'Environment, ajoute les variables secrètes : `SESSION_SECRET`, `MYSQL_*` (voir ALWAYSdata.md), `ADMIN_BOOTSTRAP_KEY`.
4. Déploie. Le start command est `npm start`; le port est fourni par Render via `PORT` (jamais hardcodé).

## Option B : manuel
- Type : Web Service, runtime : Node.
- Build : `npm install`
- Start : `npm start`
- Health check path : `/healthz`

## WebSocket
Render supporte les WebSockets nativement sur les Web Services. Le client se connecte à `wss://<host>/ws` avec reconnexion automatique exponentielle.

## Après le premier déploiement (sans shell — Render free)
1. **Base de données** : rien à faire — au démarrage, le serveur applique `database/schema.sql`
   et les migrations automatiquement (`[auto-migrate] schema.sql applied` dans les logs Render),
   puis insère le contenu par défaut (events, news, boutique, Pass, saison).
2. **Compte** : ouvre le site → Inscription → crée ton compte.
3. **Premier admin** : Render → Environment → ajoute `ADMIN_BOOTSTRAP_KEY` (chaîne aléatoire) et
   redéploie. Sur le site : Connexion → « Première installation admin » → colle la clé → Se connecter.
4. Les seeds sont idempotents : redémarrages et redéploiements ne dupliquent rien.

## Mode strict MySQL (production)
En production (`NODE_ENV=production`), le serveur **refuse de démarrer** si MySQL est absent ou
injoignable — plus de bascule JSON silencieuse. Les logs distinguent les 3 états :
`MYSQL CONNECTÉ`, `MYSQL EN ERREUR`, `MODE JSON LOCAL` (dev uniquement). `GET /healthz` retourne
l'état réel de la base : `{"status":"ok","db":{"mode":"mysql","state":"connected","label":"MYSQL CONNECTÉ"}}`.
Pour dépanner : vérifier les variables `MYSQL_*` (hôte/port/utilisateur/base Alwaysdata) puis
redéployer. `DB_STRICT=0` n'est prévu que pour du développement local.

## Disque
Le mode JSON (dev) écrit dans `./data` — sur Render le disque est **éphémère** : la persistance
réelle passe obligatoirement par MySQL (Alwaysdata), imposée par le mode strict.

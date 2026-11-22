# INSTALL — installation locale

## Prérequis
- Node.js ≥ 18.17 (testé avec Node 20/24)
- npm

## Démarrage rapide (zéro configuration)
```bash
npm install
npm start
```
Ouvre http://localhost:8080 — le serveur démarre sur `process.env.PORT` (défaut 8080) et utilise
un stockage JSON (`./data/store.json`) tant que MySQL n'est pas configuré. Tu peux créer un compte,
jouer (les bots remplissent les matchs normaux), progresser, tout est persisté dans le fichier JSON.

## Développement
```bash
npm run dev        # node --watch
npm test           # tests
```

## Avec MySQL (optionnel en local, requis pour la prod)
1. `cp .env.example .env` puis renseigne `MYSQL_*` et `SESSION_SECRET` (génère avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
2. `npm run db:migrate` (applique `database/schema.sql` + migrations, table `_migrations`).
3. `npm run db:seed` (events, news, boutique, pass, saison classée).
4. `npm start` — le log `[db] connected to MySQL` confirme la bascule.

## Premier admin
Voir `docs/ADMIN.md`. Résumé :
1. Crée ton compte dans le jeu (Inscription).
2. `ADMIN_BOOTSTRAP_KEY=<ta clé> npm run admin:create -- <pseudo> <motdepasse>`
3. Connecte-toi : le bouton Panel Admin apparaît dans Options.

## Dossier data
`DATA_DIR` (défaut `./data`) contient `store.json` en mode fallback. Sauvegarde-le ou supprime-le pour repartir de zéro.

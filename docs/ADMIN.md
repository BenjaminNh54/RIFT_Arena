# ADMIN — premier admin & panel

## Créer le premier admin
Le premier admin n'est **jamais** attribué par choix de pseudo. Trois méthodes sécurisées —
les deux premières ne demandent **aucun shell** (Render free, PaaS sans terminal) :

### Méthode écran de connexion (recommandée — Render free, sans shell)
1. Render → Environment : ajoute `ADMIN_BOOTSTRAP_KEY` = une longue chaîne aléatoire, puis "Manual Deploy" (ou Save + redeploy).
2. Ouvre ton site → onglet **Inscription** → crée ton compte.
3. Reviens sur Connexion → clique **« Première installation admin »** → colle la clé → **Se connecter**.
   Le compte est promu ADMIN puis connecté automatiquement. La clé est ensuite inutile
   (l'endpoint refuse tout nouveau bootstrap dès qu'un ADMIN existe).

### Méthode endpoint (scripts / Postman)
`POST /api/auth/bootstrap-admin` avec `{username, password, bootstrapKey}` — mêmes règles
(rate limit 3/10min, refuse si un ADMIN existe, clé comparée à la variable d'environnement).

### Méthode CLI (local)
1. `.env` : `ADMIN_BOOTSTRAP_KEY=<longue chaîne aléatoire>`
2. Inscris le compte dans le jeu.
3. `ADMIN_BOOTSTRAP_KEY=<la même clé> npm run admin:create -- <pseudo> <motdepasse>`
4. La commande refuse si un admin existe déjà ou si la clé/mot de passe est faux.

## Grades & permissions (vérifiés côté serveur)
| Grade | Permissions |
|---|---|
| **ADMIN** | Tout : config, events, news, maps, équilibrage, saisons, rôles, bans permanents, reset progression |
| **MODERATOR** | Voir joueurs, signalements, mute, tempban, unban (ses sanctions), chat, matchs, logs — aucune config globale, jamais d'auto-promotion |
| **HELPER** | Vue joueurs + signalements + chat uniquement |

Les actions sensibles (ban, reset, fin de saison) exigent un paramètre `confirm` et sont
journalisées dans `admin_logs` (auteur, grade, action, cible, date, détails, résultat).

## Panel
Options → Panel Admin (ou `/admin` reste dans la SPA). Onglets : Tableau de bord, Joueurs,
Signalements, Events (builder complet : dates, modificateurs whitelistés, mission, récompense),
News, Maps (validation + featured), Combattants (multiplicateurs 0.5–2.0, snapshot par match),
Config (clés runtime), Serveur (maintenance, annonces globales, modes/maps on-off, saisons), Logs.

## Modérateurs supplémentaires
Panel Admin → Joueurs → Rôle (ADMIN uniquement). Un Moderator ne peut pas s'auto-promouvoir.

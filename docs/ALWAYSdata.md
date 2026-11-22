# ALWAYSdata — MySQL

## Création
1. Alwaysdata → Bases de données → ajoute une base MySQL.
2. Crée un utilisateur dédié (pas le compte principal) avec mot de passe fort.
3. Note host (`mysql-xxx.alwaysdata.net`), base (`account_default` ou dédiée), utilisateur.

## Variables d'environnement
```
MYSQL_HOST=mysql-xxx.alwaysdata.net
MYSQL_PORT=3306
MYSQL_USER=account_user
MYSQL_PASSWORD=********
MYSQL_DATABASE=account_riftarena
```

## Schéma & migrations
```bash
npm run db:migrate   # crée toutes les tables (idempotent) + migrations numérotées
npm run db:seed      # contenu par défaut
```
La table `_migrations` garde l'historique. `schema.sql` est `IF NOT EXISTS` : ré-exécutable sans risque.

## Limites Alwaysdata (prises en compte)
- Plan free : ~100 MB — le schéma est compact ; seules les données utiles sont persistées
  (aucune frame, aucun projectile : les matchs live sont 100 % mémoire serveur).
- Connexions : pool `mysql2` limité à 10 connexions (paramétrable).
- Charset utf8mb4, InnoDB, FKs avec CASCADE sur les données joueur.

## Sécurité
- Aucun credential dans le code : tout via env.
- Requêtes 100 % paramétrées (aucune concaténation).
- L'utilisateur MySQL utilisé n'a besoin des droits que sur SA base.

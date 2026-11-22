# SECURITY

## Authentification
- Mots de passe : scrypt N=16384 (sel 16 o par utilisateur) — jamais en clair, jamais loggés.
- Sessions : token 256 bits aléatoire, stocké **hasqué SHA-256**, cookie httpOnly + SameSite=Strict (+ Secure en prod), expiration 30 j.
- Anti brute-force : rate limit login 10/min/IP, register 8/10min/IP, bootstrap 3/10min.
- Comparaison à temps constant (timingSafeEqual), chemin identique utilisateur existant/inexistant.

## API & CSRF
- Toute requête d'état (POST/PUT) exige Origin identique au Host **ou** l'en-tête `X-Requested-With` (les clients non-navigateurs des tests l'envoient).
- CORS non ouvert : pas d'`Access-Control-Allow-Origin` — seul le même site consomme l'API.

## WebSocket
- Handshake d'auth obligatoire (token) sous 5 s implicite ; messages inconnus/invalides rejetés ; 60 msg/s max par socket.
- Ban vérifié à la connexion WS et à chaque appel API.

## Autorité serveur
- Le client n'envoie jamais de position : le serveur simule tout (anti speed-hack structurel).
- Cooldowns/munitions/super : validés au tick serveur.
- Récompenses, trophées, RP, XP, missions, events, pass : calculés et persistés uniquement côté serveur.

## Injections & XSS
- SQL : 100 % requêtes paramétrées (mysql2 placeholders) ; identifiants en liste blanche.
- XSS : le rendu passe par `textContent` (helper `h`) — jamais d'innerHTML avec des données joueur ; filtre de chat + échappement de défense.
- Maps communautaires : données pures validées (`validateMapData`) — aucun code exécuté.

## Permissions
- Matrice ADMIN/MODERATOR/HELPER appliquée côté serveur (`hasPerm`), jamais côté client seul.
- Interdits structurels : Moderator ne peut pas se promouvoir, sanctionner du staff, bannir de façon permanente, toucher à la config.
- Chaque action admin → `admin_logs`.

## Secrets
- `.env` ignoré par git ; `.env.example` sans valeurs réelles ; `SESSION_SECRET` ephemeral en dev avec avertissement en prod.

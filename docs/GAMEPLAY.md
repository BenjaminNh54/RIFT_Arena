# GAMEPLAY — moteurs, modes, combattants

## Architecture réseau
- Serveur autoritaire : tick fixe 20 Hz ; le client n'envoie que des intentions (direction, visée, tir, super, capacité).
- Snapshots 15 Hz compacts ; interpolation client à 100 ms ; prédiction locale du joueur avec réconciliation douce.
- Toutes les validations (cooldowns, munitions, dégâts, collisions critiques, objectifs, récompenses) sont serveur.
- Reconnexion : la session réintègre la room si le match existe encore (grace via `userRoom`).

## Combattants (mécaniques réelles, pas des stats reskinées)
Voir le tableau du README. Chaque attaque/Super/capacité/passif est implémenté dans `server/src/game/engine.js` + `combat.js` (types génériques pilotés par les données de `shared/definitions/fighters.js`).

## Modes (un module par règle, `server/src/game/modes/`)
| Mode | Règles |
|---|---|
| Crystal Rush | Cristaux au centre, équipe qui tient 10 → compte à rebours 15 s (pausé si < 10), drop à la mort |
| Strikeball | Ball saisie/transportée/tirée (kick), 2 buts, prolongation but en or, reset 1,6 s |
| Domination | Zones A/B/C, capture par présence, contestation, 1 pt/s/zone, cible 100 |
| Last Core | 8 joueurs solo, cercle qui rétrécit (dégâts hors zone croissants), pas de respawn |
| Elimination | +1 par élimination, cible 10, respawn |
| Boss Raid | Boss 3 phases (slam, volées, anneau), pool de vies partagé, victoire = boss à terre |

## Modificateurs d'events (whitelist moteur)
`speed_mult, damage_mult, cooldown_mult, energy_mult, double_ammo, no_bushes, same_fighter, mini_fighters, no_obstacles, regen` — validés par `shared/validators`, appliqués au snapshot de config du match (les matchs en cours ne sont jamais corrompus par un changement).

## Équilibrage
Admin → Combattants : multiplicateurs PV/dégâts/vitesse/reload (0.5–2.0) stockés en config, appliqués aux nouvelles rooms.

## Performance
- Serveur : un seul interval de tick pour toutes les rooms, snapshots seulement quand dus, GC friendly (réutilisation des tableaux).
- Client : canvas unique, textures de map pré-cuites (offscreen), quality low/medium/high (particules, glow, shake), FPS cap configurable, détection mobile.

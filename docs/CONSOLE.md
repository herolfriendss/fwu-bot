# Console (`/console/`)

Page de pilotage réservée à l'OWNER. Elle lit l'état réel des bots depuis le site et permet de redémarrer chaque bot sans terminal.

## Ce qui est branché

| Section | Source | Écriture |
| --- | --- | --- |
| Contrôle, Bots | `bot_runtime_status` (rapport des bots toutes les 20 s) | Redémarrage individuel |
| Journal | codes d'événements fixes des bots (50 derniers par bot) | non |
| Activité | `bot_activity_snapshots` (instantané du bot principal toutes les 15 min) | non |
| Commandes | commandes déclarées dans `bot/` (`SLASH_COMMAND_OWNERS`, `PREFIX_COMMAND_OWNERS`) | non (lecture seule) |

Modération, Rôles, Vocal, Sécurité et Embeds restent des **aperçus locaux** : la page l'indique, refuse toute action et n'envoie rien à Discord. Les sanctions, quotas, BLR et états vocaux vivent dans la base partagée du VPS, pas dans Supabase. Les brancher demande une phase 2 : un instantané poussé par les bots, comme pour l'activité.

Hors du site (aperçu hébergé, fichier local) ou sans session, la page affiche des données de démonstration et le dit dans l'en-tête.

## Mise en route

1. Appliquer la migration `supabase/migrations/202611270001_bot_control_commands.sql` (table `bot_control_commands`, RLS activée, accès `service_role` uniquement). Sans elle, la console se lit mais le redémarrage répond « migration non appliquée ».
2. Déployer le site, puis les bots (`bot/remote-control.js` et `bot/index.js` changent).
3. Ouvrir `/console/` connecté en OWNER (lien « Console » dans la barre du site).

Rien de ce qui précède n'est appliqué automatiquement.

## Redémarrage individuel

1. Le site enregistre un ordre `restart` (OWNER connecté, double confirmation dans la page).
2. Le bot le reçoit dans la réponse de son prochain rapport de statut (20 s au plus), l'enregistre (`remote_restart`), envoie un dernier rapport puis s'arrête proprement.
3. PM2 le relance (`autorestart`), ce qui prend 20 à 40 s. La console suit les étapes : ordre déposé, reçu, redémarré.

Garde-fous :

- un seul ordre existe : `restart`. Aucun texte reçu n'est exécuté ;
- ordre périmé au bout de 2 min côté site, ignoré après 5 min côté bot ;
- 60 s minimum entre deux redémarrages du même bot, un seul ordre en attente par bot ;
- le site refuse l'ordre si le bot ne transmet plus son statut depuis 70 s (il ne pourrait pas le lire) ;
- CSRF : cookie `SameSite=Lax`, en-tête `X-Console-Action: restart` obligatoire, JSON obligatoire, requête inter-sites refusée ;
- `PND_REMOTE_RESTART=off` dans le `.env` d'un bot l'empêche d'obéir (il signale `remote_command_ignored`).

## Limites

- Un bot **totalement arrêté** ne peut pas être démarré depuis le site : il ne lit plus rien. Sur le serveur : `pm2 restart her-v5-bot` (bot principal) ou `pm2 restart fwu-<bot>`.
- Le redémarrage suppose que PM2 relance les processus (`autorestart: true`, déjà le cas dans `ecosystem.v5.config.cjs`). Un bot arrêté avec un code listé dans `stop_exit_codes` n'est pas relancé.
- La latence n'est pas remontée par les bots : la console affiche la durée de fonctionnement et l'âge du dernier signal.

## Fichiers

- Site : `src/lib/bot-control.ts`, `src/lib/bot-control.server.ts`, `src/lib/console-state.ts`, `src/lib/console-state.server.ts`, `src/routes/api/console/state.ts`, `src/routes/api/console/restart.ts`, `src/routes/api/public/bot-status.ts`.
- Bots : `bot/remote-control.js` (décision pure, testée), `bot/index.js` (`handleRemoteCommand`).
- Page : `public/console/index.html` (une seule page, sans dépendance hors polices).
- Tests : `src/test/bot-control.test.ts`, `src/test/console-state.test.ts`, `bot/remote-control.test.js`.

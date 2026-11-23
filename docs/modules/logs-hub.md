# Hub central des journaux

`bot/logs-hub.js` route chaque événement selon son serveur source vers les catégories PND ou MZ du hub. MZ reste filtré de l’allowlist et aucune connexion MZ n’est activée.

## Accès par catégorie

- `Logs Owner` et `Logs Admin` : toutes les catégories de leur espace source.
- `Logs Modération` : modération et vocal/DOG/MENOTTE.
- `Logs Économie` : économie et jeux.
- `Logs Viewer` : aucun accès par défaut.
- Les rôles MZ ont des noms distincts et ne reçoivent jamais les catégories PND, et l’inverse.

Les événements `ADMINISTRATION` et `SYSTÈMES` restent réservés aux rôles Owner/Admin. Les événements membres ne sont pas accordés au rôle économie. `@everyone`, les rôles non prévus et les overwrites de membres (hors bot) qui ouvrent une catégorie font échouer la vérification; une permission native Administrator sur un rôle Logs rend aussi la catégorie non sûre. Chaque message conserve le nom et l’identifiant de sa guilde source.

## Provisionnement et ACL existantes

Le démarrage ne réécrit pas les ACL de catégories ou salons déjà présents. Les catégories créées avec cette version reçoivent les rôles minimaux ci-dessus. `sendToLogsHub` ne transmet que si le salon est synchronisé avec une catégorie qui passe les vérifications. Une ACL ancienne trop large bloque donc l’envoi plutôt que de diffuser les événements; son examen et sa correction doivent se faire dans le hub après validation humaine, sans automatisation destructive.

Tests locaux : `node --test bot/logs-hub.test.js`. Les fixtures couvrent le routage PND/MZ, les accès par sensibilité, les rôles croisés, les membres spécifiques et Administrator. Aucun accès Discord n’est effectué par ces tests.

## Matrice de couverture (lot C)

`bot/logs-coverage.js` décrit chaque événement journalisé, son salon cible et l'intent Discord requis. `bot/logs-coverage.test.js` vérifie que chaque titre arrive dans le bon salon, que chaque événement Gateway couvert a bien un écouteur **et** son intent dans `index.js`, et que chaque titre de la matrice est réellement émis par le code. Consultable dans Discord : `/sysp diagnostic logs-couverture`.

Corrections apportées :
- **Bannissements** : l'intent `GuildModeration` manquait. Les écouteurs `guildBanAdd`/`guildBanRemove` ne se déclenchaient donc jamais. Intent ajouté (non privilégié).
- **Aiguillage** : routes explicites prioritaires. ANTI-MOVE et WAKEUP → `logs-vocaux` (avant : `logs-staff`), Guardian → `logs-securite` (avant : `logs-intelligence`), rankall et rôles → `logs-permissions`, invitations → `logs-securite`, pseudonymes → `logs-membres`.
- **Nouveaux événements** : message modifié (lien seulement, jamais le contenu), exclusion temporaire appliquée/levée, permissions d'un salon modifiées, serveur modifié (nom, vérification, 2FA, transfert de propriété…), fils créés/supprimés.
- **Alertes temps réel** : permission dangereuse nouvellement accordée à un rôle, ou ACL risquée nouvelle sur un salon (`@everyone` ou exception individuelle) → `logs-securite`. Aucune correction automatique.

Volontairement non couverts : présence vocale (en base seulement), copies de messages (confidentialité), emojis et AutoMod (intents non demandés).

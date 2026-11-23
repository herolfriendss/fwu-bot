# PND Assist V5 — progression de reprise
Date : 20 novembre 2026

## Modifications réalisées dans cette session

1. `bot/systems/sysplus/permissions.js`
   - Le rôle SYS+ ne produit plus automatiquement le tier ADMIN+.
   - `isAdminPlus()` accepte désormais PND_OWNER ou ADMIN_PLUS, pas SYS_PLUS seul.
2. `bot/systems/sysplus/admin-plus-scope-policy.js`
   - Les scopes administratifs ne sont plus accordés par simple appartenance SYS+.
   - Le Owner PND configuré conserve le bypass.
   - ADMIN+ reste soumis à la présence du rôle configuré et à l'activation du scope.
3. `bot/systems/sysplus/commands.js`
   - Attribution/retrait SYS+ réservés au Owner PND configuré, pas au propriétaire Discord de chaque guilde.
   - Configuration des rôles SYS+, ADMIN+, WHITELIST, PND Intelligence et scopes ADMIN+ explicitement réservée au Owner PND.
   - Les contraintes Discord natives et la hiérarchie des rôles restent nécessaires pour attribuer un rôle.
4. Tests de permissions adaptés à la hiérarchie confirmée.

## Chantiers toujours ouverts

- Ticket lifecycle réel sur Discord : publier panneau, créer salon privé, claim, add/remove, close, logs, suppression manuelle.
- Lecteur YouTube réel sur Discord : connexion vocale, yt-dlp installé, FFmpeg/libopus, tests play/pause/skip/queue/reconnect.
- PND Knowledge : commandes et panneaux d'information éditables pour permissions, recrutement, tickets, règlement et guide serveur.
- Panel SYS+ de rôles personnalisés avec quotas, limites de couleur/nom, permissions Discord vides et contrôles de hiérarchie.
- `/setup` : couverture de tous les modules réellement activés, avec validation et retour arrière.
- Audit des commandes slash/préfixées et des doublons de catalogue.
- Suite complète : impossible à certifier ici tant que `discord.js` n'est pas installé dans cette copie ; les tests qui importent Discord.js échouent au chargement.
- Aucun test Gateway, aucun déploiement VPS, aucune migration Supabase appliquée depuis cette session.

## Sécurité

Ne pas publier les fichiers `.env`, `bot/data/*.sqlite*`, `node_modules`, clés, tokens ou secrets. Le Owner PND ne peut pas outrepasser les permissions natives et la hiérarchie de rôles Discord du bot.

## Dernière validation exécutée

- Node.js `v24.11.1` : 43 tests ciblés réussis, 0 échec (SYS+/ADMIN+, Owner, tickets policy, réponse d'interaction, moteur/résolveur musical, Creator Studio).
- Vérification syntaxique Node.js 24 de 211 fichiers JavaScript du bot : 211 réussis, 0 échec.
- Les tests exigeant `discord.js` ne peuvent pas tous démarrer dans cette copie, car le dossier `bot/node_modules` n'est pas présent dans l'environnement de travail. Les résultats ne remplacent pas la suite complète exécutée sur le Chromebook.
- `bot/tickets.js` : prise en charge atomique d'un ticket avec condition SQL sur `claimed_by IS NULL OR claimed_by = acteur`, afin que deux agents cliquant simultanément ne puissent pas se remplacer mutuellement comme responsable. Syntaxe validée ; une recette concurrente sur SQLite/Discord reste à faire.

## Vérification complémentaire — reprise continue

- PND Knowledge est raccordé aux interactions slash et au préfixe `=knowledge` : panneau, consultation d'une rubrique et édition avec permission Gérer le serveur / propriétaire du serveur.
- Le panneau SYS+ de rôles personnalisés est raccordé au slash `/rolepanel` et au préfixe `=rolepanel`. Limite confirmée : **1 rôle par créateur**, 25 rôles suivis maximum par serveur. Les rôles sont créés avec `permissions: []`, non mentionnables et non affichés séparément.
- Le module `liveAlerts` est déclaré dans `/setup` et son traitement est raccordé au démarrage ; les URL de flux sont contrôlées comme HTTPS publiques avant sauvegarde.
- Le routeur de messages préfixés dans `bot/index.js` appelle les gestionnaires Knowledge, tickets et rôles personnalisés.
- Vérification syntaxique complémentaire avec Node 24 : **217 fichiers JavaScript contrôlés, 0 erreur de syntaxe**.
- Batterie ciblée complémentaire : 59 tests réussis. Deux fichiers de tests qui importent `panel-setup.js` n'ont pas pu démarrer car `discord.js` est absent de cette copie (`ERR_MODULE_NOT_FOUND`). Les tests unitaires de politique `/setup` eux-mêmes passent.
- Les tests ne valident pas l'exécution réelle des interactions Discord. Les flux Gateway, les permissions effectives, les créations/suppressions de salons et la lecture audio doivent encore être vérifiés sur un serveur de recette.
- Audit du catalogue TypeScript : **87 commandes racine uniques sur 100 autorisées**. Le décompte initial brut incluait des sous-commandes imbriquées ; il ne correspondait pas au nombre de commandes racine Discord.
- Tentative de réinstallation reproductible des dépendances (`npm ci --ignore-scripts`) : interrompue par expiration du délai dans cet environnement. Aucun `node_modules` n'a été conservé dans l'archive.

## Préparation migration Oracle — 20 novembre 2026

- VPS confirmé actif par l'utilisateur ; compte Oracle confirmé Free.
- Le déploiement actuel du dépôt est monolithique : `her-v5-web` + `her-v5-bot`. Le script de déploiement existant est explicitement un script de production monolithique.
- Création de `deploy/oracle/inspect-host.sh` : diagnostic en lecture seule de l'OS, architecture, CPU, RAM, disque, Node, npm, PM2, ports et métadonnées OCI.
- Création de `deploy/oracle/FOUR_BOT_MIGRATION_RUNBOOK.md` : plan de migration, responsabilités, garde-fous, recette et bascule réversible.
- Création de `deploy/oracle/FOUR_BOT_ENV.template` : modèle sans secrets.
- Aucun accès SSH au VPS n'a été effectué et aucune modification distante n'a été réalisée.

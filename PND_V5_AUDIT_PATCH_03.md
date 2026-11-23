# PND Assist V5 — Audit Patch 03

## Corrections incluses

- SYS+ distingue désormais le propriétaire PND unique des deux cofondateurs : `PND_OWNER_DISCORD_ID` donne le tier PND_OWNER ; `PND_COFOUNDER_DISCORD_IDS` donne SYS+/ADMIN+ sans droits réservés au propriétaire.
- Les actions owner-only (dashboard OAuth, ajustements PND, packs/entitlements, Marketplace propriétaire et `/rankall`) restent réservées à l'Owner. Les cofondateurs gardent les accès SYS+ usuels mais ne peuvent pas exécuter ces actions owner-only.
- Le script de déploiement exige les nouvelles variables, identiques dans `.env` et `bot/.env`, et valide un Owner + deux Cofounders distincts.
- `/wakeup` et `=wakeup` passent désormais par la politique SYS+/ADMIN+ du module vocal.
- ADMIN+ doit avoir le scope vocal activé et conserver la permission Discord `Déplacer des membres`.
- La hiérarchie ADMIN+ est contrôlée avant le déplacement ; le bot et le membre ciblé doivent pouvoir accéder au salon de destination.
- Les destinations vocales privées sont refusées pour WAKEUP.
- Chaque déplacement WAKEUP est envoyé au journal central.
- La commande slash est normalisée en `/wouaf` (au lieu de `/waouf`). Les réponses WOUAF affichent maintenant le pseudonyme du membre dont le message vient d'être remplacé ; les mentions globales restent désactivées.
- Le Logs Hub possède désormais des destinations dédiées `logs-tickets`, `logs-verification` et `logs-webhooks`.
- `sendCentralLog` tente également le Logs Hub central, tout en conservant le salon local de compatibilité.
- Le routeur de logs évite le double envoi dans le chemin `auditLog`.

## Vérifications

- Syntaxe JavaScript : fichiers modifiés vérifiés avec `node --check`.
- Tests ciblés : 57/57 réussis (séparation Owner/Cofounders, SYS+/ADMIN+, entitlements, Creator, WAOUF, Logs Hub, logger central, scopes ADMIN+ et parser vocal).
- L'environnement d'audit utilise Node 22.16.0 ; le projet exige Node >=24. Le test de routage slash complet n'a pas pu charger `discord.js` absent de l'environnement. Les tests complets et la compilation de production restent à refaire sous Node 24 avec les dépendances installées.

## Travail restant

- Migrer la configuration privée du VPS vers `PND_OWNER_DISCORD_ID` + `PND_COFOUNDER_DISCORD_IDS` dans les deux fichiers `.env` (les fichiers `.env` ne sont pas inclus dans l'archive).
- Réduire réellement le nombre de commandes racine Discord. Cette opération nécessite de migrer ensemble le catalogue partagé, les routeurs slash du bot et le catalogue du dashboard. Les commandes existantes n'ont pas été supprimées dans ce patch afin de ne perdre aucune fonctionnalité.
- Vérifier les nouveaux salons du Logs Hub sur le serveur Discord réel : la mise à jour du code ne crée les salons qu'au prochain démarrage du bot avec les permissions `Gérer les salons` et `Gérer les rôles`.
- La commande publique WOUAF est renommée `/wouaf` pour correspondre à l'orthographe demandée ; le nom interne du module et de ses tables reste inchangé pour préserver les données existantes.

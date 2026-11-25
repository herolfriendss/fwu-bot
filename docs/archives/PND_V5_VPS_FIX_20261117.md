# PND Assist V5 — correctif préalable VPS (17/11/2026)

## Correctif code

- `bot/voice-v2.js` : `/voc lock` passait une variable `bot` inexistante au service commun de verrouillage. Elle est remplacée par `interaction.client`, le client Discord déjà fourni par l'interaction. Sans cette correction, le chemin `/voc lock` pouvait échouer avec `ReferenceError: bot is not defined`.

## Vérifications locales

- `node --check` sur les 194 fichiers JavaScript du bot : 0 erreur.
- Tests ciblés Voice Access / permissions / Voice V2 : 9/9 réussis.
- Suite du bot : 308 tests détectés, 285 réussis, 23 empêchés au chargement car `discord.js` n'est pas installé dans l'environnement de validation local (`ERR_MODULE_NOT_FOUND`). Il faut installer les dépendances sur le VPS ou dans un environnement Node 24 connecté, puis relancer la suite.
- L'environnement de validation local est Node 22.16.0 / npm 10.9.2 ; le projet déclare Node >=24.

## Installation sur le VPS

- L'archive source est complète et exclut volontairement `.env`, `bot/.env`, `bot/data`, `node_modules`, `.git` et les builds locaux.
- Le script `scripts/pnd-vps-preflight.sh` est en lecture seule : il affiche versions, état PM2 (noms/statuts uniquement), présence des fichiers sensibles sans en afficher le contenu, espace disque et accès au registre npm.
- L'installation ne doit être lancée qu'après contrôle du bon répertoire du projet, de la version Node 24+, des processus PM2 et de la connectivité npm. Les sauvegardes des fichiers d'environnement et de la base SQLite doivent précéder le remplacement des sources.

## État d'exécution

Aucune session SSH/console VPS n'est connectée à cette conversation. Aucun fichier ou service distant n'a été touché, aucun processus PM2 n'a été redémarré, et aucune migration ni déploiement n'a été effectué.

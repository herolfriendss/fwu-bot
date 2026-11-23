# Déploiement Oracle

Le guide du déploiement monolithique historique reste dans ce dossier.

`inspect-host.sh` est un diagnostic en lecture seule : il n'installe rien, ne change aucun service et n'affiche aucun secret.

**Ne pas lancer quatre copies de `bot/index.js`.** La séparation des routeurs, schedulers et stores doit être terminée avant d'ajouter les processus PM2 dédiés.

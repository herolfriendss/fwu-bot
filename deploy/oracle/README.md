# Déploiement Oracle

Le guide du déploiement monolithique historique reste dans ce dossier.

`inspect-host.sh` est un diagnostic en lecture seule : il n'installe rien, ne change aucun service et n'affiche aucun secret.

**Ne pas lancer quatre copies de `bot/index.js`.** La séparation des routeurs, schedulers et stores doit être terminée avant d'ajouter les processus PM2 dédiés.


## Audit de sécurité en lecture seule

Pour examiner le VPS Oracle sans modifier son état, depuis la racine du dépôt :

```bash
bash deploy/oracle/security-audit.sh
```

Le script vérifie notamment PM2, les ports TCP en écoute, le pare-feu local, la configuration SSH effective, les services de sécurité, les mises à jour DNF, les permissions des fichiers sensibles et la présence des sauvegardes/surveillances. Il n'affiche aucune valeur de secret et ne modifie ni fichiers, ni services, ni règles réseau, ni bases de données.

À lancer avec l'utilisateur Unix qui possède PM2 (habituellement `opc`). Certaines informations peuvent être incomplètes sans privilèges élevés ; le script le signale. Les Security Lists / NSG Oracle doivent être vérifiés séparément dans la console OCI.


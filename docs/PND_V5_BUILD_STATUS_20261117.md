# PND Assist V5 — état du build et du déploiement (17 novembre 2026)

## Correctifs et préparation intégrés

- Le packaging du bot suit désormais tout `bot/` et conserve les dépendances via `bot/package-lock.json`; les `.env` réels, dépendances, bases SQLite, données runtime, VCS et caches sont exclus des archives.
- Ajout du modèle racine `.env.example`, auparavant absent alors que les instructions d’installation le demandaient.
- Modèles `.env.example` dashboard et bot harmonisés : token Discord partagé, `BOT_SYNC_SECRET` identique, un propriétaire PND et deux cofondateurs distincts, clé webhook dédiée et allowlist limitée au serveur PND et au hub de logs.
- Ajout de `scripts/deploy-pnd-v5-oracle.sh` : validation Node 24+, vérification des variables sans afficher les secrets, confirmation explicite que les migrations Supabase sont appliquées, sauvegarde des environnements et données SQLite, installation `npm ci`, tests complets, TypeScript, build, packaging bot, activation PM2 V5 et contrôle HTTP local.
- Le script refuse `PND_MZ_ENABLED=true` et les IDs de guildes hors liste PND/hub de logs.
- ANTI-MOVE individuel disponible en commandes slash et préfixées ; restauration conservatrice uniquement sur preuve claire du journal d’audit.

## Vérifications réalisables dans cet environnement

- `node --check` sur tous les fichiers JavaScript du bot : réussi.
- Tests ciblés ANTI-MOVE et permissions SYS+ : 16/16 réussis.
- Suite bot exécutée : 316 tests au total, 293 réussis et 23 bloqués avant les assertions par `ERR_MODULE_NOT_FOUND` sur `discord.js` (dépendance absente/incomplète ici).
- Archive source régénérée après les correctifs : 486 fichiers, CRC ZIP valide ; secrets, bases SQLite et `node_modules` absents.

## Blocages externes à cet environnement

- Le runtime disponible est Node.js 22.16.0, tandis que le projet exige Node.js `>=24`.
- Les installations npm ont expiré : accès DNS/réseau au registre npm indisponible ici ; `vite` et `discord.js` ne sont donc pas pleinement installés.
- Aucun onglet Oracle Cloud ni terminal SSH n’est connecté à cette conversation. Aucun fichier distant, processus PM2, bot Discord, base Supabase ou service de production n’a été modifié.

## Ordre d’installation sur le VPS

1. Déposer cette archive dans le répertoire du projet, sans écraser `.env`, `bot/.env` ou `bot/data/`.
2. Appliquer toutes les migrations de `supabase/migrations/` dans Supabase, dans l’ordre.
3. Copier les modèles `.env.example`, remplir les variables, puis `chmod 600 .env bot/.env`.
4. Avec Node 24+, npm et l’accès au registre, lancer : `PND_SUPABASE_MIGRATIONS_APPLIED=YES bash scripts/deploy-pnd-v5-oracle.sh`.
5. Vérifier `pm2 status`, `pm2 logs her-v5-bot --lines 80`, puis les commandes Discord sur PND.

L’archive est un paquet source prêt à être installé ; elle n’est pas un build dashboard validé ni une preuve de déploiement en production.

# PND Assist V5 — feuille de route d'implantation (19–20 novembre 2026)

## Règle de sécurité

Cette archive est une préparation. Aucun accès VPS, redémarrage PM2, changement de DNS, migration Supabase ou déploiement de production n'a été effectué depuis cette session. Ne lancer l'implantation qu'après les contrôles locaux et le backup pré-déploiement.

## Cibles connues à préserver

- VPS : Oracle Linux 9.8, utilisateur SSH `opc`.
- Répertoire de production V5 : `/home/opc/her-v5-production`.
- Répertoire d'arrivée : `/home/opc/her-v5-incoming`.
- Staging historique : `/home/opc/her-v5-staging`.
- Processus PM2 V5 : `her-v5-web` et `her-v5-bot`.
- Serveur Discord PND autorisé : `1562643485981544559`.
- Hub de logs : `1570484435239833701`.
- Serveur MZ : `1505904703563894814` — doit rester exclu / désactivé.
- V4 et ses données ne doivent pas être supprimés ni arrêtés par le déploiement V5.

Les chemins et états PM2 sont les dernières valeurs connues et doivent être confirmés par le preflight en lecture seule avant toute opération.

## Étape A — sur le PC / Chromebook

1. Extraire l'archive complète dans un nouveau dossier.
2. Ouvrir un terminal dans `PND_Assist_V5_FINAL_UPDATED`.
3. Vérifier `node -v` : le projet exige Node.js `>=24` (référence historique : `v24.22.2`, npm `11.19.1`).
4. Lancer `./PREPARER_TESTS_PND.sh`.
5. Ne pas transférer pour production si le script ne termine pas avec toutes les étapes vertes. Lire `PND_V5_LOCAL_TEST_REPORT.txt` et corriger les échecs.

## Étape B — contrôle VPS sans changement

Depuis le PC, se connecter avec la clé SSH habituelle (ne jamais copier la clé privée ou un mot de passe dans le chat) puis :

```bash
cd /home/opc/her-v5-production
bash scripts/pnd-vps-preflight.sh
pm2 status
```

Vérifier en particulier Node 24, npm, l'espace disque, la connectivité au registre npm, la présence des deux `.env`, les processus V5 et leur `cwd`. Si les processus ne pointent pas vers `/home/opc/her-v5-production`, arrêter la procédure et diagnostiquer avant de continuer.

## Étape C — sauvegarde AVANT de remplacer le code

Cette étape doit être exécutée sur la version actuellement en production, avant toute extraction ou synchronisation de nouveaux fichiers :

```bash
cd /home/opc/her-v5-production
bash scripts/backup-pnd-v5-before-update.sh
```

Le script vérifie les processus PM2 V5 et leur chemin, arrête brièvement uniquement `her-v5-bot` pour capturer SQLite/WAL de façon cohérente, archive le projet courant avec les deux `.env` et `bot/data`, applique les permissions privées, puis redémarre le bot. Il ne remplace aucun fichier et ne déploie rien.

Ne pas poursuivre si le script de sauvegarde échoue ou si le bot ne revient pas `online`. Conserver le chemin exact de la sauvegarde affiché par le script.

## Étape D — transfert et préparation du code

Transférer le ZIP validé depuis le PC vers `/home/opc/her-v5-incoming/`. Extraire dans un sous-dossier temporaire et vérifier que le contenu attendu se trouve dans `PND_Assist_V5_FINAL_UPDATED/` :

```bash
mkdir -p /home/opc/her-v5-incoming/release
unzip -t /home/opc/her-v5-incoming/PND_Assist_V5_PRET_POUR_TESTS.zip
unzip -q /home/opc/her-v5-incoming/PND_Assist_V5_PRET_POUR_TESTS.zip -d /home/opc/her-v5-incoming/release
```

Après le backup de l'étape C et seulement si l'archive est celle qui a passé les tests PC, synchroniser le code en préservant les secrets, la base SQLite et les dépendances installées :

```bash
rsync -a --delete \
  --exclude='/.env' --exclude='/bot/.env' --exclude='/bot/data/' \
  --exclude='/node_modules/' --exclude='/bot/node_modules/' --exclude='/.output/' \
  /home/opc/her-v5-incoming/release/PND_Assist_V5_FINAL_UPDATED/ \
  /home/opc/her-v5-production/
```

Avant synchronisation, vérifier que l'archive est bien celle qui a passé les tests sur PC. Les exclusions empêchent de supprimer `.env`, `bot/.env`, `bot/data/` et les dépendances existantes. Le backup complet pré-déploiement reste obligatoire. Conserver le répertoire V4.

## Étape E — migrations Supabase

Avant le démarrage de la nouvelle version, effectuer une sauvegarde de la base Supabase depuis le projet Supabase. Puis examiner et appliquer, dans l'ordre lexical, les six fichiers SQL de `supabase/migrations/` :

1. `202610300002_sysplus_role.sql`
2. `202611010001_discord_interaction_receipts.sql`
3. `202611010002_sysplus_audit_grants.sql`
4. `202611020001_bot_runtime_guilds.sql`
5. `202611040001_bot_economy_snapshots.sql`
6. `202611120001_bot_ai_memory.sql`

Appliquer chaque migration une seule fois et vérifier son résultat dans Supabase. Ne pas affirmer qu'elles sont appliquées sans vérification. Le script de déploiement ne les exécute pas ; le paramètre `PND_SUPABASE_MIGRATIONS_APPLIED=YES` est une confirmation manuelle après leur application.

## Étape F — configuration à contrôler sans publier les secrets

Les fichiers `.env` et `bot/.env` restent sur le VPS et ne doivent pas être inclus dans l'archive ni envoyés dans le chat.

- `PND_OWNER_DISCORD_ID` : identifiant du propriétaire unique, identique dans les deux fichiers.
- `PND_COFOUNDER_DISCORD_IDS` : exactement deux IDs distincts, identiques dans les deux fichiers et différents de l'Owner.
- `V4_ALLOWED_GUILD_IDS` : `1562643485981544559,1570484435239833701` uniquement (le hub de logs peut être omis si la configuration retenue le prévoit, mais aucun troisième serveur).
- `PND_MZ_ENABLED=false`.
- `BOT_SYNC_SECRET` identique dans `.env` et `bot/.env`, longueur minimale 32 caractères.
- `DISCORD_BOT_TOKEN` dans `.env` identique à `DISCORD_TOKEN` dans `bot/.env`.
- `SITE_URL` et `DISCORD_OAUTH_REDIRECT_URI` en HTTPS et de même origine.
- `WEBHOOK_ENCRYPTION_KEY` : 64 caractères hexadécimaux.
- `SESSION_SECRET` distinct de `BOT_SYNC_SECRET`, longueur minimale 32 caractères.
- `DISCORD_INTERACTIONS_PUBLIC_KEY` vide pour le mode passerelle du bot Oracle.
- Les clés Supabase publiques et service-role doivent être celles du bon projet ; la service-role ne doit jamais être exposée dans une variable `VITE_`.

## Étape G — déploiement contrôlé

Uniquement après A–F, et depuis la racine exacte `/home/opc/her-v5-production` :

```bash
cd /home/opc/her-v5-production
PND_SUPABASE_MIGRATIONS_APPLIED=YES bash scripts/deploy-pnd-v5-oracle.sh
```

Le script exige Node 24, les fichiers `.env`, les secrets synchronisés, l'allowlist PND, et les migrations confirmées. Il installe avec les lockfiles, lance les tests bot, le lint, les tests dashboard, TypeScript et le build, puis recharge les processus PM2 V5. Il vérifie que les processus `her-v5-*` existants pointent déjà vers la racine cible. Il ne doit pas arrêter/supprimer les anciens processus V4.

## Étape H — recette après déploiement

```bash
pm2 status
pm2 logs her-v5-bot --lines 100 --nostream
pm2 logs her-v5-web --lines 100 --nostream
curl -I http://127.0.0.1:3000/
```

Puis vérifier sur Discord dans le serveur PND uniquement :

- Bot connecté et commandes slash synchronisées (pas de commandes racine au-delà de la limite Discord).
- SYS+/ADMIN+ : Owner, cofondateurs, membres SYS+, membres ADMIN+ et membres ordinaires ; vérifier explicitement les refus owner-only.
- `/rank`, `/rankall`, `/wakeup`, `/wouaf` et leurs équivalents préfixés.
- Tickets : création, accès privé, prise en charge, fermeture, transcript/log et suppression contrôlée.
- Vérification : panneau, CAPTCHA/réaction selon la configuration, attribution du rôle et refus des permissions insuffisantes.
- Webhooks et Logs Hub : tickets, vérification, modération, vocal, rôles, économie et erreurs.
- IA : réponse, mémoire avec consentement, refus sans consentement, permissions, erreurs API et limites.
- Vocal, musique/radio, économie, automations et dashboard.
- Vérifier que le serveur MZ reste désactivé et que le serveur V4 n'a pas été touché.

## Retour arrière

En cas d'échec applicatif, ne pas supprimer les sauvegardes. Arrêter les processus V5 concernés, restaurer l'archive `pnd-v5-before-update.tar.gz` dans le répertoire de production, réinstaller les dépendances depuis les lockfiles, reconstruire le dashboard puis recharger PM2. Les migrations Supabase ne sont pas automatiquement annulées : toute restauration de schéma doit être planifiée séparément à partir de la sauvegarde Supabase.

## État connu au moment de la préparation

- L'archive source Patch 03 a été ouverte et son CRC ZIP est valide.
- Le paquet bot autonome a été régénéré : 227 fichiers, CRC valide, sans `.env`, `node_modules`, SQLite ou fichiers de clés détectés.
- Les scripts shell de déploiement et de backup passent `bash -n`.
- L'environnement de préparation courant est Node `v22.16.0` / npm `10.9.2`. `PREPARER_TESTS_PND.sh` s'arrête immédiatement, avant toute installation, car Node 24 minimum est requis. Les tests complets n'ont donc pas été validés dans cet environnement.
- Aucun VPS ni compte Supabase n'a été contacté et aucune opération de production n'a été exécutée.

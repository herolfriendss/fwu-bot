# Déploiement Oracle Linux 9

Ce guide prépare l’hôte uniquement lorsque tu décideras de déployer. Rien ici n’a été exécuté sur Oracle.

## 1. Préparer le projet

Dans le dossier du projet, avec Node 24 LTS :

```bash
npm ci
npm ci --prefix bot
cp .env.example .env
cp bot/.env.example bot/.env
chmod 600 .env bot/.env
```

Le dépôt fournit `package-lock.json` pour le dashboard et `bot/package-lock.json` pour le bot. Conserve ces fichiers pour des installations reproductibles ; `npm ci` et `npm ci --prefix bot` installent exactement les versions verrouillées.

Renseigne les fichiers `.env` avec un éditeur de confiance. Génère `SESSION_SECRET` et `BOT_SYNC_SECRET` avec des valeurs aléatoires distinctes d’au moins 32 octets. La même valeur `BOT_SYNC_SECRET` doit figurer dans les deux fichiers. Configure les clés Discord et Supabase dans `.env`, puis le token Discord, l’URL HTTPS finale et `PND_ALLOWED_GUILD_ID` dans `bot/.env`. Cette dernière variable est obligatoire : elle doit contenir l’identifiant Snowflake du serveur principal PND. Sans identifiant valide, le bot refuse de démarrer ; les autres serveurs sont quittés automatiquement. Ne renseigne pas l’identifiant du serveur MZ.

## 2. Appliquer les migrations

Applique les migrations de `supabase/migrations/` à la base Supabase du projet, dans l’ordre chronologique, avant d’activer l’endpoint d’interactions slash. La migration `202611010001_discord_interaction_receipts.sql` ajoute la table d’idempotence des commandes signées et `202611040001_bot_economy_snapshots.sql` ajoute l’instantané PND du dashboard. Ne remplace pas une base existante sans sauvegarde préalable.

## 3. Compiler puis démarrer

```bash
npm run build
npm install --global pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`pm2 startup` affiche la commande système à exécuter une fois avec `sudo`. Nginx doit terminer TLS et proxyfier vers `127.0.0.1:3000`; un exemple est dans `deploy/oracle/nginx-her-v3.conf`. Configure DNS et HTTPS avant de renseigner `SITE_URL` dans `bot/.env`.

**Mode recommandé (bot Oracle 24/7)** : laisse l’URL d’interaction vide dans le portail Discord. Discord envoie alors les commandes slash à la passerelle du bot, qui peut les exécuter avec SQLite (économie, DOG, vocal, musique, radio). Si une URL d’interaction est configurée, Discord envoie toutes les interactions à l’endpoint HTTP et ne les transmet plus à la passerelle : les commandes générales fonctionnent, mais les commandes avec état répondent qu’elles nécessitent le bot Oracle. Ne configure donc pas les deux modes en même temps sans raison.

Commandes de suivi :

```bash
pm2 status
pm2 logs her-v3-web
pm2 logs her-v3-bot
pm2 restart her-v3-web her-v3-bot
```

## 4. Sauvegardes et mises à jour

Sauvegarde régulièrement `bot/data/economy.sqlite`, `bot/data/dog-state.json`, `bot/data/voice-locks.json` et `bot/data/radio-config.json`. La base SQLite utilise WAL : arrête proprement le bot ou crée un instantané cohérent avec `sqlite3 bot/data/economy.sqlite ".backup /chemin-securise/economy.sqlite"`. Un export JSON en lecture seule est aussi disponible avec `npm --prefix bot run export:economy -- /chemin-securise/economy-export.json`. Stocke une copie chiffrée hors de l’instance Oracle.

Avant une mise à jour, sauvegarde les deux fichiers `.env`, le dossier `bot/data/` et la base Supabase. Mets à jour le code, réinstalle les dépendances avec `npm ci` puis `npm ci --prefix bot` à la racine du dépôt, compile avec `npm run build`, puis redémarre PM2. N’inclus jamais `.env`, `node_modules` ou les données utilisateur dans une archive publique.

## Permissions Discord requises

Active les intents **Message Content** et **Server Members**. Selon les fonctions utilisées, le bot a besoin de Voir les salons, Envoyer des messages, Gérer les messages, Exclure temporairement des membres, Gérer les surnoms, Gérer les rôles, Déplacer les membres, Se connecter et Parler. Place son rôle au-dessus des rôles qu’il doit gérer ; `/dog` (ou `=dog`) crée un rôle système sans permission puis l’attribue aux membres en laisse.

Un admin configure la radio PartyNextDoor depuis Discord avec `/radio set` (ou `=radio set #salon URL_PLAYLIST_YOUTUBE`). Utilise une playlist YouTube accessible et conserve le dossier `bot/data/radio-config.json` ; le bot la relance au démarrage. Les commandes `/radio start`, `/radio stop` et `/radio clear` sont réservées aux admins / Gérer le serveur. Les contrôles musicaux classiques sont suspendus tant que la radio tourne.

## Limites avant ouverture publique

- Le dashboard est réservé à son propriétaire via `DASHBOARD_PASSWORD`; il utilise le cookie de session et le middleware CSRF du projet.
- SQLite PND est local à une instance : ne lance qu’un seul processus bot sur cette base et ne mets pas le bot en cluster PM2.
- Les réglages bot passent par le dashboard/Supabase; web et bot doivent partager le secret correct.
- Valide d’abord dans un serveur Discord privé et une base Supabase de test.

# Déploiement Oracle Linux 9

Ce guide prépare l’hôte uniquement lorsque tu décideras de déployer. Rien ici n’a été exécuté sur Oracle.

## 1. Préparer le projet

Dans le dossier du projet, avec Node 24 LTS :

```bash
npm install
npm --prefix bot install
cp .env.example .env
cp bot/.env.example bot/.env
chmod 600 .env bot/.env
```

Cette archive source ne contient pas de `package-lock.json` : le réseau DNS npm était indisponible lors de sa préparation. Le premier `npm install` résout les dépendances selon `package.json` et génère les fichiers lock. Conserve ces fichiers pour les mises à jour suivantes; une release de production reproductible devra être recompilée après génération et revue de ces locks.

Renseigne les fichiers `.env` avec un éditeur de confiance. Génère `SESSION_SECRET` et `BOT_SYNC_SECRET` avec des valeurs aléatoires distinctes d’au moins 32 octets. La même valeur `BOT_SYNC_SECRET` doit figurer dans les deux fichiers. Configure les clés Discord et Supabase dans `.env`, puis le token Discord et l’URL HTTPS finale dans `bot/.env`.

## 2. Appliquer les migrations

Applique les migrations de `supabase/migrations/` à la base Supabase du projet, dans l’ordre chronologique, avant d’activer l’endpoint d’interactions slash. La migration `202611010001_discord_interaction_receipts.sql` ajoute la table d’idempotence des commandes signées. Ne remplace pas une base existante sans sauvegarde préalable.

## 3. Compiler puis démarrer

```bash
npm run build
npm install --global pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`pm2 startup` affiche la commande système à exécuter une fois avec `sudo`. Nginx doit terminer TLS et proxyfier vers `127.0.0.1:3000`; un exemple est dans `deploy/oracle/nginx-her-v3.conf`. Configure DNS et HTTPS avant de renseigner `SITE_URL` dans `bot/.env` et l’URL d’interaction dans le portail Discord.

Commandes de suivi :

```bash
pm2 status
pm2 logs her-v3-web
pm2 logs her-v3-bot
pm2 restart her-v3-web her-v3-bot
```

## 4. Sauvegardes et mises à jour

Sauvegarde régulièrement `bot/data/economy.sqlite`, `bot/data/dog-state.json`, `bot/data/voice-locks.json` et `bot/data/radio-config.json`. La base SQLite utilise WAL : arrête proprement le bot ou crée un instantané cohérent avec `sqlite3 bot/data/economy.sqlite ".backup /chemin-securise/economy.sqlite"`. Stocke une copie chiffrée hors de l’instance Oracle.

Avant une mise à jour, sauvegarde les deux fichiers `.env`, le dossier `bot/data/` et la base Supabase. Mets à jour le code, réinstalle avec `npm install` et `npm --prefix bot install`, compile, puis redémarre PM2. N’inclus jamais `.env`, `node_modules` ou les données utilisateur dans une archive publique.

## Permissions Discord requises

Active les intents **Message Content** et **Server Members**. Selon les fonctions utilisées, le bot a besoin de Voir les salons, Envoyer des messages, Gérer les messages, Exclure temporairement des membres, Gérer les surnoms, Gérer les rôles, Déplacer les membres, Se connecter et Parler. Place son rôle au-dessus des rôles qu’il doit gérer; `=dog` crée un rôle système sans permission puis l’attribue aux membres en laisse.

Un admin configure la radio PartyNextDoor depuis Discord avec `=radio set #salon URL_PLAYLIST_YOUTUBE`. Utilise une playlist YouTube accessible et conserve le dossier `bot/data/radio-config.json`; le bot la relance au démarrage. Les commandes `=radio start`, `=radio stop` et `=radio clear` sont réservées aux admins / Gérer le serveur. Les contrôles musicaux classiques sont suspendus tant que la radio tourne.

## Limites avant ouverture publique

- Le dashboard est réservé à son propriétaire via `DASHBOARD_PASSWORD`; il utilise le cookie de session et le middleware CSRF du projet.
- SQLite PND est local à une instance : ne lance qu’un seul processus bot sur cette base et ne mets pas le bot en cluster PM2.
- Les réglages bot passent par le dashboard/Supabase; web et bot doivent partager le secret correct.
- Valide d’abord dans un serveur Discord privé et une base Supabase de test.

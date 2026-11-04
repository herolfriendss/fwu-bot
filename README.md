# Her? V4

Her? V4 est l’évolution directe de Her? V3 : même dashboard, même bot Oracle, même base Supabase et même économie SQLite. Aucun second projet ni service parallèle n’est nécessaire. Le dossier V2 reste conservé pour référence.

Les secrets sont fournis par des fichiers `.env` locaux, jamais par l’archive de déploiement.

## Prérequis

- Oracle Linux 9 ou Linux compatible
- Node.js 24 LTS et npm
- PM2 et Nginx pour Oracle
- Un projet Supabase avec les migrations de `supabase/migrations`
- Les clés Discord/Lovable nécessaires au dashboard

Node 24 est requis par le bot V4, qui utilise SQLite de `node:sqlite` pour conserver PND sur disque.

## Installation et compilation

```bash
cp .env.example .env
npm install
npm run build
```

Le build génère un serveur Nitro autonome pour Node dans `.output/server/index.mjs`. Pour installer le bot localement :

```bash
npm --prefix bot install
cp bot/.env.example bot/.env
npm --prefix bot start
```

Le bot a besoin de son jeton Discord, de l’URL HTTPS du dashboard et du même `BOT_SYNC_SECRET` que le dashboard.

## Déploiement Oracle

Consulte [`deploy/oracle/README.md`](deploy/oracle/README.md) pour PM2, Nginx, les migrations Supabase et les sauvegardes. Applique les migrations avant d’activer les interactions slash.

Ne remplace pas `.env`, `bot/.env` ni `bot/data/` lors d’une mise à jour. `bot/data/economy.sqlite` contient les soldes PND et doit être sauvegardé.

## Fonctionnalités V4

- **Commandes slash** pour l’économie, DOG, le vocal, la musique, la radio et SYS+, avec les mêmes règles et les mêmes données que les commandes préfixées.
- **Transition douce** : les anciennes commandes `=` restent disponibles pendant la migration.
- **Dashboard PND** : masse totale, classement et boutique affichés depuis un instantané borné ; SQLite reste la source de vérité.
- **Sauvegarde PND** : `npm --prefix bot run export:economy` produit un export JSON en lecture seule.
- Modération, commandes préfixées et réponses configurées dans le dashboard.
- DOG : `/dog`, `/undog`, `/doginfo` (et `=dog`, `=undog`, `=doginfo`), avec rôle serveur persistant et surnom rétabli par le bot.
- Vocal : `/access`, `/unaccess`, `/panel`, `/pv`.
- Musique YouTube : `/play`, contrôles de lecture, file plafonnée à 100 titres et cooldown utilisateur.
- Radio PartyNextDoor 24/7 : `/radio set`, `/radio status`, puis autoredémarrage et boucle playlist.
- PND : `/balance`, `/daily`, `/pay`, `/leaderboard`, `/shop`, `/buy`, `/inventory`, `/pnd`.
- Jeux : `/roulette mise choix`, `/blackjack mise`.
- SYS+ : `/sysp panel`, `/sysp role`, `=sysp`.

PND est une monnaie virtuelle propre à chaque serveur. SQLite est local à l’hôte ; une seule instance du bot doit écrire dans cette base.

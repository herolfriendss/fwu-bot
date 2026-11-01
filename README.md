# Her? V3

Her? V3 regroupe le dashboard web et le processus Discord autonome. Le projet V2 reste conservé dans son dossier d’origine. Les secrets sont fournis par des fichiers `.env` locaux, jamais par l’archive de déploiement.

## Prérequis

- Oracle Linux 9 ou Linux compatible
- Node.js 24 LTS et npm
- PM2 et Nginx pour Oracle
- Un projet Supabase avec les migrations de `supabase/migrations`
- Les clés Discord/Lovable nécessaires au dashboard

Node 24 est requis par le bot V3, qui utilise SQLite de `node:sqlite` pour conserver PND sur disque.

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

## Fonctionnalités V3

- Modération, commandes préfixées et réponses configurées dans le dashboard.
- DOG : `=dog`, `=undog`, `=doginfo`, avec rôle serveur persistant et surnom rétabli par le bot.
- Vocal : `=access`, `=unaccess`, `=panel`, `=pv`.
- Musique YouTube : commandes de lecture, file plafonnée à 100 titres et cooldown utilisateur.
- Radio PartyNextDoor 24/7 : `=radio set #salon URL_PLAYLIST_YOUTUBE`, puis autoredémarrage et boucle playlist; admin : `=radio start|stop|clear`, statut : `=radio status`.
- PND : `=balance`, `=daily`, `=pay @membre montant`, `=leaderboard`, `=shop`, `=shop add @Rôle prix`, `=buy @Rôle`, `=inventory`, `=pnd add|remove|set @membre montant`.
- Jeux : `=roulette mise red|black|green`, `=blackjack mise`.
- SYS+ : `=sysp role @Rôle`, `=sysp`.

PND est une monnaie virtuelle propre à chaque serveur. SQLite est local à l’hôte; une seule instance du bot doit écrire dans cette base.

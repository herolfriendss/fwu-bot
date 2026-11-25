> **Mise en production FWU : lire d'abord `MISE_EN_PRODUCTION.md`** (4 étapes), puis `RECETTE_STAGING.md` (liste à cocher) et `DECISIONS.md` (décisions en vigueur). Les anciens rapports sont dans `docs/archives/`.

# FWU

FWU (anciennement PND Assist, 1942, Her? V3/V4/V5) : un bot Discord en 5 applications (FWU, GUARD, FDPDLAVOC, SUCK ME, LE FISC) et son site de configuration. Voir `MULTI_BOTS_FWU.md`.

## Historique

PND Assist V5 conserve les systèmes stables de Her? V4 et poursuit leur évolution directe depuis Her? V3 : même dashboard, même bot Oracle, même base Supabase et même économie SQLite. Aucun second projet ni service parallèle n’est nécessaire. Le dossier V2 reste conservé pour référence.

Les secrets sont fournis par des fichiers `.env` locaux, jamais par l’archive de déploiement.

## Prérequis

- Oracle Linux 9 ou Linux compatible
- Node.js 24 LTS et npm
- PM2 et Nginx pour Oracle
- Un projet Supabase avec les migrations de `supabase/migrations`
- Les clés Discord/Lovable nécessaires au dashboard

Node 24 est requis par le bot V5, qui utilise SQLite de `node:sqlite` pour conserver PND sur disque.

## Installation et compilation

```bash
cp .env.example .env
npm ci
npm run build
```

Le build génère un serveur Nitro autonome pour Node dans `.output/server/index.mjs`. Pour installer le bot localement :

```bash
npm --prefix bot ci
cp bot/.env.example bot/.env
npm --prefix bot start
```

Le bot a besoin de son jeton Discord, de l’URL HTTPS du dashboard et du même `BOT_SYNC_SECRET` que le dashboard.

## Déploiement Oracle

Consulte [`deploy/oracle/README.md`](deploy/oracle/README.md) pour PM2, Nginx, les migrations Supabase et les sauvegardes. Le script `scripts/deploy-pnd-v5-oracle.sh` exécute les contrôles, sauvegarde les fichiers privés, installe les lockfiles, lance les tests et le build avant d’activer les processus PM2 V5. Applique les migrations avant d’activer les interactions slash.

Ne remplace pas `.env`, `bot/.env` ni `bot/data/` lors d’une mise à jour. `bot/data/economy.sqlite` contient les soldes PND et doit être sauvegardé.

## Fonctionnalités héritées de la V4

- **Commandes slash** pour l’économie, DOG, le vocal, la musique, la radio et SYS+, avec les mêmes règles et les mêmes données que les commandes préfixées.
- **Préfixes** : FWU est en slash uniquement ; GUARD `+`, FDPDLAVOC `;`, SUCK ME `=`, LE FISC `-` (voir `MULTI_BOTS_FWU.md`).
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

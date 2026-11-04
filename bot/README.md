# Her? V4 — processus Discord

Nécessite Node.js 24 LTS. Le bot synchronise les réglages depuis le dashboard, applique DOG/vocal/modération, lit YouTube, répond aux commandes slash et conserve le portefeuille PND dans `data/economy.sqlite`.

## Installation isolée

```bash
npm install
cp .env.example .env
chmod 600 .env
# renseigner DISCORD_TOKEN, SITE_URL et BOT_SYNC_SECRET
npm start
```

Pour PM2, le fichier `ecosystem.config.cjs` à la racine du projet démarre le dashboard et le bot ensemble. Ne lance jamais plusieurs processus bot sur la même base SQLite.

## Commandes slash V4

Le bot enregistre les commandes au démarrage en fusionnant chaque définition (jamais de `PUT` global). Les commandes interactives (économie, DOG, vocal, musique, radio, SYS+) nécessitent ce processus 24/7.

- Économie : `/balance [membre]`, `/daily`, `/pay membre montant`, `/leaderboard`, `/shop voir|ajouter|retirer`, `/buy rôle`, `/inventory`, `/pnd ajouter|retirer|definir`.
- Jeux : `/roulette mise choix`, `/blackjack mise` puis boutons **Tirer** / **Rester**.
- DOG : `/dog membre`, `/undog membre`, `/doginfo membre`.
- Vocal : `/access membre`, `/unaccess membre`, `/panel`, `/pv`.
- Musique : `/play`, `/pause`, `/resume`, `/skip`, `/queue`, `/volume`, `/loop`, etc. File limitée à 100 titres et cooldown utilisateur.
- Radio : `/radio set #salon URL_PLAYLIST_YOUTUBE`, `/radio start`, `/radio stop`, `/radio clear`, `/radio status`. La configuration est stockée dans `data/radio-config.json`.
- SYS+ : `/sysp panel`, `/sysp role rôle`.

Les commandes préfixées `=` restent disponibles pendant la transition et partagent exactement la même logique métier.

## Export de l’économie

```bash
npm run export:economy -- /chemin/economy-export.json
```

Le script ouvre `data/economy.sqlite` en lecture seule et produit un JSON de sauvegarde. Il ne modifie jamais les soldes. `ECONOMY_DB=/autre/chemin.sqlite` permet de cibler une autre base.

Pour DOG, le bot crée un rôle système sans permission pour marquer les membres en laisse et rétablit surnom/rôle au retour de ses événements. Le bot a besoin des intents **Message Content** et **Server Members**, ainsi que des permissions Discord adaptées à chaque module.

`data/economy.sqlite`, `data/dog-state.json`, `data/voice-locks.json` et `data/radio-config.json` sont des données persistantes locales. Elles ne sont pas dans l’archive de code ; sauvegarde-les sur l’hôte.

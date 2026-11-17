# PND Assist V5 — processus Discord

Le bot est privé et doit rester limité au serveur principal PND. Le serveur MZ est hors périmètre.

Nécessite Node.js 24 LTS. Le bot synchronise les réglages depuis le dashboard, applique DOG/vocal/modération, lit YouTube, répond aux commandes slash et conserve le portefeuille PND dans `data/economy.sqlite`. `PND_ALLOWED_GUILD_ID` est obligatoire : indique l’identifiant Discord du serveur PND principal. Sans cet identifiant valide, le processus refuse de démarrer. Tout autre serveur est quitté, y compris ceux présents lors d’un redémarrage.

## Installation isolée

```bash
npm install
cp .env.example .env
chmod 600 .env
# renseigner DISCORD_TOKEN, SITE_URL, BOT_SYNC_SECRET et PND_ALLOWED_GUILD_ID
npm start
```

Pour PM2, le fichier `ecosystem.config.cjs` à la racine du projet démarre le dashboard et le bot ensemble. Ne lance jamais plusieurs processus bot sur la même base SQLite.

## Commandes slash et préfixées

Le bot enregistre les commandes au démarrage en fusionnant chaque définition (jamais de `PUT` global). Les commandes interactives (économie, DOG, vocal, musique, radio, SYS+) nécessitent ce processus 24/7.

- Économie : `/balance [membre]`, `/daily`, `/pay membre montant`, `/leaderboard`, `/shop voir|ajouter|retirer`, `/buy rôle`, `/inventory`, `/pnd ajouter|retirer|definir`.
- Jeux : `/roulette mise choix`, `/blackjack mise` puis boutons **Tirer** / **Rester**.
- DOG : `/dog membre`, `/undog membre`, `/doginfo membre`.
- Vocal : `/access membre`, `/unaccess membre`, `/panel`, `/pv`.
- Demandes d’accès : `/voice-request-panel` publie un bouton dans le chat du vocal ou dans un salon textuel général. Le demandeur indique le salon (ID ou lien) depuis le panneau général ; si le chat du vocal est visible avec Voir le salon, Envoyer des messages et Lire l’historique, la demande y est publiée directement. Le propriétaire, les administrateurs, les membres ayant Gérer les salons ou le rôle SYS+ peuvent approuver/refuser. Les demandes expirent après 24 h et sont conservées en SQLite.
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

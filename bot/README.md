# Her? V3 — processus Discord

Nécessite Node.js 24 LTS. Le bot synchronise les réglages depuis le dashboard, applique DOG/vocal/modération, lit YouTube et conserve le portefeuille PND dans `data/economy.sqlite`.

## Installation isolée

```bash
npm install
cp .env.example .env
chmod 600 .env
# renseigner DISCORD_TOKEN, SITE_URL et BOT_SYNC_SECRET
npm start
```

Pour PM2, le fichier `ecosystem.config.cjs` à la racine du projet démarre le dashboard et le bot ensemble. Ne lance jamais plusieurs processus bot sur la même base SQLite.

## Commandes

- Économie : `=balance [@membre]`, `=daily`, `=pay @membre montant`, `=leaderboard`.
- Boutique de rôles : `=shop`, `=shop add @Rôle prix`, `=shop remove @Rôle`, `=buy @Rôle`, `=inventory`.
- Administration PND (Administrateur ou Gérer le serveur) : `=pnd add|remove|set @membre montant`.
- Jeux : `=roulette mise red|black|green`, `=blackjack mise` puis boutons **Tirer** / **Rester**.
- Radio : `=radio set #salon URL_PLAYLIST_YOUTUBE`, `=radio start`, `=radio stop`, `=radio clear`, `=radio status`. La configuration est stockée dans `data/radio-config.json`; la radio reprend au redémarrage et reboucle la playlist.
- DOG : `=dog @membre`, `=undog @membre`, `=doginfo @membre`.
- Vocal : `=access @membre`, `=unaccess @membre`, `=panel`, `=pv`.
- Musique : lecture et contrôles YouTube usuels (`=play`, `=pause`, `=resume`, `=skip`, `=queue`, `=volume`, `=loop`, etc.). File limitée à 100 titres et cooldown utilisateur. Les contrôles musique sont désactivés pendant la radio.
- SYS+ : `=sysp role @Rôle`, `=sysp`.

Pour DOG, le bot crée un rôle système sans permission pour marquer les membres en laisse et rétablit surnom/rôle au retour de ses événements. Le bot a besoin des intents **Message Content** et **Server Members**, ainsi que des permissions Discord adaptées à chaque module.

`data/economy.sqlite`, `data/dog-state.json`, `data/voice-locks.json` et `data/radio-config.json` sont des données persistantes locales. Elles ne sont pas dans l’archive de code; sauvegarde-les sur l’hôte.

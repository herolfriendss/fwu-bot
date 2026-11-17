# PND Assist V5 — processus Discord

Le bot est privé et doit rester limité au serveur principal PND. Le serveur MZ est hors périmètre.

Nécessite Node.js 24 LTS. La présence Discord tourne toutes les 45 secondes entre trois éléments d’identité PND : PND Assist, la communauté PND et l’invitation `discord.gg/fwu`. Le bot synchronise les réglages depuis le dashboard, applique DOG/vocal/modération, lit YouTube, répond aux commandes slash et conserve le portefeuille PND dans `data/economy.sqlite`. `PND_ALLOWED_GUILD_ID` est obligatoire : indique l’identifiant Discord du serveur PND principal. Sans cet identifiant valide, le processus refuse de démarrer. Tout autre serveur est quitté, y compris ceux présents lors d’un redémarrage.

## Installation isolée

```bash
npm ci
cp .env.example .env
chmod 600 .env
# renseigner DISCORD_TOKEN, SITE_URL, BOT_SYNC_SECRET et PND_ALLOWED_GUILD_ID
npm start
```

Pour PM2, le fichier `ecosystem.config.cjs` à la racine du projet démarre le dashboard et le bot ensemble. Ne lance jamais plusieurs processus bot sur la même base SQLite.

## Commandes slash et préfixées

Le bot enregistre les commandes intégrées uniquement dans le serveur PND configuré (`PND_ALLOWED_GUILD_ID`) : elles ne sont plus publiées globalement. Au démarrage, il retire du catalogue global uniquement les noms de commandes intégrées qu’il gère, sans supprimer les commandes personnalisées du dashboard, puis les fusionne une par une dans PND (jamais de `PUT` global). Les commandes interactives (économie, DOG, vocal, musique, radio, SYS+) nécessitent ce processus 24/7.

- Économie : `/balance [membre]`, `/daily`, `/pay membre montant`, `/leaderboard`, `/shop voir|ajouter|retirer`, `/buy rôle`, `/inventory`, `/pnd ajouter|retirer|definir`.
- Jeux : `/roulette mise choix`, `/blackjack mise` puis boutons **Tirer** / **Rester**.
- DOG : `/dog membre`, `/undog membre`, `/doginfo membre`.
- Protect : `/protect role @Rôle`, `/protect status`, `/protect reset`, `/protect strikes [membre]`, `/protect reset-strikes [membre]`. Le rôle Protect, les rôles intouchables configurés et le propriétaire ne peuvent pas être sanctionnés. Les sanctions warn/mute/unmute/kick/ban sont réservées aux rôles staff sélectionnés dans le dashboard (plus SYS+ et propriétaire), avec hiérarchie stricte et vérification des permissions réelles du bot. Une tentative sur un membre protégé est bloquée : 1re fois avertissement privé, 2e timeout 5 minutes, 3e retrait des rôles staff configurés et du rôle SYS+ si attribué, uniquement si le bot a Gérer les rôles et peut effectivement retirer les rôles. Les compteurs sont stockés par serveur et modérateur ; les administrateurs / propriétaire peuvent les consulter ou les réinitialiser avec les deux commandes dédiées. Les rôles staff et intouchables se configurent dans Modules V4 > Modération. `/dog` et `/undog` (ainsi que `=dog` / `=undog`) exigent que le rôle le plus élevé de l’exécutant soit strictement supérieur à celui de la cible ; les membres de même rang ou plus élevés sont protégés. Le propriétaire du serveur reste l’exception. Le rôle technique DOG est ignoré dans ce calcul afin que la laisse puisse être retirée. Le rôle le plus élevé du bot doit lui aussi rester supérieur à celui de la cible. Le retrait de la laisse avec `/undog` ou `=undog` est réservé au rôle Perm SYS+ configuré (ou au propriétaire du serveur) ; un simple droit Gérer les surnoms ne suffit pas.
- Vocal : `/access membre`, `/unaccess membre`, `/panel`, `/pv`.
- Demandes d’accès : `/voice-request-panel` publie un bouton dans le chat du vocal ou dans un salon textuel général. Le demandeur indique le salon (nom exact, ID ou lien) depuis le panneau général ; si le chat du vocal est visible avec Voir le salon, Envoyer des messages et Lire l’historique, la demande y est publiée directement. Publie le panneau dans le chat du salon vocal pour une demande ciblée, ou dans un salon textuel accessible à tous comme entrée générale pour les salons cachés. Le propriétaire, les administrateurs, les membres ayant Gérer les salons ou le rôle SYS+ peuvent approuver/refuser. Les demandes expirent après 24 h, sont conservées en SQLite et chaque membre peut avoir au maximum trois demandes simultanées en attente.
- Musique : `/play`, `/pause`, `/resume`, `/skip`, `/queue`, `/volume`, `/loop`, etc. File limitée à 100 titres et cooldown utilisateur.
- Radio : `/radio set #salon URL_PLAYLIST_YOUTUBE`, `/radio start`, `/radio stop`, `/radio clear`, `/radio status`. La configuration est stockée dans `data/radio-config.json`.
- SYS+ : `/sysp panel`, `/sysp role rôle`.

Les commandes préfixées `=` restent disponibles pendant la transition et partagent exactement la même logique métier.

Les commandes de modération préfixées utilisent les mêmes rôles staff autorisés, la même hiérarchie et les mêmes protections Protect que les commandes slash :

- `=warn @membre raison` et `=warnings [@membre]` (la durée par défaut suit le réglage `warnExpiryDays` du dashboard)
- `=mute @membre 10m raison` et `=unmute @membre raison` (durée acceptée : minutes, heures ou jours, maximum 28 jours)
- `=kick @membre raison` et `=ban @membre raison`
- `=clear 1-100` (alias `=purge`), `=slowmode 0-21600`, `=lock` et `=unlock`

Les sanctions sur un membre protégé restent bloquées et déclenchent exactement le compteur Protect ; les commandes de gestion des salons exigent les permissions correspondantes sur le membre et sur le bot.

## Export de l’économie

```bash
npm run export:economy -- /chemin/economy-export.json
```

Le script ouvre `data/economy.sqlite` en lecture seule et produit un JSON de sauvegarde. Il ne modifie jamais les soldes. `ECONOMY_DB=/autre/chemin.sqlite` permet de cibler une autre base.

Pour DOG, le bot crée un rôle système sans permission pour marquer les membres en laisse et rétablit surnom/rôle au retour de ses événements. Le bot a besoin des intents **Message Content** et **Server Members**, ainsi que des permissions Discord adaptées à chaque module.

`data/economy.sqlite`, `data/dog-state.json`, `data/voice-locks.json` et `data/radio-config.json` sont des données persistantes locales. Elles ne sont pas dans l’archive de code ; sauvegarde-les sur l’hôte.

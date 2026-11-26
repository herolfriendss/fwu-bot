# FWU V2 — matrice de complétude

Générée par `node --experimental-strip-types --no-warnings bot/scripts/completeness-matrix.mjs`. Ne pas éditer à la main.

Légende : ✅ présent · ▫️ absent ou non détecté · « pont » = la commande slash répond avec le préfixe du bot via `prefix-slash-bridge.js`.
Aide : toute commande du catalogue apparaît dans `/aide` et dans le guide. `/setup` : la commande a un réglage dans le panneau de configuration.
Logs typés : le module qui la traite journalise avec une catégorie. Tests : la commande est citée dans un test.

## Résumé par bot

| Bot | Commandes | Préfixe | Aide | /setup | Logs typés | Tests |
|---|---|---|---|---|---|---|
| Bot principal | 10 | slash seul (décision 21) | 10/10 | 0/10 | 7/10 | 10/10 |
| GUARD | 19 | 19/19 | 19/19 | 1/19 | 8/19 | 19/19 |
| FDPDLAVOC | 16 | 16/16 | 16/16 | 1/16 | 9/16 | 14/16 |
| SUCK ME | 67 | 67/67 | 67/67 | 4/67 | 20/67 | 50/67 |
| LE FISC | 32 | 32/32 | 32/32 | 0/32 | 1/32 | 20/32 |
| Invest + | 2 | 2/2 | 2/2 | 0/2 | 0/2 | 2/2 |

## Détail

| Bot | Commande | Slash | Préfixe | Aide | /setup | Logs typés | Tests |
|---|---|---|---|---|---|---|---|
| Bot principal | `/tempmute` | ✅ | — (slash seul) | ✅ | ▫️ | ✅ | ✅ |
| Bot principal | `/unmute` | ✅ | — (slash seul) | ✅ | ▫️ | ✅ | ✅ |
| Bot principal | `/warn` | ✅ | — (slash seul) | ✅ | ▫️ | ✅ | ✅ |
| Bot principal | `/warnings` | ✅ | — (slash seul) | ✅ | ▫️ | ✅ | ✅ |
| Bot principal | `/sanction` | ✅ | — (slash seul) | ✅ | ▫️ | ✅ | ✅ |
| Bot principal | `/sanction-type` | ✅ | — (slash seul) | ✅ | ▫️ | ✅ | ✅ |
| Bot principal | `/quota` | ✅ | — (slash seul) | ✅ | ▫️ | ✅ | ✅ |
| Bot principal | `/embed` | ✅ | — (slash seul) | ✅ | ▫️ | ▫️ | ✅ |
| Bot principal | `/reglement` | ✅ | — (slash seul) | ✅ | ▫️ | ▫️ | ✅ |
| Bot principal | `/screening` | ✅ | — (slash seul) | ✅ | ▫️ | ▫️ | ✅ |
| GUARD | `/guildguard` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| GUARD | `/kick` | ✅ | ✅ dédié | ✅ | ✅ | ✅ | ✅ |
| GUARD | `/ban` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| GUARD | `/blacklist` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| GUARD | `/purge` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| GUARD | `/nettoyer` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| GUARD | `/slowmode` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| GUARD | `/lock` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| GUARD | `/unlock` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| GUARD | `/verify` | ✅ | ✅ pont | ✅ | ▫️ | ✅ | ✅ |
| GUARD | `/antinuke` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| GUARD | `/automod` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| GUARD | `/casier` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| GUARD | `/quarantaine` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| GUARD | `/bouclier` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| GUARD | `/piege` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| GUARD | `/raid` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| GUARD | `/scan` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| GUARD | `/panic` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| FDPDLAVOC | `/voice` | ✅ | ✅ pont | ✅ | ▫️ | ✅ | ✅ |
| FDPDLAVOC | `/voc` | ✅ | ✅ pont | ✅ | ✅ | ▫️ | ✅ |
| FDPDLAVOC | `/music` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| FDPDLAVOC | `/radio` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| FDPDLAVOC | `/effet` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ▫️ |
| FDPDLAVOC | `/playlist` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| FDPDLAVOC | `/dj` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| FDPDLAVOC | `/accessall` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| FDPDLAVOC | `/mvall` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| FDPDLAVOC | `/mvrole` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| FDPDLAVOC | `/pull` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| FDPDLAVOC | `/swap` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ▫️ |
| FDPDLAVOC | `/muteall` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| FDPDLAVOC | `/unmuteall` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| FDPDLAVOC | `/vclear` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| FDPDLAVOC | `/undo` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/sysp` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/panel` | ✅ | ✅ pont | ✅ | ✅ | ✅ | ✅ |
| SUCK ME | `/setup` | ✅ | ✅ pont | ✅ | ✅ | ▫️ | ✅ |
| SUCK ME | `/knowledge` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/rank` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/rankall` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/removerole` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ▫️ |
| SUCK ME | `/rolepanel` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ▫️ |
| SUCK ME | `/staffhistory` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/vocalpresence` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/lockname` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/webhook` | ✅ | ✅ pont | ✅ | ▫️ | ✅ | ▫️ |
| SUCK ME | `/automation` | ✅ | ✅ dédié | ✅ | ✅ | ▫️ | ✅ |
| SUCK ME | `/anti-moove` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/wakeup` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/dog` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/undog` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/doginfo` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/wouaf` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ▫️ |
| SUCK ME | `/menotte` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/unmenotte` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/menotteinfo` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/dmall` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/undogall` | ✅ | ✅ pont | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/roletemp` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/annonce` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/staff` | ✅ | ✅ pont | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/pseudo` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/maj` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/ia` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/ticket` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/candidature` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/sondage` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/profil` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/bio` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/rep` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/toprep` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/color` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/academy` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/award` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/story` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/radar` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/wrapped` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/giveaway` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/event` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/pndevent` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/afk` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/live` | ✅ | ✅ dédié | ✅ | ✅ | ▫️ | ✅ |
| SUCK ME | `/niveau` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/suggestion` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/anniversaire` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/rappel` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/stats` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/confession` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/moi` | ✅ | ✅ pont | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/fwu` | ✅ | ✅ pont | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/clan` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/saison` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/quete` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ▫️ |
| SUCK ME | `/anim` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/outils` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/logs` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/dossier` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/blr` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| SUCK ME | `/guide` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/pourquoi` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| SUCK ME | `/presence` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/balance` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/daily` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/work` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/job` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/bank` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| LE FISC | `/history` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| LE FISC | `/rob` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| LE FISC | `/lottery` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| LE FISC | `/pay` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/leaderboard` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| LE FISC | `/inventory` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| LE FISC | `/shop` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/buy` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| LE FISC | `/pnd` | ✅ | ✅ dédié | ✅ | ▫️ | ✅ | ✅ |
| LE FISC | `/roulette` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/blackjack` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/business` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/invest` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/casino` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/impots` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ▫️ |
| LE FISC | `/pret` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ▫️ |
| LE FISC | `/duel` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/pari` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ▫️ |
| LE FISC | `/avantage` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ▫️ |
| LE FISC | `/dice` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/coinflip` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/trivia` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/cards` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/card` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ▫️ |
| LE FISC | `/pack` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/trade` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| LE FISC | `/jeu` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |
| Invest + | `/abonnement` | ✅ | ✅ dédié | ✅ | ▫️ | ▫️ | ✅ |
| Invest + | `/investadmin` | ✅ | ✅ pont | ✅ | ▫️ | ▫️ | ✅ |


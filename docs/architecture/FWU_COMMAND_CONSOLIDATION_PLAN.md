# FWU — plan de consolidation du catalogue de commandes

## État audité

Le catalogue actuel contient 145 commandes racines uniques sur six applications. Chaque application conserve les commandes communes /aide et /status. Il n'y a actuellement ni doublon, ni commande sans propriétaire, et chaque bot reste sous la limite Discord de 100 commandes racines.

Le problème produit n'est donc pas un dépassement de quota : c'est la dispersion des commandes et la difficulté à retenir leurs noms. La consolidation doit améliorer la navigation sans supprimer de capacités ni déplacer une commande vers une application qui ne la possède pas.

## Cibles de regroupement proposées

| Application | Racines cibles | Familles à regrouper |
|---|---|---|
| FWU | moderation, embeds, reglement, screening, quota | warn, warnings, sanction, sanction-type, tempmute, unmute sous moderation ; garder les outils de contenu sous leurs commandes dédiées si leur UX est déjà claire |
| GUARD | moderation, security, verification | ban, kick, purge, nettoyer, slowmode, lock, unlock, casier, quarantaine sous moderation ; guildguard, antinuke, automod, blacklist, bouclier sous security ; verify sous verification |
| FDPDLAVOC | music, radio, voice | play, pause, resume, skip, stop, queue, nowplaying, volume, loop, shuffle, clearqueue, remove, join, leave, effet, playlist, dj sous music ; access, unaccess, pv, voc sous voice |
| SUCK ME | sysp, roles, voice, community, events, profile | rank, rankall, removerole, rolepanel, roletemp sous roles ; dog, undog, doginfo, wouaf, menotte, unmenotte, menotteinfo, wakeup, anti-moove sous voice ; ticket, candidature, suggestion, confession, rep, toprep sous community ; event, pndevent, giveaway, anniversaire, rappel, live sous events ; profil, bio, moi, stats, wrapped sous profile |
| LE FISC | economy, casino, cards, games | balance, daily, work, job, bank, history, rob, lottery, pay, leaderboard, inventory, shop, buy, pnd, business, invest, impots, pret, avantage sous economy ; roulette, blackjack, casino, duel, pari, dice, coinflip sous casino ; cards, card, pack, trade sous cards ; trivia et jeu sous games |
| Invest + | subscription, investadmin | abonnement sous subscription ; administration des formules conservée sous investadmin |

## Méthode de migration

1. Construire une table explicite ancien nom → nouvelle racine et sous-commande, incluant chaque option, permission, handler et profil propriétaire.
2. Ajouter les nouvelles racines sans retirer les anciennes routes dans le même commit.
3. Faire converger les nouvelles routes vers les fonctions métier existantes ; ne pas dupliquer la logique de permissions ou les écritures SQLite.
4. Adapter les gestionnaires slash pour router les sous-commandes, avec tests d'autorisation, de validation et de réponse.
5. Conserver les commandes préfixées historiques comme alias de compatibilité ; documenter les équivalences.
6. Comparer automatiquement le catalogue avant/après : aucune fonctionnalité ne peut disparaître, aucune route ne peut changer de propriétaire sans décision explicite.
7. Déployer la nouvelle interface seulement après CI et recette staging. Le présent chantier ne publie aucune commande sur Discord et ne modifie pas le setup des applications.

## Garde-fous Discord

- Discord autorise au maximum 100 commandes racines par application et 25 options/sous-commandes par niveau.
- Un groupe ne doit pas mélanger sous-commandes directes et groupes de sous-commandes au même niveau.
- Les noms historiques restent résolus côté préfixe pendant la période de transition.
- Les commandes destructives et les actions d'administration conservent leurs autorisations actuelles et leurs confirmations.
- Les six profils restent séparés : aucune commande GUARD ne devient une commande SUCK ME, et Invest + reste facultative.

## Priorité

La première migration concrète doit être une famille à forte densité mais faible couplage, après cartographie des handlers. La famille musique (FDPDLAVOC) et la famille économie (LE FISC) sont candidates ; la consolidation SUCK ME sera découpée en plusieurs lots pour limiter le risque.

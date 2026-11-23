# Audit des équivalents préfixés

## Périmètre

Le catalogue slash contient 100 commandes racine. Les commandes peuvent être prises en charge par le pont `bot/v4-commands.js`, par un gestionnaire natif qui traite aussi les messages, ou par une route dédiée dans `bot/index.js`. Une simple recherche textuelle ne suffit pas à certifier l'équivalence : certaines commandes sont distribuées entre plusieurs modules.

## État confirmé dans le routeur de messages

- Tickets : `=ticket panel|list|close|add|remove|help`.
- PND Knowledge : `=knowledge panel|show|edit`.
- Rôles personnalisés : `=rolepanel panel|create|rename|color|delete`.
- Rôles : `=rank`, `=addrole`, `=removerole`, `=rankall`.
- Jeux : `=dice`, `=coinflip`, `=trivia`, `=giveaway`, `=event`.
- Automatisation : `=automation`.
- LOCKNAME : `=lockname` et `=unlockname`.
- WAOUF : `=wouaf` via le gestionnaire dédié, avec restriction aux salons autorisés.
- Musique, radio, économie, social, cartes, vocal, DOG/MENOTTE et SYS+ disposent de gestionnaires préfixés dans leurs modules respectifs.

## À terminer

Les commandes de modération (`warn`, `warnings`, `mute`, `unmute`, `kick`, `ban`, `purge`, `slowmode`, `lock`, `unlock`, `verify`) et GuildGuard restent principalement pilotées par interactions slash/boutons. Elles ne doivent pas être déclarées « équivalentes préfixe » tant qu'un routeur message réutilisant exactement les mêmes contrôles de permission, hiérarchie, confirmation, journaux et erreurs n'est pas testé.

Les commandes utilitaires (`aide`, `status`, `sondage`, `nettoyer`) nécessitent également une vérification dédiée de leur disponibilité préfixée.

## Règle de validation

Pour chaque commande, vérifier :

1. même action métier et mêmes options ;
2. permissions revérifiées depuis un membre Discord frais ;
3. hiérarchie de rôles et position du bot ;
4. confirmations pour les actions destructives ou globales ;
5. réponse adaptée au contexte public (ne pas exposer les informations privées d'une réponse éphémère) ;
6. journalisation et isolation par serveur ;
7. test unitaire de parsing et test d'intégration sur bot de recette.

# FWU — plan de consolidation du catalogue de commandes

## État audité

Le catalogue actuel contient 145 commandes racines uniques sur six applications. Chaque application conserve les commandes communes /aide et /status. Il n'y a actuellement ni doublon, ni commande sans propriétaire, et chaque bot reste sous la limite Discord de 100 commandes racines.

Le problème produit n'est donc pas un dépassement de quota : c'est la dispersion des commandes et la difficulté à retenir leurs noms. La consolidation doit améliorer la navigation sans supprimer de capacités ni déplacer une commande vers une application qui ne la possède pas.

## Cibles de regroupement proposées

| Application | Racines cibles globalement uniques | Familles à regrouper |
|---|---|---|
| FWU | `admin` | modération, embeds, règlement, screening, quotas |
| GUARD | `guard` | modération, sécurité, vérification |
| FDPDLAVOC | `music`, `voice`, `voc`, `radio` | lecture musicale, accès vocaux, salons temporaires, radio |
| SUCK ME | `sysp`, `staff`, `community`, `events`, `profile` | SYS+, rôles/staff, communauté/tickets, événements, profils |
| LE FISC | `fisc`, `games` | économie, entreprises, fiscalité, investissements virtuels, jeux/cartes |
| Invest + | `investplus` | abonnements et administration des avantages |

Les racines doivent rester uniques à l'échelle des six applications, car le runtime actuel utilise une table globale nom de commande → application. Les sous-commandes peuvent partager les mêmes noms sans conflit. Les anciens `/fwu` de SUCK ME et `/invest` du FISC seront déplacés comme sous-commandes de leur racine propriétaire avant d'être retirés.

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

## Migration 1 — musique FDPDLAVOC

- État : **implémentée sur la branche de développement**, à valider par CI.
- Les 15 commandes racines du lecteur sont regroupées sous `/music player` : play, pause, resume, skip, stop, queue, nowplaying, volume, loop, shuffle, clearqueue, remove, join, leave et panel.
- Les anciens noms préfixés restent disponibles et continuent d'appeler les mêmes fonctions métier.
- Les anciens noms slash sont marqués comme retirés pour éviter qu'ils restent enregistrés sur l'application après une future mise en production.
- `/radio`, `/effet`, `/playlist` et `/dj` restent séparés pour cette première migration afin de préserver leurs parcours spécialisés.
- Le catalogue passe de 145 à 131 racines uniques ; FDPDLAVOC passe de 25 à 11 commandes racines communes comprises.

## Migration 2 — accès vocal FDPDLAVOC

- État : **implémentée sur la branche de développement**, à valider par CI.
- `/access`, `/unaccess` et `/pv` sont regroupées sous `/voice access` et `/voice private`.
- Les routes préfixées `;access`, `;unaccess`, `;pv` et `;unpv` restent disponibles et leurs aides sont traduites vers les nouveaux chemins slash.
- `/voc` et ses sous-commandes de salons temporaires restent inchangées.

## État actuel du catalogue

Les deux premiers lots regroupent 18 anciennes commandes racines sous `/music player` et `/voice`, sans retirer les commandes préfixées historiques. Le catalogue est maintenant à **129 racines uniques** sur les six applications ; FDPDLAVOC passe de 25 à 9 racines communes comprises. Les commandes slash historiques seront nettoyées uniquement lors d'une future synchronisation applicative, jamais par ce chantier sur le serveur en fonctionnement.

## Architecture de propriété

Le runtime actuel utilise une table globale nom de commande → application. Les futures racines consolidées doivent donc rester uniques entre applications, même si leurs sous-commandes peuvent porter des noms identiques. Toute évolution de ce modèle devra être accompagnée d'une migration de l'audit et des tests de propriété.

## Priorité suivante

Après validation de cette première migration, poursuivre avec les familles vocales FDPDLAVOC, économie LE FISC, puis les groupes de rôles, staff, communauté et événements de SUCK ME. La consolidation reste progressive pour éviter de modifier trop de handlers dans un même lot.

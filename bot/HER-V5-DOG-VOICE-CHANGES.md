# Her? V5 — DOG, MENOTTE et vocal

Cette archive est une copie de travail des sources fournies. Les changements ci-dessous ne sont pas encore déployés.

## Corrections intégrées

- Le routeur transmet désormais les paramètres du serveur à DOG, afin que le rôle SYS+ configuré soit effectivement reconnu.
- Le compteur DOG reste limité à trois laisses actives par propriétaire SYS+ et par serveur. Les opérations DOG sont sérialisées pour éviter deux attributions concurrentes sur une même cible ou un dépassement de quota.
- Un SYS+ retire sa propre laisse. Le propriétaire du serveur et les administrateurs Discord peuvent intervenir sur une laisse appartenant à un autre SYS+.
- Les paramètres complets du serveur sont transmis aux commandes et interactions vocales : SYS+ et ADMIN+ sont donc évalués avec leurs rôles configurés.
- SYS+ peut utiliser `=panel`, `=pv`, `=access` et `=unaccess`. ADMIN+ peut utiliser `=panel` et `=pv`, mais pas les commandes individuelles d'attribution/retrait d'accès.
- `=pv` et les actions du panneau ne demandent plus inutilement la permission Discord « Gérer les salons » au bot pour modifier les overwrites ; « Gérer les rôles » est vérifiée.
- Le panneau vocal est stocké dans SQLite et peut continuer à fonctionner après redémarrage.
- MENOTTE est raccordé aux événements vocaux et à la restauration au démarrage/reconnexion. Les états sont persistés dans `voice_menottes`.
- Les références aux panneaux/menottes sont nettoyées lorsqu'un salon vocal lié est supprimé.

## Commandes MENOTTE

- `=menotte @membre` : immobilise un membre dans le salon vocal où se trouve l'auteur.
- `=unmenotte @membre` : libère le membre.
- `=menotteinfo @membre` : consulte son état.

MENOTTE est accessible à SYS+ et ADMIN+. ADMIN+ ne peut agir que sur un membre dont le rôle le plus élevé est inférieur au sien. Le bot doit disposer de « Déplacer les membres » et des accès nécessaires aux salons source/destination.

## Tests

`npm --prefix bot test` exécute les tests SYS+, DOG policy et permissions vocales.

La validation actuelle couvre les règles pures et la syntaxe des fichiers. Elle ne remplace pas un test en direct sur Discord avec les permissions et la hiérarchie réelles du serveur.

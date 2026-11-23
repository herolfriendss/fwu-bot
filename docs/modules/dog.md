# DOG

Le module conserve un état par couple guild/membre dans `bot/data/dog-state.json`. Le rôle marqueur porte exactement le nom `En laisse`; le surnom mémorisé séparément est réappliqué à l’arrivée, aux changements de membre et au redémarrage du bot. Les contrôles Discord natifs `ManageRoles`, `ManageNicknames` et la hiérarchie s’appliquent toujours.

Chaque SYS+ peut avoir trois laisses actives par guild. WHITELIST ne change que ce quota interne : elle ne confère ni SYS+, ni permission Discord. Le dépassement réel est marqué dans le journal central et ajouté à `sysplus_audit` avec l’acteur, la cible, le nombre actif antérieur et le plafond. L’usage de WHITELIST sous le plafond est présenté comme un quota normal et ne crée pas d’événement d’exception.

`/dog membre` et `=dog @membre` attribuent une laisse. `/dog` sans membre et `=doglist` affichent les laisses actives de la guilde; la consultation reste SYS+ et ne lit jamais les états d’une autre guilde. Le nom `/dog-list` n’est pas ajouté au catalogue, qui est limité à 100 commandes globales.

Les commandes slash DOG ne sont pas filtrées selon `ManageNicknames` du membre appelant : le service vérifie SYS+ à chaque invocation. Le bot vérifie toujours ses propres permissions Discord et la hiérarchie avant de modifier un membre.

Les tests runtime définissent `PND_DOG_STATE_PATH` vers un JSON temporaire, et `HER_DB_PATH` vers une SQLite temporaire. Le démarrage habituel conserve `bot/data/dog-state.json`. Le test runtime passe désormais par le vrai routeur slash `/dog` pour vérifier que les paramètres WHITELIST de la guild atteignent le service partagé; le quota, l’audit et la restauration après rechargement sont aussi couverts. Le déplacement vocal et la hiérarchie restent à valider dans une guild de recette.

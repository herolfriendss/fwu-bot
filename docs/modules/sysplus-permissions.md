# Permissions SYS+, ADMIN+ et WHITELIST

SYS+ reconnaît le propriétaire Discord, les administrateurs natifs et le rôle SYS+ configuré dans la guilde. Seul le propriétaire/admin peut configurer le rôle SYS+; les opérations d’attribution SYS+ restent réservées au propriétaire de la guilde. ADMIN+ est limité aux scopes configurés et ne donne ni SYS+ ni droits de configuration. Le propriétaire Discord et les permissions natives ne sont jamais remplacés par ces scopes.

Les scopes ADMIN+ et son rôle sont persistés par `guild_id` dans SQLite. Les valeurs historiques par défaut sont `roles`, `voice` et `lockname` activés; `tickets` est désactivé. Les changements sont audités avec contexte de guilde.

Le panneau `/sys-panel` (également `=sysp`) expose l’historique SYS+, la gestion SYS+ propriétaire-only, les réglages ADMIN+ et les commandes WHITELIST. Il rappelle que ces niveaux restent indépendants des permissions natives.

WHITELIST est géré uniquement par le propriétaire. Elle ne donne aucun privilège SYS+/ADMIN+ et n’outrepasse ni les permissions natives Discord ni la hiérarchie des rôles. `/whitelist-list` affiche jusqu’à 50 membres déjà visibles dans le cache Discord et indique explicitement que l’échantillon peut être incomplet.

Les détails d’audit restent du JSON valide : ils dépassant 2 000 caractères sont remplacés par un indicateur `truncated`, les valeurs non sérialisables par un indicateur sûr et les lignes historiques invalides ne bloquent pas l’historique. Tests temporaires : `node --test bot/systems/sysplus/admin-plus-scopes-runtime.test.js bot/systems/sysplus/audit.test.js`.

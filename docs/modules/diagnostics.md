# Diagnostics SYS+ (lecture seule)

Réservés au rôle Perm SYS+ (et à l'OWNER). Chaque consultation est auditée. Aucun diagnostic ne modifie le serveur.

| Commande | Contenu |
|---|---|
| `/sysp diagnostic acl` · `=sysp acl` | Permissions dangereuses de `@everyone`, rôle Administrateur donné à plus de 5 membres, rôles de modération placés au-dessus du bot, rôle SYS+/ADMIN+ supprimé ou Administrateur, overwrites de salon ouvrant à `@everyone` ou à un membre : gestion des salons/rôles/webhooks/messages, mention `@everyone`. Classement critique → info. |
| `/sysp diagnostic sante` · `=sysp sante` | Gateway et latence, âge de la dernière synchronisation du site, permissions du bot, Anti-Move activé mais inopérant, présence sur le Logs Hub, `PRAGMA quick_check` de SQLite, erreurs récentes, rankall en cours, état persistant (PV, menottes, protections). |
| `/sysp diagnostic logs-couverture` · `=sysp logs-couverture` | Résumé de la matrice de couverture du Logs Hub. |

Toutes les 5 minutes, le bot évalue la santé de chaque serveur et publie une alerte « 🩺 Santé du bot » **uniquement** au passage à l'état critique, puis une seule fois au rétablissement.
| `/sysp diagnostic matrice` · `=sysp matrice` | Matrice des permissions par niveau (OWNER, propriétaire Discord, SYS+, ADMIN+, WHITELIST, Admin Discord, membre). Chaque case est **calculée en appelant les vraies fonctions d'autorisation** avec les scopes ADMIN+ actuels du serveur : elle ne peut pas diverger du code. |
| `/sysp diagnostic economie` · `=sysp economie` | Rapprochement soldes ↔ grand livre (`economy-integrity`) et signaux de fraude ouverts. Aucune correction ni sanction automatique. |

## Rapport d'incident

`/sysp incident action:Rapport id:<réf>` ou `=sysp incident rapport <réf>` produit un fichier Markdown : fiche de l'incident, durée, résolution, et chronologie des actions SYS+ auditées entre l'ouverture et la résolution (200 lignes maximum). Identifiants bruts, aucun contenu de message.

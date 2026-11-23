# ANTI-MOVE individuel — PND Assist + V5

ANTI-MOVE protège des membres ciblés contre les déplacements vocaux imposés par un autre compte humain. Il est désactivé par défaut et chaque guilde possède sa propre configuration SQLite.

## Commandes

- `/anti-moove config etat:on|off` — active ou désactive le système pour la guilde.
- `/anti-moove proteger membre` — ajoute une protection individuelle.
- `/anti-moove retirer membre` — retire cette protection.
- `/anti-moove liste` — affiche les membres protégés et les exceptions.
- `/anti-moove exception-ajouter membre` — permet à ce membre de déplacer les personnes protégées.
- `/anti-moove exception-retirer membre` — retire cette exception.
- `/anti-moove exceptions` — affiche uniquement les exceptions.

Les mêmes actions sont accessibles via `=anti-moove ...` et l’alias `=anti-move ...`. La configuration est réservée au SYS+ : l’OWNER 1942 configuré ou le rôle SYS+. Ni le propriétaire du serveur Discord ni la permission Administrateur ne donnent SYS+ (voir `/sysp diagnostic matrice`).

## Détection et sécurité

Le bot observe uniquement les changements d’état vocaux. Une arrivée dans un salon ne déclenche rien.

Discord n’enregistre **pas de cible** dans les entrées d’audit « Déplacer un membre » et « Déconnecter un membre » : seulement l’auteur, le salon de destination et un compteur. Quand un même auteur déplace plusieurs fois, Discord **réutilise la même entrée** et augmente son compteur sans changer sa date. Le module en tient compte :

- il garde un instantané `id d’entrée → compteur` par serveur (amorcé au démarrage, rafraîchi toutes les 30 s pour les serveurs qui protègent quelqu’un) ;
- une activité est « fraîche » si l’entrée est nouvelle et datée de moins de 8 s, ou si son compteur a augmenté depuis l’instantané ;
- le salon de destination doit correspondre exactement, et **un seul auteur** doit être candidat. Deux auteurs distincts, aucune entrée, ou une entrée inchangée : aucune restauration.

Les bots, les mouvements initiés par le membre lui-même, le bot lui-même (DOG, MENOTTE, WAKEUP) et les acteurs en exception sont ignorés.

**Déconnexion forcée** : Discord ne permet pas à un bot de reconnecter un membre. L’événement est journalisé (audit + Logs Hub) mais aucune restauration n’est tentée.

**Anti-boucle** : au-delà de 3 restaurations en 60 s pour le même membre, le bot arrête de restaurer et publie une alerte. **Avant chaque retour**, le bot vérifie que le membre est toujours dans le salon de destination. Un refus Discord (salon plein, permissions) est journalisé sans planter le module.

Le bot doit avoir les permissions **Voir le journal d’audit** et **Déplacer des membres**. La commande d’activation vérifie leur présence.

**Limite connue** : si deux personnes arrivent dans le même salon au même instant, l’une déplacée et l’autre volontairement, la déduction reste probabiliste. Le module ne restaure que si un seul auteur est candidat.

## Persistance

Les tables `anti_move_config`, `anti_move_protected_members` et `anti_move_exemptions` enregistrent les états, protections et exceptions par `guild_id`. Aucune table, protection ou donnée de la guilde MZ n’est créée par une configuration de ce module.

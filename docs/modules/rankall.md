# RANKALL — attribution générale d'un rôle

Réservé au **propriétaire configuré** (`PND_OWNER_DISCORD_ID`). Ni le propriétaire du serveur Discord, ni SYS+, ni ADMIN+ n'y ont accès.

## Déroulé

1. `/rankall role` ou `=rankall @rôle` : **aperçu** sans aucune modification. Il affiche le nombre de membres concernés, déjà titulaires, bots exclus, membres ignorés avec le motif (hiérarchie, propriétaire du serveur…) et quelques exemples.
2. Boutons **Confirmer** (60 s) ou **Annuler**. Les boutons sont liés à l'auteur et revérifient l'OWNER.
3. Exécution : un membre à la fois, pause de 250 ms (`PND_RANKALL_STEP_DELAY_MS`). Chaque attribution revérifie le membre, le rôle et la hiérarchie à jour. Progression affichée tous les 10 membres, avec un bouton **Arrêter**.
4. Fin : bilan, entrée d'audit `role.rankall`, log central, et bouton **Annuler l'attribution (15 min)**. L'annulation retire le rôle **uniquement** aux membres qui l'ont reçu par cette opération.

## Garde-fous

- Un seul travail ouvert (aperçu ou exécution) par serveur ; double-clic sur « Confirmer » sans effet.
- Rôle refusé s'il est géré par une intégration, `@everyone`, au-dessus du bot, ou s'il porte une permission sensible (Administrateur, Gérer le serveur/les rôles/les salons/les webhooks/les messages, Bannir, Expulser, Exclure temporairement, Mentionner @everyone, Déplacer/Rendre muet, Voir les logs…). Revérifié à la confirmation.
- Plafond : 5 000 membres (`PND_RANKALL_MAX_MEMBERS`).
- Les travaux sont stockés dans SQLite (`rankall_jobs`) avec la liste exacte des membres modifiés. Après un redémarrage, un travail en cours est marqué `interrupted` (jamais repris automatiquement) et reste annulable pendant 15 minutes.

## Limite

Le jeton d'une interaction Discord expire après 15 minutes. Au-delà, la progression d'un aperçu éphémère (slash) ne peut plus être mise à jour. Le bilan reste disponible dans le log central. Pour la version préfixe, le message public est édité directement.

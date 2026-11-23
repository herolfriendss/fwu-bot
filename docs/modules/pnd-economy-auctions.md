# Enchères PND

Les enchères sont accessibles sous `/shop auction` et portent sur les rôles déjà présents dans la boutique du serveur.

- `create` exige que le vendeur possède le rôle et que le bot puisse le gérer; durée de 10 minutes à 7 jours.
- `list` affiche les enchères actives avec l’offre minimale et l’échéance.
- `bid` réserve le montant dans le portefeuille du membre; une nouvelle meilleure offre rembourse immédiatement l’ancien meilleur enchérisseur dans la même transaction.
- `cancel` est autorisé au vendeur seulement avant toute offre.
- Un worker du processus bot traite les enchères expirées chaque minute. Sans offre, l’enchère expire. Avec une offre, le rôle est transféré puis le vendeur est payé; si le transfert échoue, l’offre est remboursée.

Les changements d’état et soldes restent isolés par `guild_id`. Le worker marque `pending` avant l’appel Discord afin d’éviter un double règlement. Un arrêt brutal pendant le transfert peut laisser `pending`; l’annonce et l’escrow doivent alors être vérifiés avant reprise manuelle. Si le transfert inverse échoue après une erreur de règlement, l’enchère devient `failed` et conserve l’escrow pour éviter une double dépense.

Les tests couvrent les enchères, offres concurrentes séquentielles, remboursements, expiration, vente, échec du transfert et idempotence avec SQLite temporaire et faux transfert Discord. La recette réelle doit encore valider la hiérarchie et le changement effectif de rôle.

## Réconciliation après coupure

Au démarrage puis toutes les 10 minutes, `reconcilePendingEconomy` reprend les opérations restées `pending` plus de 10 minutes (immédiatement au démarrage). La décision se fonde sur la possession réelle du rôle lue dans Discord :
- transfert fait (acheteur/gagnant a le rôle, vendeur non) → paiement réglé, une seule fois (mise à jour conditionnelle dans la même transaction que les soldes) ;
- transfert non fait (vendeur a le rôle, acheteur non) → annonce rouverte / enchère rendue au worker ;
- cas ambigu, acheteur inconnu (achat antérieur à cette version) ou Discord illisible → rien n'est décidé ; une ligne de revue est créée et visible dans `/sysp diagnostic economie`.

L'acheteur d'une annonce est désormais enregistré (`buyer_id`) dès la réservation.

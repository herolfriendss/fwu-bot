# Marché PND

Le marché est accessible par `/shop market`. Il réutilise les rôles déjà vendus dans la boutique PND : il n’ajoute pas de monnaie ni de catalogue d’objets parallèle.

- `list` consulte les annonces ouvertes sur le serveur.
- `sell` publie un rôle de boutique que le vendeur possède actuellement, à un prix fixé par lui.
- `buy` vérifie à nouveau l’annonce, les deux membres et la hiérarchie du rôle, puis transfère le rôle et règle le paiement.
- `cancel` permet au vendeur de retirer sa propre annonce tant qu’elle est ouverte.

Les achats sont verrouillés par annonce. Les PND ne sont réglés qu’après transfert Discord réussi, dans une transaction atomique. Si le paiement échoue après le transfert, le bot tente d’inverser celui-ci; une compensation impossible marque l’annonce `failed` pour revue et évite d’affirmer que la vente a réussi. Une annonce restée `pending` après arrêt brutal du processus doit être revue avant toute résolution manuelle.

Toutes les annonces sont isolées par `guild_id`. Les tests utilisent une base SQLite temporaire et un faux transfert, sans connexion Discord.

## Réconciliation après coupure

Au démarrage puis toutes les 10 minutes, `reconcilePendingEconomy` reprend les opérations restées `pending` plus de 10 minutes (immédiatement au démarrage). La décision se fonde sur la possession réelle du rôle lue dans Discord :
- transfert fait (acheteur/gagnant a le rôle, vendeur non) → paiement réglé, une seule fois (mise à jour conditionnelle dans la même transaction que les soldes) ;
- transfert non fait (vendeur a le rôle, acheteur non) → annonce rouverte / enchère rendue au worker ;
- cas ambigu, acheteur inconnu (achat antérieur à cette version) ou Discord illisible → rien n'est décidé ; une ligne de revue est créée et visible dans `/sysp diagnostic economie`.

L'acheteur d'une annonce est désormais enregistré (`buyer_id`) dès la réservation.

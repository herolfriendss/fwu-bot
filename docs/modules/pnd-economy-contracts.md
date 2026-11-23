# Contrats communautaires PND

`/job contract` fournit un tableau de contrats rémunérés propre au serveur. La table `economy_contracts` est ajoutée de façon additive au démarrage SQLite; elle ne modifie aucune table ni donnée existante.

## Parcours

- `create` réserve la récompense sur le portefeuille de l’auteur dans la même transaction que l’insertion du contrat.
- `list` affiche les contrats ouverts, en cours, à valider, terminés ou tous ceux du serveur courant.
- `claim` attribue atomiquement un contrat ouvert à un autre membre que l’auteur.
- `submit` accepte un compte rendu uniquement de la personne ayant réclamé le contrat.
- `approve` est réservé à l’auteur et verse l’escrow une seule fois après soumission.
- `cancel` est réservé à l’auteur et rembourse uniquement un contrat encore ouvert.

Chaque requête cible `guild_id`; les titres, descriptions et comptes rendus sont bornés et neutralisent les mentions. L’escrow et les paiements créent des entrées distinctes dans le grand livre PND. Le catalogue slash conserve son nombre de commandes globales : le nouveau parcours est imbriqué sous `/job`.

## Validation

Tests automatisés avec SQLite temporaire : isolation entre serveurs, fonds insuffisants, refus de s’auto-attribuer, changements d’état, autorisations auteur/exécutant, remboursement et paiement unique. La recette réelle Discord reste nécessaire pour valider le parcours Gateway et l’affichage des interactions.

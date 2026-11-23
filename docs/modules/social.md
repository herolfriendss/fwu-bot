# Social — réputation et badges

- **Anti-farming de la réputation** (`=rep`, `/rep`) : compte Discord d'au moins 7 jours, membre depuis au moins 3 jours, au plus 5 points donnés par 24 h tous destinataires confondus (`PND_REP_MIN_ACCOUNT_DAYS`, `PND_REP_MIN_MEMBER_DAYS`, `PND_REP_DAILY_LIMIT`). Le délai de 24 h par destinataire est conservé. Vérification et écriture se font dans une seule transaction.
- **Historique** : `=rep historique [@membre]` (alias `=rephistorique`) affiche les 10 derniers points reçus, avec le donneur et la raison. Pas de version slash : le catalogue est plein (100/100) et `/rep` n'a pas de sous-commandes.
- **Badges** affichés dans le profil, calculés à chaque affichage depuis les données du serveur (aucune table qui pourrait diverger) : niveau de réputation, ancienneté (1 an, 2 ans), fortune PND (100 000, 1 000 000), cartes (25, 100), bienveillance (50 points donnés).

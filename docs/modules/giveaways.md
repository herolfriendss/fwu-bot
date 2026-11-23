# Giveaways — tirage vérifiable

- À la clôture (`/giveaway end`, `=giveaway end`, ou fin automatique), une **graine aléatoire de 32 octets** est générée et enregistrée dans `giveaway_draws`, avec l'empreinte SHA-256 de la liste des participants (triés par identifiant) et les gagnants.
- Le tirage utilise HMAC-SHA256(graine, compteur) : avec la graine et la liste des participants, n'importe qui peut rejouer le tirage et retrouver exactement les mêmes gagnants.
- `/giveaway verifier id` (`=giveaway verifier id`) rejoue chaque tirage et signale si la liste des participants a changé ou si le résultat n'est pas reproductible.
- `/giveaway reroll id [gagnants]` (`=giveaway reroll id [n]`) : nouveau tirage, réservé à l'hôte ou au staff, uniquement après la fin, en **excluant tous les anciens gagnants**. Chaque nouveau tirage est enregistré avec son auteur.
- Les giveaways terminés avant cette version n'ont pas de tirage enregistré : la vérification l'indique.

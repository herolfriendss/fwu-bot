# Économie PND — antifraude des transferts

S'applique à `=pay` et `/pay` (même gestionnaire).

## Blocages (avant tout mouvement de PND, dans la même transaction SQLite)

| Règle | Défaut | Variable |
|---|---|---|
| Ancienneté du compte Discord | 7 jours | `PND_TRANSFER_MIN_ACCOUNT_DAYS` |
| Ancienneté sur le serveur | 3 jours | `PND_TRANSFER_MIN_MEMBER_DAYS` |
| Montant envoyé par 24 h glissantes | 50 000 PND | `PND_TRANSFER_DAILY_CAP` |
| Nombre de transferts par 24 h | 20 | `PND_TRANSFER_DAILY_COUNT` |

Une date d'arrivée inconnue est refusée (fermeture par défaut). **WHITELIST** lève le plafond et le nombre de transferts (exemption de limites), **jamais** la règle d'ancienneté.

## Signaux (jamais bloquants)

- **Entonnoir** : un destinataire reçoit des PND de 5 membres arrivés depuis moins de 14 jours, en 24 h (`PND_TRANSFER_FUNNEL_SENDERS`, `PND_TRANSFER_YOUNG_MEMBER_DAYS`).
- **Allers-retours** : au moins 2 transferts dans chaque sens entre deux membres en 1 h.

Chaque signal est enregistré une fois par 24 h (`economy_fraud_signals`), publié dans `logs-pnd` et listé par `/sysp diagnostic economie`. Les transferts sont tracés avec leur destinataire dans `economy_transfers`. Avant ce lot, le grand livre ne gardait pas la contrepartie d'un `=pay`.

## À valider (produit)

Les seuils par défaut sont des propositions : ils sont modifiables par variable d'environnement sans redéploiement de code.

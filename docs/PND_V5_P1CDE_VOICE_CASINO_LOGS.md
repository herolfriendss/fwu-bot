# PND Assist V5 — Lots P1-C, P1-D et P1-E

## P1-C — PND Voice Access Requests

- `=demandevocal` permet de demander l'accès à une vocale privée gérée par `=pv`.
- La demande est publiée dans le chat associé à la vocale, mentionne explicitement le propriétaire et expire après 10 minutes.
- Le propriétaire de la vocale (ou un responsable disposant de Gérer les salons) peut accepter, refuser ou bloquer le demandeur.
- L'acceptation ajoute les overwrites `ViewChannel` et `Connect`; le refus ne modifie pas les permissions.
- Anti-doublon, cooldown, blocage, historique de décision et verrouillage atomique du traitement sont persistés en SQLite.
- Pour un salon temporaire, le propriétaire enregistré dans `temp_voice` reste l'autorité et conserve son accès, même si un responsable a activé le verrouillage.
- Limite : si le demandeur ne voit pas le chat associé à la vocale, il doit utiliser une commande depuis un salon où il peut écrire. Le point d'entrée central `#demandes-vocales` et le slash dédié ne sont pas encore ajoutés.

## P1-D — PND Casino

- Commandes préfixées : `=casino aide`, `=casino roulette <mise> <couleur|numéro>`, `=casino slots <mise>`, `=casino historique`, `=casino stats`.
- Les mises et retours sont exclusivement en PND virtuels, via `wallets` et `economy_ledger`.
- Chaque round est enregistré dans `casino_rounds` avec une clé d'idempotence; débit, crédit, ledger et round sont atomiques.
- Les mises sont bornées à 1 milliard PND; le paiement maximal d'un round est borné à 36 fois la mise.
- Les résultats Casino sont routés vers `logs-casino` dans le hub de logs.
- Non inclus dans ce lot : blackjack/poker/jackpot/tables privées, commandes slash, boutique VIP ou conversion en argent réel. Aucune conversion en argent réel n'est prévue.

## P1-E — Journalisation et présence vocale

- Les changements de présence vocale ouvrent/clôturent des sessions persistées et enregistrent les connexions, déconnexions et déplacements.
- Les durées sont calculées quand les deux bornes ont été observées. Les sessions présentes au démarrage sont marquées `approximate`.
- L'attribution d'un déplacement/déconnexion manuelle tente une corrélation avec l'Audit Log Discord; à défaut, l'initiateur reste explicitement non identifié.
- `=vocalpresence <date ISO|timestamp>` permet au staff ayant Gérer le serveur de consulter les membres présents à un instant donné.
- Aucun audio ni contenu de conversation n'est enregistré.
- Les événements et sessions sont isolés par `guild_id`; seuls les serveurs actifs autorisés PND sont suivis, jamais le hub de logs ou un serveur inactif.
- Les nouveaux événements sont routés vers les catégories dédiées du hub (`logs-vocaux`, `logs-casino`, `logs-securite`, `logs-hierarchie`, etc.).
- Limites : Discord ne fournit pas l'identité de l'initiateur pour chaque changement vocal; les trous pendant l'arrêt du bot ne peuvent pas être reconstruits exactement. Une politique de rétention/purge automatique reste à définir avant activation en production.

## Validation locale

- Tests Node intégrés : règles de roulette/slots, idempotence, atomicité, solde insuffisant et parseur de commande vocale.
- Syntaxe JavaScript vérifiée sur les fichiers modifiés.
- Environnement de travail disponible : Node 22.16.0, alors que le projet déclare Node >=24. Le test complet bot/dashboard et les interactions réelles Discord restent à rejouer sous Node 24 avec les dépendances installées.

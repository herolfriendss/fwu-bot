# Missions quotidiennes PND

## Commandes

- `/job mission status` affiche les objectifs du jour et leur progression.
- `/job mission claim` crédite en une fois les récompenses des objectifs terminés.
- Les alias préfixés `=mission status|claim` utilisent le même service économique.

Les missions progressent après trois commandes `/work`, un transfert PND réussi ou l'achat réussi d'un rôle boutique. Un achat ne compte qu'après confirmation de l'attribution du rôle par Discord. Les récompenses sont respectivement de 150, 100 et 120 PND.

## Données et protection contre les abus

La table additive `economy_daily_missions` est indexée par serveur, membre, date UTC et mission. Les actions réussies augmentent la progression dans leur transaction économique ; les progressions sont plafonnées à l'objectif. La réclamation marque chaque objectif réclamé et crédite le portefeuille dans une transaction SQLite, ce qui empêche une double réclamation. Le portefeuille et les historiques restent séparés par serveur.

## Vérification

`npm --prefix bot test` exécute les tests de politique et un test d'intégration qui utilise une base temporaire via `HER_DB_PATH`. Aucun test de cette fonctionnalité ne cible `bot/data/economy.sqlite`. La disponibilité des commandes sur une application Discord de recette reste à valider.

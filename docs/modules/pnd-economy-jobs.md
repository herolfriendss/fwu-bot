# PND Economy: métiers

## Utilisation Discord

- `/job list` affiche les cinq métiers disponibles.
- `/job choose métier` choisit un métier ou bascule vers un autre.
- `/job status` affiche le métier actif, le niveau et l’expérience.
- `/work` applique le bonus du métier actif et attribue 25 XP après le travail réussi.

Les métiers disponibles sont Artisane, Explorateur, Hôte communautaire, Mécanicien et Coursier. Chaque métier possède sa propre progression, isolée par serveur et membre. Changer de métier ne supprime pas la progression précédente.

## Progression et persistance

Les tables additives `economy_member_jobs` et `economy_job_profiles` sont définies dans `bot/database.js`. Un niveau demande 100 XP, jusqu’au niveau 10. Chaque niveau ajoute 5 % au gain aléatoire de travail, plafonné à 45 %. Le délai horaire déjà appliqué à `/work` limite les gains répétés.

Les PND et XP restent dans le SQLite local du bot. Aucun test n’utilise `bot/data/economy.sqlite` : le test d’intégration définit `HER_DB_PATH` vers une base temporaire.

## Validation

- Politique pure : `node --test bot/job-policy.test.js`.
- Persistance et isolation par serveur : `node --test bot/economy-job-runtime.test.js`.
- Suite bot : `npm --prefix bot test`.

Les métiers, missions, contrats, marché et enchères sont développés localement. Le marché et les enchères nécessitent une recette de transfert de rôle sur un serveur Discord de test.

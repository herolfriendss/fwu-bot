# PND V5 — Workflow de développement avec Claude

> Dépend de : MASTER_PLAN, TEST_PLAN. Il formalise la manière de travailler observée dans ce projet (audits, patchs vérifiés, rapports de preuves) et les règles d'`AGENTS.md`.

## 1. Rôles

- **Architecte (vous)** : valide les décisions, fournit les sources, exécute les recettes Discord, approuve tout déploiement.
- **Claude** : audite les fichiers fournis, propose, code par lots, teste ce qui est testable, rapporte honnêtement.
- Claude n'a **pas accès** à votre dossier local, à Oracle/VPS, à Discord réel ni à la production.

## 2. Règles de base

1. **Ne rien inventer.** Un fichier non fourni est déclaré absent ; une affirmation tirée d'un document est étiquetée 📄, pas ✅.
2. **Audit avant code.** Pas de modification sans avoir lu les fichiers concernés et leurs consommateurs.
3. **Lots petits et réversibles** : un sujet, quelques fichiers, des tests.
4. **Pas de remplacement** de V4/V5 ; extension par façades et pont legacy.
5. **Aucun déploiement**, aucune donnée de production, aucun secret dans les échanges.
6. **Distinguer** tests réels, tests simulés et tests non exécutés, avec la commande exacte.
7. **Corriger les hypothèses** découvertes en route (ex. une clé de réglage rejetée par le serveur) plutôt que les masquer.

## 3. Cycle d'une mission

1. **Cadrage** : objectif, périmètre, fichiers nécessaires.
2. **Demande de fichiers** : liste exacte (chemins) ; Claude vérifie qu'ils sont réellement présents et signale tout import manquant.
3. **Audit** : lecture complète des fichiers ; cartographie des appelants ; liste des risques.
4. **Plan du lot** : fichiers à modifier, tests à ajouter, critères d'acceptation, ce qui ne sera **pas** touché.
5. **Développement** dans une copie de travail isolée.
6. **Tests** : avant et après (référence puis modification), mutation ciblée si pertinent.
7. **Livraison** : patch `a/…` `b/…` relatif à la racine, archive des fichiers, liste des fichiers, résultats, limites, commandes d'intégration.
8. **Vérification** : application du patch sur une extraction vierge, comparaison octet à octet.
9. **Intégration locale par vous** : branche dédiée, `git apply --check`, tests sous Node 24.22.2.
10. **Recette** sur serveur de test pour tout ce qui implique Discord.
11. **Clôture** : mise à jour de `PND_ASSIST_PLUS_STATUS.md` et `PND_ASSIST_PLUS_CHANGELOG.md`, commit local.

## 4. Format d'un rapport de lot

```
Objectif · Fichiers reçus · Fichiers absents · Modifications (par fichier)
Tests réels (commande, Node, résultat) · Tests simulés (ce qui est simulé)
Tests non exécutés (raison) · Risques restants · Décisions à valider
Livrables (chemins, sha256) · Commandes d'intégration
```

## 5. Définition de « terminé »

- Tests automatisés ciblés verts, sans régression des suites existantes.
- Isolation par guilde testée si des données sont concernées.
- Permissions vérifiées côté serveur.
- Si Discord est impliqué : protocole de recette écrit **et** exécuté, ou fonctionnalité marquée « à recetter ».
- Documentation et catalogue mis à jour.

## 6. Git et sauvegardes

- Branche par lot (`integration/<sujet>`), commits locaux réversibles.
- **Jamais** de force-push ni de réécriture d'historique publié (Lovable synchronise la branche connectée).
- Point de contrôle avant chaque lot important ; archive source-only vérifiée (liste blanche, sans `.env`, données, `node_modules`).
- Ne pas copier un historique V3/V4 comme historique V5.

## 7. Gestion des fichiers

- Chaque lot précise les fichiers **à fournir** (chemins) pour éviter l'audit à l'aveugle.
- Les patchs ne sont pas cumulables : un patch « complet » remplace les patchs partiels précédents ; le livrable l'indique.
- Les harnais de test (stubs de discord.js, faux Supabase) restent **hors projet** et sont documentés.

## 8. Escalade vers l'architecte

Décision requise avant de continuer pour : changement de spécification, nouvelle dépendance, migration de données, modification de permissions sensibles, activation d'un serveur, achat, secret, déploiement, accès Oracle/VPS, retrait d'un nom de commande.

## 9. Prompts types

**Audit** : « Audite `<chemins>`. Lecture seule. Liste ce qui existe, ce qui manque, les risques, les tests existants. Ne modifie rien. »
**Lot** : « Implémente `<objectif>` dans une copie isolée. Fichiers autorisés : `<liste>`. Ajoute les tests. Livre patch, archive, résultats réels/simulés/non exécutés, commandes d'intégration. »
**Revue** : « Relis ce patch contre les règles d'AGENTS.md et PERMISSIONS ; liste les écarts. »

## 10. Première séquence recommandée

1. **P0** : fournir l'archive complète (`package.json`, lockfiles, `src/`, `bot/` complets) ; exécuter la suite de base ; produire l'inventaire réel.
2. **P1** : plateforme (registre, catalogue, `authorize`, migrations) sans toucher V4.
3. **P2** : branchement SYS+/ADMIN+/WHITELIST/`/pnd*` sur `authorize`, matrice de tests.
4. **P4** : audit puis consolidation du vocal (JOIN 2 CREATE) avec recette.

## 11. Critères de validation

- Chaque lot produit les éléments du §4.
- Aucun lot ne modifie un fichier hors liste autorisée.
- Aucune affirmation « ✅ » sans fichier lu.
- Les rapports distinguent toujours réel, simulé, non exécuté.

# FWU — chantier global d'évolution des six applications

Date de cadrage : 25 novembre 2026  
Branche de travail : `codex/fwu-hardening-2026-11-26`  
Pull request : [#25](https://github.com/herolfriendss/her-v3-/pull/25)

## État d'avancement — 25 novembre 2026

- Accueil et départ : messages configurables, avec destinations choisies parmi les salons existants.
- Tickets natifs : parcours de création et de prise en charge renforcé ; les salons privés ne sont créés qu'à l'ouverture volontaire d'un ticket.
- Logs : cycle de vie des tickets et événements membres relayés ; vérification du serveur de logs en lecture seule, sans provisionner de rôles, salons ou catégories.
- Commandes : 15 actions du lecteur musical regroupées sous `/music player`, et `/access`, `/unaccess`, `/pv` regroupées sous `/voice`. Les préfixes historiques restent compatibles. Le catalogue est ramené à 129 racines uniques.
- Identité : pack de 16 PNG transparents préparés ; aucun téléversement Discord.
- Production : aucun déploiement ni redémarrage effectué.

## Objectif

Faire évoluer l'écosystème FWU complet (FWU, GUARD, FDPDLAVOC, SUCK ME, LE FISC et Invest +) sans régression, sans multiplier inutilement les commandes et sans modifier la configuration du serveur Discord actuellement en fonctionnement.

## Invariants non négociables

- Ne pas créer, supprimer, renommer, déplacer ou reconfigurer les salons, catégories, rôles ou permissions du serveur communautaire.
- Ne pas modifier le setup des six applications Discord : tokens, invitations, intents, permissions, présence, installation ou configuration du Developer Portal.
- Ne pas redémarrer, déployer ou remplacer les processus de production.
- Ne pas modifier les données de production ni exécuter de migration distante sans procédure et validation explicites.
- Ne pas retirer une fonctionnalité existante lors de la consolidation des commandes.
- Préserver les salons vocaux temporaires déjà opérationnels ; ne pas les reconstruire.
- Invest + reste facultative pour l'installation, mais ses fonctionnalités et ses tests restent dans le périmètre.
- Les opérations structurelles destructives et les automatisations sensibles restent protégées par l'OWNER technique unique, les contrôles de hiérarchie et une confirmation explicite.

## Périmètre fonctionnel accepté

### Accueil et cycle de vie des membres

- Message de bienvenue configurable dans la configuration applicative existante, sans création ni modification de salon.
- Message de départ configurable, indépendant du message de bienvenue.
- Informations d'arrivée/de départ limitées aux données disponibles et autorisées : identifiant, dates, ancienneté, rôles observables.
- Parcours d'accueil, vérification et rôles automatiques uniquement si déjà configurés et compatibles avec les protections de distribution de rôles.
- Journaliser les arrivées et départs dans le serveur central de logs existant.

### Tickets natifs FWU

- Conserver le moteur de tickets existant et l'améliorer ; ne pas introduire de fournisseur externe obligatoire.
- Parcours de création par catégorie logique, prise en charge, ajout/retrait de participants, fermeture, réouverture, transcription contrôlée et archivage.
- Contrôle d'accès par ticket, vérification de l'auteur et des membres du staff, isolation par serveur.
- Historique d'actions, délais/SLA, priorités et escalade configurables sans imposer de nouveaux salons.
- Le système utilise les destinations déjà configurées ; si une destination manque, il signale le prérequis sans créer de structure Discord.

### Logs centralisés

- Réutiliser le Logs Hub et ses salons existants ; ne jamais les provisionner, renommer ou réorganiser dans ce chantier.
- Classer les événements par catégories déjà disponibles : membres, modération, sécurité, permissions, vocal, staff, bots, économie, système, tickets et automatisations selon la configuration existante.
- Chaque événement contient, lorsque disponible : horodatage, serveur source, acteur, cible, application source, action, résultat, identifiant et contexte minimal.
- Préserver l'isolation stricte des serveurs sources ; aucun événement privé ne doit être relayé vers un autre serveur.
- Déduplication, file persistante, reprise après panne, limites de débit, rétention et compteurs de pertes.
- Ne jamais journaliser les tokens, secrets, contenus privés de tickets ou conversations, ni les contenus de messages supprimés/modifiés.
- Si une catégorie ou destination de logs n'existe pas, signaler la couverture manquante sans créer de salon.

### Consolidation de toutes les commandes

- Auditer les commandes slash, préfixées, panneaux, boutons, menus, modales, alias et routes internes des six applications.
- Regrouper les actions connexes sous des commandes racines avec sous-commandes et groupes Discord, plutôt que multiplier les commandes racines.
- Réduire les doublons d'interface, pas les capacités métier.
- Maintenir une matrice de parité : chaque fonctionnalité existante doit garder au moins un chemin d'accès explicite et testé.
- Préserver temporairement les anciens alias préfixés et les commandes historiques lorsqu'ils sont utilisés ; fournir une période de compatibilité et une documentation de migration.
- Réutiliser les mêmes fonctions métier et politiques d'autorisation pour les interfaces slash, préfixe et panneau.
- Garder chaque commande sur son application propriétaire ; les commandes communes restent explicitement déclarées.
- Respecter les limites Discord (25 options par niveau, 100 commandes racines par application) et générer les audits depuis le code.
- Ne jamais supprimer une commande au seul motif qu'elle est peu utilisée sans prouver que sa capacité est conservée dans une nouvelle route.

### Command Center et fonctionnalités transversales

- FWU CENTRAL : état et communication authentifiée entre applications.
- FWU AI / INTELLIGENCE : aide contextuelle et analyses, avec autorisations explicites et aucune sanction basée uniquement sur une prédiction.
- FWU MEMORY : mémoire d'événements et de décisions, rétention configurable.
- FWU ID / PASSPORT : fiche de membre, réputation, ancienneté et progression, avec minimisation des données.
- FWU BACKUP & RESTORE : sauvegardes versionnées et restauration sélective ; aucune restauration automatique non confirmée.
- FWU INCIDENT CENTER / RESCUE : incidents, gravité, responsable, chronologie et résolution.
- FWU LIVE STATUS : disponibilité, latence, erreurs, synchronisation et état des bases.
- FWU LAB : tests de règles et configurations en mode simulation, sans effets Discord.
- FWU API / NETWORK : échanges inter-applications authentifiés, droits par action, signatures/identifiants anti-rejeu et aucune circulation de tokens entre bots.
- FWU KNOWLEDGE : documentation, FAQ et procédures consultables.

### FWU et administration

- Dossiers de membres, historique, activité staff, décisions, rapports et suggestions.
- Planification des présences, missions staff, absences et escalades.
- Statistiques et indicateurs de santé communautaire.

### GUARD et sécurité

- Détection graduée de raids, comportements suspects, impersonation et changements de permissions.
- Protection contre suppressions massives, webhooks abusifs et changements de rôles dangereux.
- Quarantaine configurable, procédures d'urgence, analyse/reconstitution d'incidents et recommandations.
- Les détections probabilistes produisent des alertes, jamais une sanction irréversible sans règle explicite et vérification.

### FDPDLAVOC

- Améliorer les statistiques vocales, événements, files/réservations, notifications et outils de modération vocale.
- Ne pas modifier le système Join-to-Create ni ses salons temporaires déjà en service.

### SUCK ME

- Welcome Journey, rôles automatiques conditionnels, tickets, workflows, missions staff, absences et rappels.
- Préserver SYS+, ADMIN+, WHITELIST, DOG, MENOTTE, WAKEUP, LOCKNAME, Anti-Move et leurs protections.

### LE FISC

- Missions, métiers, entreprises, enchères, échanges, collections, succès, saisons, classements et régulation économique.
- Préserver l'intégrité des soldes, l'anti-fraude et les historiques.

### Invest +

- Abonnements, droits temporaires, avantages, fidélité, parrainage, créateurs et analyses.
- Rester facultatif et isolé ; aucune dépendance obligatoire pour les cinq autres applications.

### Identité visuelle et pack emoji

- Préparer un pack cohérent avec la palette rouge/noir et l'identité FWU du serveur.
- Fournir des emojis expressifs et fonctionnels : statut, sécurité, staff, tickets, vocal, économie, premium, événements, progression et réactions.
- Préparer les exports PNG transparents aux dimensions compatibles Discord, les noms de fichiers, noms d'emojis, usages recommandés et une planche de prévisualisation.
- Le pack est un livrable graphique uniquement : aucun emoji ne sera téléversé ni ajouté au serveur pendant ce chantier.

## Ordre de réalisation

1. **Stabilisation** : traiter les échecs CI existants, vérifier les tests et établir une base verte.
2. **Inventaire** : cartographier toutes les commandes, leurs options, permissions, handlers, alias et usages.
3. **Consolidation** : proposer et implémenter les groupes racines et sous-commandes, avec parité et compatibilité.
4. **Logs** : renforcer la classification et la couverture des événements, sans toucher aux salons existants.
5. **Accueil et tickets** : compléter les messages d'arrivée/de départ et le système de tickets natif.
6. **Command Center et socle transversal** : central, statuts, incidents, mémoire, sauvegardes et API.
7. **Modules spécialisés** : GUARD, vocal, SUCK ME, économie et Invest +.
8. **Pack emoji** : créer les ressources visuelles et la documentation d'utilisation.
9. **Validation finale** : tests unitaires, intégration, audits de commandes, sécurité, build et recette staging.

## Définition de terminé

- Aucun invariant n'a été violé.
- La matrice de commandes confirme que toutes les capacités précédentes sont toujours accessibles.
- Les six profils sont testés, Invest + compris.
- Les événements sont classés vers les destinations déjà configurées, ou explicitement signalés comme non routables.
- Les systèmes de bienvenue et de tickets disposent de tests et d'une recette staging.
- Les migrations éventuelles sont additives, documentées et non appliquées sur une base distante.
- CI verte sur le commit final.
- Aucun déploiement ou redémarrage de production effectué.

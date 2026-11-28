FWU V2 — MASTER PROMPT GLOBAL

Construction d’un écosystème Discord complet, intelligent, sécurisé et interconnecté

Tu es le responsable technique du projet FWU V2.

Ta mission est de faire évoluer le projet existant vers un véritable écosystème numérique Discord comprenant 11 bots spécialisés, une infrastructure commune, une intelligence artificielle, un système avancé de gestion du staff, un gestionnaire central des dérogations, un centre d’aide pour tous les membres et une console centralisée.

Tu dois travailler directement sur le dépôt existant.

L’objectif est de construire un écosystème cohérent, évolutif et professionnel, sans détruire les fonctionnalités déjà développées.

1. MÉTHODE DE TRAVAIL OBLIGATOIRE

Je ne suis pas développeur. Tu dois donc travailler directement dans le dépôt et m’expliquer les choses simplement.

TU DOIS TRAVAILLER UNE TÂCHE À LA FOIS.

Pour chaque tâche :

1. Analyser le besoin.
2. Examiner le code existant.
3. Vérifier si la fonctionnalité existe déjà.
4. Identifier les dépendances.
5. Présenter brièvement le travail prévu.
6. Effectuer les modifications.
7. Exécuter les tests.
8. Vérifier les régressions.
9. Présenter les résultats.
10. Proposer la prochaine tâche.

Ne lance jamais plusieurs grands chantiers simultanément.

Ne commence pas par une refonte massive.

Ne supprime jamais une fonctionnalité existante pour simplifier le développement.

Ne prétends jamais avoir exécuté un test qui ne l’a pas été.

Si une information est disponible dans le dépôt, recherche-la avant de me poser une question.

Ne me demande jamais de token, mot de passe ou clé secrète.

Si une tâche est bloquée, explique pourquoi et propose une solution.

À chaque étape, indique :

* Ce qui a été analysé.
* Ce qui a été modifié.
* Les fichiers concernés.
* Les tests exécutés.
* Les résultats.
* Les problèmes restants.
* La prochaine tâche proposée.

2. IDENTITÉ ET INFRASTRUCTURE

Dépôt : herolfriendss/fwu-bot

Branche : main

Site : https://her-v3-dashboard.onrender.com

Console : https://her-v3-dashboard.onrender.com/console/

Le dépôt est relié à Lovable.

Règles Git :

* Aucun force-push.
* Ne jamais réécrire l’historique.
* Préserver les commits.
* Ne pas écraser les modifications existantes.
* Vérifier les changements avant chaque commit.

Technologies :

* TanStack Start.
* React.
* Vite.
* Tailwind.
* TypeScript.
* Supabase.

Infrastructure :

* VPS Oracle Linux 9.8.
* Utilisateur opc.
* Répertoire /home/opc/her-v5-production.
* Données /home/opc/fwu-data.
* PM2.
* Render.

Supabase est utilisé pour les données du site. SQLite est utilisé pour les données locales partagées.

La clé service_role reste exclusivement côté serveur.

Ne jamais exposer de secret dans le navigateur.

3. ARCHITECTURE DES 11 BOTS

Le code doit rester commun autant que possible.

Chaque processus démarre avec PND_BOT_PROFILE et son propre token Discord.

Six bots existants

Profil	Nom Discord	Processus PM2	Mission
fwu	Bot principal	her-v5-bot	IA, coordination, communauté
guard	GUARD	fwu-guard	Sécurité
fdpdlavoc	FDPDLAVOC	fwu-fdpdlavoc	Vocal, musique, radio
suckme	SUCK ME	fwu-suckme	SYS+, staff, administration
fisc	LE FISC	fwu-fisc	Économie PND
investplus	Invest +	fwu-investplus	Investissements

Ne casse aucun profil ou processus existant.

Cinq nouveaux bots

Profil	Nom Discord	Mission
social	SOCIAL	Vie communautaire
event	EVENT	Événements
dispatch	DISPATCH	Notifications et communications
arcade	ARCADE	Jeux et divertissement
authority	AUTHORITY	Dérogations et autorisations

INSIGHT sera un service interne d’analyse.

FWU CORE sera l’infrastructure commune.

Ne transforme pas automatiquement les services internes en bots Discord indépendants.

Ne crée pas les nouveaux processus en production avant validation de leur architecture.

4. FWU CORE — INFRASTRUCTURE COMMUNE

Créer progressivement :

* API centrale.
* Bus d’événements.
* Identité universelle.
* Service de permissions.
* Journal d’audit.
* API économique.
* Service de notifications.
* Service de santé.
* Gestion des erreurs.
* File persistante d’événements.

Prévoir :

* Identifiants uniques.
* Idempotence.
* Authentification interservices.
* Vérification des signatures.
* Gestion des doublons.
* Gestion des reprises.
* Isolation des serveurs.
* Invalidation des autorisations révoquées.

Un bot indisponible ne doit pas provoquer l’arrêt de tout l’écosystème.

Les événements importants doivent être conservés et traités après le retour du service destinataire.

Le bot principal ne doit jamais être un point de panne unique.

5. AUTHORITY — GESTIONNAIRE CENTRAL DES DÉROGATIONS

AUTHORITY est un département majeur et un bot Discord indépendant.

Profil : authority.

Son rôle est de gérer toutes les dérogations et autorisations exceptionnelles de l’écosystème FWU.

A. Périmètre complet

AUTHORITY gère les demandes concernant :

* Dérogations de commandes.
* Permissions applicatives.
* Accès exceptionnels aux modules.
* Dérogations temporaires.
* Exceptions de quotas.
* Accès temporaires à des fonctionnalités staff.
* Délégations d’actions précises.
* Autorisations vocales.
* Autorisations économiques.
* Autorisations d’investissement.
* Autorisations communautaires.
* Autorisations événementielles.
* Autorisations des nouveaux bots.
* Demandes concernant les permissions Discord.

Il constitue le registre central des exceptions.

B. OWNER uniquement pour les approbations

Toutes les demandes de dérogation nécessitent l’approbation exclusive de l’OWNER configuré dans PND_OWNER_DISCORD_ID.

Aucun SYS+, ADMIN+, administrateur Discord ou autre bot ne peut approuver une demande.

L’identité de l’OWNER repose exclusivement sur son ID configuré.

Ne jamais utiliser le propriétaire du serveur Discord ou les permissions administrateur comme substitut.

Personne ne peut :

* S’accorder une dérogation.
* Approuver sa propre demande.
* Modifier une dérogation approuvée sans OWNER.
* Prolonger une autorisation sans OWNER.
* Modifier son bénéficiaire sans OWNER.
* Modifier les règles fondamentales d’AUTHORITY.
* Accorder une autorisation à l’OWNER.

OWNER peut :

* Approuver.
* Refuser.
* Suspendre.
* Révoquer.
* Modifier.
* Prolonger.
* Consulter toutes les demandes.

Aucune délégation du pouvoir d’approbation.

C. Processus de demande

Chaque demande comporte :

* Identifiant unique.
* Serveur concerné.
* Demandeur.
* Bénéficiaire.
* Permission souhaitée.
* Bot ou service concerné.
* Justification obligatoire.
* Durée demandée.
* Date de création.
* Statut.

Statuts :

* En attente.
* Approuvée.
* Refusée.
* Active.
* Suspendue.
* Expirée.
* Révoquée.

Processus :

1. Le membre demande une dérogation.
2. Il sélectionne le type.
3. Il indique le bénéficiaire.
4. Il explique la justification.
5. Il demande une durée.
6. AUTHORITY vérifie l’éligibilité.
7. OWNER reçoit la demande en privé.
8. OWNER approuve ou refuse.
9. Le résultat est enregistré.
10. L’autorisation est appliquée uniquement si toutes les conditions de sécurité sont satisfaites.

D. Durées et révocations

Les dérogations sont temporaires par défaut.

Prévoir :

* Durée personnalisée.
* Date d’expiration.
* Rappels.
* Expiration automatique.
* Suspension.
* Révocation immédiate.
* Historique des prolongations.

Les expirations doivent fonctionner après un redémarrage du bot.

Ne jamais dépendre uniquement de timers en mémoire.

E. Architecture technique

Créer :

* Service central de dérogations.
* API de vérification.
* Registre persistant.
* Historique d’audit.
* Mécanisme d’expiration.
* Mécanisme de révocation.
* Contrôle OWNER.
* Notifications.

Les autres bots interrogent le service central lorsqu’une dérogation est nécessaire.

En cas d’indisponibilité d’AUTHORITY :

* Aucune nouvelle dérogation ne peut être accordée.
* Aucune autorisation implicite ne peut être créée.
* Les permissions normales déjà valides continuent de fonctionner.
* Les autorisations mises en cache doivent avoir une durée de validité courte.
* Les révocations doivent invalider les caches.

F. Permissions Discord

AUTHORITY ne remplace jamais :

bot/role-grant-guard.js

Toutes les attributions de rôles continuent de passer par cette garde centrale.

Une dérogation applicative ne constitue jamais une permission Discord.

AUTHORITY ne peut pas :

* Contourner la hiérarchie Discord.
* Dépasser les permissions réelles des bots.
* Attribuer un rôle supérieur à celui du bot.
* Attribuer automatiquement des rôles staff protégés.
* Supprimer les protections Tier 0.
* Contourner les règles de modération.
* Accorder des permissions interdites par Discord.

Toute demande de modification de permission Discord doit subir une vérification indépendante des capacités réelles du bot et des règles de sécurité.

Aucune approbation ne doit entraîner automatiquement une action dangereuse.

G. Intégration aux bots

AUTHORITY doit être intégré à :

* Bot principal.
* GUARD.
* SUCK ME.
* FDPDLAVOC.
* LE FISC.
* INVEST +.
* SOCIAL.
* EVENT.
* DISPATCH.
* ARCADE.
* INSIGHT.

Chaque service reste responsable de ses permissions normales.

AUTHORITY intervient uniquement pour les exceptions.

H. Commandes et interfaces

Commandes à étudier :

* /authority demander
* /authority mes-demandes
* /authority statut
* /authority historique

Commandes OWNER à définir après audit du catalogue existant.

Créer également un panneau interactif avec boutons et menus.

L’OWNER doit pouvoir consulter les demandes, approuver, refuser, suspendre, révoquer et consulter l’historique.

Respecter les 100 commandes slash par application.

I. Console

Créer une page AUTHORITY dans la console.

Elle doit utiliser la même API que Discord.

Fonctionnalités :

* Liste des demandes.
* Approbation.
* Refus.
* Liste des autorisations actives.
* Modification.
* Suspension.
* Révocation.
* Expirations.
* Historique.
* Export.

La console reste réservée à l’OWNER selon les règles OAuth existantes.

J. Audit de sécurité

Créer des tests couvrant :

* Approbation OWNER.
* Refus OWNER.
* Tentative d’approbation SYS+.
* Tentative d’approbation ADMIN+.
* Auto-attribution.
* Tentative de dérogation Tier 0.
* Attribution d’un rôle protégé.
* Expiration.
* Révocation.
* Redémarrage du bot.
* Indisponibilité d’AUTHORITY.
* Isolation entre serveurs.
* Double validation.
* Réutilisation d’une ancienne interaction.
* Modification directe du registre.

Toute anomalie doit entraîner un refus sécurisé.

6. SUCK ME — STAFF CENTER

Priorité fonctionnelle absolue.

Auditer les fonctionnalités existantes avant modification.

Gestion du personnel

* Dossiers individuels.
* Historique des interventions.
* Disponibilités.
* Absences.
* Astreintes.
* Planning hebdomadaire.
* Passation de service.
* Missions individuelles et collectives.
* Objectifs.
* Réunions.
* Comptes rendus.

Interventions

* Dossiers d’intervention.
* Identifiants uniques.
* Attribution.
* Historique.
* Preuves.
* Enquêtes.
* Rappels.
* Validations secondaires.
* Clôture.
* Archivage.
* Contestations.

Conserver les systèmes de sanctions, quotas et enquêtes existants.

Formation

* Parcours d’intégration.
* Formation des nouveaux modérateurs.
* Simulations de raid.
* Exercices de gestion de conflits.
* Tests de connaissances.
* Validation par un responsable.
* Documentation interactive.

Une formation ne donne jamais automatiquement des permissions Discord.

Analyse du staff

* Nombre d’interventions.
* Dossiers traités.
* Délais.
* Charge de travail.
* Participation aux astreintes.
* Respect des procédures.
* Qualité des interventions.

Ne pas encourager la multiplication des sanctions.

STAFF COMMAND

Créer un centre de commandement Discord.

Commande envisagée :

/staff centre

Afficher :

* Staff disponible.
* Incidents actifs.
* Enquêtes.
* Demandes d’assistance.
* Alertes GUARD.
* Actions en attente.
* Astreintes.
* Dossiers ouverts.

Intégrer AUTHORITY pour les demandes de dérogations.

7. CENTRE D’AIDE UNIVERSEL

Chaque membre doit pouvoir obtenir de l’aide sans connaître les commandes Discord.

Auditer /aide, /guide et /assistance avant toute création.

Catégories

* Bienvenue.
* Présentation des bots.
* Commandes.
* Sécurité.
* Vocal.
* Économie.
* Investissements.
* Événements.
* Jeux.
* Fonctionnement du serveur.
* Questions fréquentes.
* Dépannage.
* Contact du staff.
* Dérogations.

Présentation des bots

Chaque bot dispose d’une présentation détaillée :

* Mission.
* Fonctionnalités.
* Commandes.
* Conditions d’utilisation.
* Permissions.
* Exemples.

Les explications doivent être accessibles à tout moment.

Tutoriels interactifs

Créer des tutoriels avec boutons, menus et embeds.

Exemples :

* Créer un salon vocal.
* Utiliser les PND.
* Acheter un objet.
* Investir.
* Participer à un événement.
* Rejoindre une activité.
* Consulter son profil.
* Demander une dérogation.
* Utiliser les fonctions de chaque bot.

Permettre de revenir en arrière, recommencer ou quitter.

Assistant IA conversationnel

Les membres peuvent poser des questions naturellement.

Exemples :

« Comment gagner des PND ? »

« Pourquoi ma commande ne fonctionne pas ? »

« Comment créer mon salon vocal ? »

« Comment participer à un événement ? »

« Comment demander une autorisation ? »

L’IA doit :

* Identifier le bot concerné.
* Consulter la documentation réelle.
* Expliquer simplement.
* Fournir les commandes exactes.
* Proposer des exemples.
* Orienter vers les tutoriels.
* Signaler ses incertitudes.
* Proposer une assistance humaine.

Ne jamais inventer de fonctionnalité ou de commande.

Ne jamais divulguer les dossiers privés ou les données du staff.

Dépannage et tickets

1. Le membre explique son problème.
2. Le système identifie le bot.
3. Il consulte les informations disponibles.
4. Il propose des solutions.
5. Si nécessaire, une demande d’assistance est créée.
6. Un identifiant de suivi est attribué.
7. Le staff autorisé traite la demande.
8. Le membre reçoit les mises à jour.

Auditer le système de tickets existant avant toute modification.

Ne pas créer deux systèmes concurrents.

Documentation automatique

Générer la documentation depuis les véritables définitions des commandes.

Chaque commande doit disposer de :

* Nom.
* Description.
* Utilité.
* Paramètres.
* Permissions.
* Exemple.
* Erreurs possibles.
* Solutions.

Accueil des membres

Créer :

* Message de bienvenue.
* Guide de démarrage.
* Présentation des bots.
* Guide des salons.
* Guide des commandes.
* Tutoriels.

Ne pas modifier automatiquement les salons, rôles ou paramètres existants.

8. SOCIAL — COMMUNAUTÉ

Créer :

* Profils personnalisés.
* Présentations.
* Centres d’intérêt.
* Réputation.
* Succès.
* Récompenses.
* Ancienneté.
* Historique événementiel.
* Mise en avant des membres.
* Activités collectives.
* Annuaire communautaire.

Réutiliser les fonctionnalités existantes du bot principal.

9. EVENT — ÉVÉNEMENTS

Créer :

* Calendrier.
* Création d’événements.
* Inscriptions.
* Listes d’attente.
* Votes.
* Tournois.
* Gestion des participants.
* Rappels.
* Récompenses.
* Historique.
* Salons temporaires.
* Événements vocaux et textuels.

Intégrer SOCIAL, FDPDLAVOC, LE FISC et DISPATCH.

10. DISPATCH — COMMUNICATIONS

Créer :

* Notifications personnelles.
* Alertes staff.
* Annonces ciblées.
* Notifications événementielles.
* Rappels.
* Alertes de sécurité.
* Maintenance.
* Relais inter-bots.
* Préférences de notification.

Prévoir quotas, anti-doublons, anti-spam, priorités et journalisation.

11. ARCADE — JEUX

Créer :

* Quiz multijoueurs.
* Blind tests.
* Jeux de culture générale.
* Jeux de stratégie.
* Tournois.
* Défis.
* Classements saisonniers.
* Succès cachés.
* Récompenses PND.
* Jeux vocaux.

Toutes les récompenses passent par l’API économique centrale.

12. INSIGHT — ANALYSE

Développer INSIGHT comme service interne.

Fonctionnalités :

* Statistiques communautaires.
* Membres actifs.
* Fréquentation.
* Activité du staff.
* Activité vocale.
* Économie.
* Événements.
* Rapports hebdomadaires.
* Rapports mensuels.
* Tendances.
* Analyse des incidents.

Respecter la confidentialité et les autorisations.

13. ÉCONOMIE COMMUNE

Relier LE FISC et INVEST +.

Fonctionnalités :

* Entreprises virtuelles.
* Métiers.
* Contrats.
* Marché entre membres.
* Immobilier virtuel.
* Bourse fictive.
* Fonds d’investissement.
* Dividendes.
* Portefeuilles.
* Classements.

Créer un registre transactionnel central.

Toutes les opérations doivent être authentifiées, atomiques, traçables, idempotentes et isolées par serveur.

Prévoir corrections et remboursements contrôlés.

Aucun bot ne doit créer directement de PND.

14. ÉVOLUTION DES BOTS ACTUELS

BOT PRINCIPAL :

* Assistant IA global.
* Mémoire collective.
* Coordination.
* Recherche universelle.
* Assistance staff.
* Résumés.
* Configuration.
* Relais de secours.

GUARD :

* Centre d’incidents.
* Simulations de sécurité.
* Analyse des risques.
* Surveillance.
* Historique des anomalies.

SUCK ME :

* STAFF CENTER.
* Commandement.
* Formation.
* Missions.
* Planning.
* Passation.
* Suivi des dossiers.

FDPDLAVOC :

* Émissions.
* Événements vocaux.
* DJ communautaire.
* Statistiques.
* Activités vocales.

LE FISC :

* Entreprises.
* Métiers.
* Marché.
* Contrats.
* Immobilier fictif.
* Équilibrage économique.

INVEST + :

* Bourse virtuelle.
* Fonds.
* Portefeuilles.
* Indices.
* Dividendes.

15. CONSOLE WEB

Faire évoluer la console existante sans reconstruire le site.

Conserver son identité noir et blanc, sobre et fonctionnelle.

Pages :

1. Vue générale.
2. Santé des bots.
3. Sécurité.
4. Incidents.
5. Staff.
6. Membres.
7. Dossiers.
8. AUTHORITY.
9. Économie.
10. Événements.
11. Analyses.
12. Automatisations.
13. Historique.
14. Configuration.

Fonctionnalités :

* État des 11 bots.
* État des services internes.
* Santé VPS.
* Redémarrages.
* Historique des pannes.
* Modération.
* Gestion du staff.
* Gestion des dérogations.
* Historique des autorisations.
* Statistiques.
* Exports CSV.
* Tâches planifiées.
* Alertes.
* Sauvegardes.
* Comparaison des versions.
* Déploiements.
* Retour arrière contrôlé.
* Dépendances entre services.

Les actions sensibles nécessitent autorisation, confirmation et audit.

La console reste réservée à l’OWNER selon le système OAuth existant.

16. SÉCURITÉ NON NÉGOCIABLE

* OWNER : seul propriétaire technique configuré.
* SYS+ et ADMIN+ : hiérarchie existante.
* WHITELIST : ne contourne jamais les permissions Discord.
* Tier 0 : intouchable.
* Permissions identifiées par IDs et permissions effectives, jamais par noms.
* Toute attribution de rôle passe par bot/role-grant-guard.js.
* Les rôles protégés ne sont jamais attribués automatiquement.
* Les commandes owner utilisent uniquement l’ID configuré.
* Données isolées par serveur.
* MZ reste désactivé jusqu’à validation.
* Les détecteurs automatiques déclenchent des alertes, pas des sanctions irréversibles.
* Aucun secret dans le code, les messages ou les logs.
* Aucun token de production dans les tests.
* Données sensibles réservées au staff.
* Réponses en embeds lorsque cela est approprié.
* Aucun système de factions.

AUTHORITY ne doit jamais devenir une porte dérobée permettant de contourner ces règles.

17. IDENTITÉ ET LIMITES DISCORD

Le nom officiel FWU V2 est réservé au site et à la documentation.

Il ne doit pas apparaître dans les embeds, messages ou noms de rôles et salons créés sur Discord.

Chaque bot dédié signe avec son propre nom.

Le bot principal s’appelle « Bot principal » et ne signe rien.

Discord limite les commandes slash à 100 par application.

Avant chaque ajout :

* Auditer le nombre de commandes.
* Vérifier les doublons.
* Regrouper les sous-fonctions.
* Préserver les commandes existantes.
* Conserver les équivalents préfixés.
* Tester les interactions.

18. VPS ET DÉPLOIEMENT

Conserver le script :

/home/opc/fwu-auto-update.sh

Préserver son mécanisme de sauvegarde et de retour arrière.

Améliorations :

* Rotation des journaux PM2.
* Surveillance mémoire.
* Surveillance disque.
* Sauvegardes chiffrées hors VPS.
* Tests de restauration.
* Vérification pm2 startup.
* Vérification pm2 save.
* Git sur le VPS.
* Déploiement après validation.
* Raccourci SSH.
* Historique des déploiements.
* Alertes.

Prévoir une gestion intelligente des refus de connexion Discord et des limites de sessions.

Ne jamais provoquer une boucle de reconnexion.

19. FEUILLE DE ROUTE

Respecter cet ordre général :

PHASE 0 — Audit et stabilisation.

PHASE 1 — STAFF CENTER.

PHASE 2 — FWU CORE.

PHASE 3 — AUTHORITY.

PHASE 4 — Centre d’aide universel.

PHASE 5 — SOCIAL et EVENT.

PHASE 6 — Économie interconnectée.

PHASE 7 — DISPATCH.

PHASE 8 — ARCADE.

PHASE 9 — INSIGHT.

PHASE 10 — Automatisation et supervision avancées.

L’ordre doit être ajusté en fonction des dépendances techniques réelles, sans perdre les objectifs.

Chaque phase doit être découpée en petites tâches.

Ne pas tout développer en même temps.

20. TESTS OBLIGATOIRES

Commande de vérification globale :

bash scripts/verify-all.sh

Elle doit notamment couvrir :

* npm --prefix bot test
* npm --prefix bot run smoke
* npm --prefix bot run audit:commands
* npm --prefix bot run audit:replies
* npx vitest run
* npx tsc --noEmit
* npx eslint .

Ajouter les tests nécessaires pour :

* Les six profils existants.
* Les cinq nouveaux profils.
* Les commandes slash.
* Les commandes préfixées.
* Les permissions.
* AUTHORITY.
* Les dérogations.
* Les expirations.
* Les révocations.
* L’isolation des serveurs.
* Les communications inter-bots.
* Les transactions.
* Les files persistantes.
* La reprise après panne.
* Les tutoriels.
* Le centre d’aide.
* La confidentialité.

Ne jamais déclarer une phase terminée avec des tests en échec.

Aucun token de production dans les tests.

21. DOCUMENTATION

Créer et maintenir :

docs/ECOSYSTEME_FWU_V2_MASTER_PLAN.md

Il doit contenir :

* Architecture actuelle.
* Architecture cible.
* Les 11 bots.
* Les services internes.
* Fonctionnalités existantes.
* Fonctionnalités à améliorer.
* Fonctionnalités à créer.
* AUTHORITY et ses protections.
* Dépendances.
* Permissions.
* Sécurité.
* Plan de migration.
* Tests.
* Critères de validation.
* Progression des tâches.

Maintenir également un suivi des tâches terminées, en cours et restantes.

Ne pas créer des documents redondants inutilement.

22. PREMIÈRE MISSION : AUDIT UNIQUEMENT

TU NE DOIS PAS COMMENCER À CODER IMMÉDIATEMENT.

Ta première mission consiste uniquement à analyser le dépôt.

Examiner :

1. Structure du dépôt.
2. Documentation existante.
3. Six profils actuels.
4. Commandes.
5. Fonctionnalités opérationnelles.
6. Fonctionnalités incomplètes.
7. Permissions.
8. bot/role-grant-guard.js.
9. Bases de données.
10. Migrations Supabase.
11. Déploiement.
12. PM2.
13. Tests.
14. Sécurité.
15. Tickets existants.
16. Centre d’aide existant.
17. Limites slash.
18. Dépendances entre bots.
19. Intégration d’AUTHORITY.
20. Comparaison avec ce cahier des charges.

Créer ensuite :

docs/ECOSYSTEME_FWU_V2_MASTER_PLAN.md

Présenter :

* État réel du projet.
* Architecture actuelle.
* Architecture cible.
* Les 11 bots.
* Services internes.
* Fonctionnalités existantes.
* Fonctionnalités à compléter.
* Fonctionnalités nouvelles.
* Dépendances.
* Risques.
* Sécurité.
* Plan de migration.
* Tests.
* Ordre précis des tâches.
* Priorités.
* Critères de validation.

Pendant cet audit :

* Ne modifie pas le comportement des bots.
* Ne crée pas les nouveaux processus PM2.
* Ne demande pas de nouveaux tokens.
* Ne touche pas à la configuration du serveur Discord.
* Ne déploie rien en production.

À la fin, présente-moi le compte rendu et propose UNIQUEMENT la première tâche concrète.

ATTENDS MA VALIDATION AVANT DE COMMENCER LE DÉVELOPPEMENT.

23. OBJECTIF FINAL

Je veux faire de FWU un écosystème Discord complet :

* Un staff doté d’outils professionnels.
* Un centre d’aide accessible à tous les membres.
* Des bots spécialisés qui communiquent entre eux.
* Une gestion centrale et sécurisée des dérogations via AUTHORITY.
* Une économie commune.
* Une communauté active.
* Des événements automatisés.
* Des jeux intégrés.
* Une IA qui assiste les membres et le staff.
* Une console qui supervise tout.
* Une infrastructure résiliente.

La stabilité, la sécurité et la qualité passent avant la vitesse.

Tu es responsable de préserver l’existant et de construire progressivement cet écosystème.

UNE TÂCHE À LA FOIS.

AUDIT AVANT DÉVELOPPEMENT.

TESTS AVANT VALIDATION.

AUCUNE SUPPRESSION DE FONCTIONNALITÉ EXISTANTE.
# PND Assist V5 — Night Work (16 novembre 2026)

## Changements de cette session

### Commandes slash et registre commun
- Ajout du dispatch slash vers les services existants Business/Investissements, Casino et Organisation (événements, Academy, Awards, Stories, Radar, Wrapped, candidatures).
- Les commandes slash réutilisent les gestionnaires métier existants plutôt que de dupliquer les opérations.
- Regroupement de sous-commandes de compatibilité sous `/pnd` et `/sysp` pour rester sous la limite Discord.
- Alignement des noms de sous-commandes françaises (`creer`, `liste`) entre le catalogue et le routeur.
- Ajout des actions de revue Guardian dans `/guildguard`.
- Catalogue vérifié : 98 commandes racines, 10 catégories, aucun nom racine dupliqué.

### Sécurité Business / Investissements
- Le déclenchement de la paie d'une entreprise exige désormais l'identifiant de son propriétaire.
- Les gestionnaires préfixés transmettent l'acteur à la couche métier.
- La longueur maximale des noms et les limites de risque exposées par slash correspondent aux limites du service.

### Guardian Risk Review
- Signaux agrégés à partir des métadonnées de messages : rafales de mentions, liens et messages rapides.
- Fenêtre glissante de 15 minutes, score plafonné, niveaux d'alerte et seuil de revue humaine.
- Dossier de revue par membre et serveur, avec résolution `reviewed` ou `cleared` et journalisation du réviseur.
- Commandes préfixées `=guardian-review list` et `=guardian-review resolve ...`.
- Sous-commandes slash `/guildguard review` et `/guildguard resolve`.
- Aucune sanction automatique : le score sert uniquement à prioriser une vérification humaine.
- Les signaux stockés sont des métadonnées bornées ; le contenu des messages, URL et pièces jointes ne sont pas persistés par ce module.
- Nettoyage périodique des signaux anciens et des dossiers résolus.

## Contrôles réalisés

- 160 fichiers JavaScript : `node --check` sans erreur.
- 69 tests ciblés : 69 réussis, 0 échec.
- `src/lib/slash-commands.ts` : compilation TypeScript isolée réussie avec `tsc`.
- Contrôle du catalogue : 98 commandes racines, aucun doublon, 10 catégories, limites de noms/descriptions/options vérifiées.
- `git diff --check` : aucune erreur d'espacement.

## Limites connues

- L'environnement de travail utilise Node 22.16.0 alors que le projet déclare Node >=24.
- `bot/node_modules/discord.js` est incomplet et le registre npm n'était pas joignable (échec DNS `EAI_AGAIN`).
- La suite bot complète et la suite dashboard/build n'ont donc pas pu être validées dans cet environnement. Le résultat 69/69 concerne uniquement les tests ciblés listés dans le journal de session.
- Le véritable aller-retour Discord OAuth2 et les interactions sur un serveur Discord ne sont pas testés ici.
- Aucune commande n'a été publiée auprès de Discord et aucun déploiement/accès Oracle/DB de production n'a été effectué.

## Reprise

1. Utiliser Node 24 ou supérieur.
2. Installer les dépendances depuis le réseau autorisé (`npm install` à la racine et dans `bot/` selon les scripts du dépôt).
3. Exécuter la suite dashboard et bot complète.
4. Configurer `PND_OWNER_DISCORD_ID` et `PND_COFOUNDER_DISCORD_IDS` et les identifiants OAuth dans l'environnement sécurisé sans les ajouter au dépôt.
5. Réaliser des tests d'intégration sur un serveur Discord de test avant tout déploiement PND.

Cette documentation décrit le code présent dans cet export ; elle ne constitue pas une attestation de déploiement ou de test en production.

## Complément — Protections personnelles du PND Casino

- Ajout de `casino_controls`, isolée par serveur et membre, pour enregistrer une auto-exclusion et une limite quotidienne de mises.
- Commandes préfixées : `=casino limites`, `=casino limite <montant|off>` et `=casino pause 24h|7j|30j|permanent`.
- Commandes slash équivalentes sous `/casino` : `limites`, `limite`, `limite-off`, `pause`.
- Auto-exclusion personnelle : une échéance existante ne peut être raccourcie ; aucune commande staff ne permet de la lever.
- La limite quotidienne agrège les débits Casino, roulette legacy et blackjack legacy sur la journée civile `Europe/Paris`.
- Vérification faite à l'intérieur de la transaction SQLite avant chaque nouveau débit, donc partagée par les interfaces slash/préfixe.
- Tests couvrent le changement CET/CEST, l'isolation serveur/membre, limite atteinte, exclusion, et absence de débit en cas de refus.
- Contrôles ciblés : `node --test bot/casino*.test.js` (11/11) ; TypeScript isolé sur `src/lib/slash-commands.ts` ; `node --check` sur les fichiers JS modifiés ; catalogue 98 commandes racines uniques / 10 catégories.

## Complément — Academy et cycle de vie des événements

- Academy : ajout de questions de quiz par le staff avant le démarrage d'un parcours ; modification interdite dès qu'un membre a commencé ; 2 à 5 choix, maximum 5 questions par étape.
- Les réponses correctes (`answerIndex`) ne sont jamais exposées dans la vue remise aux apprenants.
- Les commandes préfixées et slash couvrent l'ajout de quiz, l'affichage détaillé d'une étape, la progression personnelle et la validation séquentielle des étapes.
- Événements : ajout de l'annulation par l'organisateur ou un membre autorisé du staff, depuis le préfixe et `/pndevent cancel`.
- Les événements annulés disparaissent des prochaines listes et refusent toute nouvelle inscription ; migration SQLite additive `cancelled_at`, sans suppression des événements existants.
- Clôture Awards : calcul du résultat et passage à l'état fermé dans une transaction ; une campagne sans vote n'annonce plus artificiellement un gagnant.
- Vérification : `node --test bot/organization*.test.js bot/casino*.test.js bot/business-investments*.test.js` (36/36).
- Vérification TypeScript isolée : `tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck src/lib/slash-commands.ts` (réussie).
- La suite Vitest complète reste indisponible dans cette copie faute de dépendances installées ; le projet exige Node >=24 et l'environnement est Node 22.

## Complément — PND Intelligence (gestion de salons)

- Ajout de demandes directes en français pour renommer un salon, modifier son sujet et régler/désactiver le mode lent.
- Les demandes exigent une cible Discord explicite `<#ID>` ; les IDs et valeurs sont revalidés dans l'allowlist avant création de l'aperçu.
- Chaque modification vérifie à nouveau les permissions du demandeur et du bot (`Gérer les salons`) et récupère le salon dans le serveur courant.
- Les changements ne sont jamais exécutés au moment de la demande : aperçu + confirmation SYS+ / propriétaire PND, puis exécution et journalisation existantes.
- Limites : mode lent de 0 à 21 600 secondes ; sujet Discord limité à 1 024 caractères ; nom de salon normalisé et limité à 100 caractères.
- Vérification : tests PND Intelligence policy/access/store (8/8), syntaxe JS des fichiers modifiés.

## Complément — Recrutement (affectation et entretiens)

- Ajout d'une affectation de candidature à un responsable, historisée avec l'auteur et la date.
- Ajout d'un calendrier d'entretiens : candidature liée, évaluateur, date ISO avec fuseau obligatoire, salon textuel facultatif et état `scheduled/completed/cancelled`.
- Ajout de l'évaluation d'entretien (note 1–5 et notes internes) et de l'annulation.
- Les actions de gestion sont réservées au staff autorisé ; les évaluateurs et responsables sont vérifiés comme membres humains du serveur dans le gestionnaire Discord.
- Ajout des commandes préfixées et slash : `assign`, `entretien`, `entretiens`, `evaluation`, `annuler-entretien`.
- Tables SQLite `recruitment_assignments` et `recruitment_interviews`, liées aux candidatures avec suppression en cascade à l'expiration de leur dossier.
- Vérification : suites ciblées organisation, recrutement, PND Intelligence, Casino et Business/Investissements (46/46).
- Une décision finale (`accepted` ou `rejected`) annule désormais atomiquement les entretiens encore planifiés ; les entretiens terminés restent dans l'historique.
- Rappels d'entretien : maintenance horaire, fenêtre de 24 h avant l'entretien, envoi dans le salon planifié ou en DM au candidat et à l'évaluateur si aucun salon n'est défini. Réservation atomique du rappel, anti-doublon et libération du verrou si la livraison échoue ; aucun rappel n'est marqué envoyé sans livraison réussie.
- La maintenance organisationnelle est désormais asynchrone et évite les exécutions concurrentes du même cycle.
- Tests de maintenance : 3/3, incluant rappel unique et nouvelle tentative après échec DM.

## Complément — PND Voice Access (expiration et déblocage)

- Les demandes vocales en attente expirent automatiquement toutes les 30 secondes ; les demandes en traitement disposent d'une grâce de cinq minutes pour ne pas interrompre une requête Discord déjà lancée.
- Ajout de `=demandevocal debloquer <#vocale> <@membre>` et `/voc debloquer`, limités au propriétaire de la vocale, au propriétaire serveur ou au staff ayant Gérer les salons/Administrateur.
- Les expirations et suppressions de blocage sont isolées par serveur et vocale.
- Le traitement d'une décision `blocked` et l'enregistrement du blocage sont maintenant réunis dans une transaction SQLite.
- Tests ciblés du store vocal : 2/2 ; syntaxe JS et TypeScript du catalogue vérifiées.
- Événements : rappel automatique dans le salon où l'événement a été créé, dans les 24 h précédant son démarrage ; le message inclut date relative, description, organisateur et nombre d'inscrits. Les mentions sont limitées à l'organisateur, jamais `@everyone`.
- Les rappels d'événements sont idempotents (`notified`) et réessayés si le salon a été supprimé ou si l'envoi échoue ; les événements annulés ne sont pas rappelés.
- Tests maintenance/organisation : 19/19.
- Sécurité PND Intelligence : une annonce ne peut être publiée que dans un salon du serveur courant où le demandeur ET le bot disposent tous deux de Voir le salon + Envoyer des messages.
- Évaluation recrutement : impossible de noter un entretien avant son horaire prévu ; la mise à jour vérifie l'échéance dans la requête SQL elle-même pour éviter une course entre lecture et validation.
- PND Logs vocal : attribution via Audit Log resserrée à 6 secondes, avec contrôle du salon de destination lorsqu'il est fourni par Discord ; les entrées ambiguës ou indisponibles restent explicitement « Non identifié via Audit Log » plutôt que d'attribuer un mauvais modérateur.
- PND Logs vocal : ajout de `/vocalpresence date` en complément de `=vocalpresence`, pour consulter l'historique des membres présents à un instant donné. La commande conserve son contrôle staff dédié et n'est pas ajoutée aux permissions des commandes de gestion vocale SYS+/ADMIN+.

## Complément — Historique staff unifié

- Ajout de `=staffhistory <@membre>` et `/staffhistory membre` pour fusionner les dossiers de modération, événements d'audit et sessions vocales d'un membre dans une chronologie triée.
- Affichage borné à 25 éléments par commande (service limité à 50), avec précision des sessions vocales et mention explicite des durées inconnues/approximatives.
- Accès limité au propriétaire PND/serveur, SYS+, ADMIN+, Administrateur ou Gérer le serveur ; aucune donnée audio ou contenu de DM n'est exposé.
- Catalogue slash vérifié par compilation TypeScript : exactement 100 commandes racines, aucun doublon.
- Test du service d'historique : 1/1.
- L'historique staff unifié inclut aussi les candidatures, responsables affectés, entretiens et évaluations, sans exposer les réponses complètes des dossiers dans cette chronologie.
- OAuth dashboard : l'état PKCE est maintenant consommé et le cookie de session est effacé avant l'échange du code Discord ; un échec d'échange ne laisse pas un état d'autorisation réutilisable dans le navigateur.

## Complément — Formulaire de recrutement configurable

- Le staff peut définir de 1 à 10 questions via `=candidatures questions Q1 | Q2` ou `/candidature questions configuration`.
- `=candidature` affiche le formulaire actif ; les réponses doivent correspondre exactement au nombre de questions et restent bornées à 500 caractères chacune.
- Chaque dossier conserve un instantané des libellés de questions au moment du dépôt : modifier le formulaire n'altère pas les anciens dossiers.
- La consultation staff affiche les questions et réponses côte à côte ; les questions sont limitées au serveur et la configuration exige les droits staff.
- Tests organisation/recrutement : 20/20 ; catalogue TypeScript compilé.

## Complément — PND Access / attribution des invitations

- Ajout d'un snapshot SQLite des invitations par serveur (code, nombre d'utilisations, créateur) et du compteur d'URL personnalisée.
- À chaque arrivée, comparaison des compteurs : attribution au créateur uniquement si une seule invitation a exactement progressé d'une utilisation ; plusieurs deltas, données absentes ou permissions insuffisantes donnent « attribution inconnue ».
- Les arrivées par URL personnalisée sont identifiées comme telles, sans inventer de créateur.
- Les créations/suppressions d'invitations sont journalisées dans PND Logs ; snapshot au démarrage et à l'arrivée d'un serveur autorisé.
- Activation de l'intent Gateway `GuildInvites`. L'accès à `guild.invites.fetch()` dépend aussi des permissions Discord du bot ; en cas d'absence, le système reste fail-closed et indique une attribution inconnue.
- Tests attribution invitations : 2/2.
- Les commandes communautaires/recrutement/Academy/Awards/Stories reconnaissent maintenant les rôles SYS+ et ADMIN+ configurés ainsi que le propriétaire PND unique et les deux cofondateurs configurés séparément, en plus du staff Discord ManageGuild/Administrator. Les identifiants propriétaires mal configurés échouent fermés.
- Les décisions de candidature envoient désormais une notification privée au candidat (acceptée/refusée/en cours) ; les notes internes du staff ne sont jamais envoyées. Le bot signale si les DM sont fermés ou si le membre n'est plus accessible.
- Attribution invitations : les compteurs `uses` manquants/invalides provoquent désormais une attribution inconnue et aucune mise à jour du snapshot ; le bot ne traite jamais une valeur absente comme zéro.
- Audit vocal : les départs recherchent uniquement une entrée `MemberDisconnect`, les déplacements uniquement `MemberMove`, afin d'éviter qu'une action récente d'un autre type soit attribuée au mauvais événement.

## Complément — SYS+ Time Machine / Blueprints

- Ajout de snapshots de structure serveur (rôles non gérés, catégories/salons, permissions de rôles, paramètres textuels/vocaux) en SQLite, avec checksum SHA-256 et rétention bornée à 20 snapshots par serveur.
- Commandes `=sysp blueprint create <nom>`, `list`, `compare <id>` et `/sysp blueprint`.
- Comparaison affiche ajouts, suppressions et modifications de rôles/salons sans rien appliquer.
- Les snapshots excluent membres, messages, contenus, rôles gérés et overwrites individuels de membres ; seules les permissions de rôles sont conservées.
- Limite de taille par snapshot : 500 Ko. Les snapshots sont strictement isolés par guild_id.
- La restauration automatique n'est pas activée : seul l'export de référence et le diff sont implémentés, pour éviter toute modification destructive sans workflow de confirmation dédié.
- Tests blueprint : 2/2.
- Les blueprints peuvent maintenant être exportés en JSON (`=sysp blueprint export <id>` ou action Exporter de `/sysp blueprint`) ; le checksum SHA-256 est vérifié avant l'export et les fichiers restent limités au serveur propriétaire.
- PND Intelligence peut aussi créer un rôle, mais uniquement avec permissions vides, sans mentionnable/hoist et sans l'attribuer à un membre ; le demandeur et le bot doivent disposer de Gérer les rôles, puis l'aperçu doit être confirmé.

## Complément — SYS+ Incident Center

- Ajout d'un registre d'incidents par serveur : titre, résumé, gravité (faible/moyenne/élevée/critique), état (ouvert/en cours/résolu), créateur, responsable, résolution et horodatages.
- Cycle de vie : création, liste, consultation, affectation à un membre humain, changement ouvert/en cours et résolution documentée.
- Commandes `=sysp incident create|list|show|assign|status|resolve` et `/sysp incident`.
- Toutes les opérations sont réservées à SYS+ ; journalisation dans l'audit SYS+ ; impossible de réassigner un incident résolu ou de le rouvrir par un simple changement de statut.
- Test du service Incident Center : 1/1.
- Hiérarchie SYS+ : le propriétaire unique configuré dans `PND_OWNER_DISCORD_ID` reçoit le tier PND_OWNER ; les IDs distincts de `PND_COFOUNDER_DISCORD_IDS` reçoivent SYS+/ADMIN+ sans les droits owner-only. Les IDs absents, invalides, dupliqués ou chevauchants échouent fermés ; PRIME reste distinct et n'est pas un rôle.
- Rappels d'entretiens : suivi de livraison individuel pour candidat et évaluateur. En cas d'échec d'un DM, le prochain cycle ne renvoie pas le rappel à la personne qui l'a déjà reçu ; il ne termine qu'une fois les deux livraisons confirmées.
- L'historique staff inclut désormais aussi les incidents SYS+ auxquels le membre est lié (créateur, responsable ou résolveur), avec gravité, statut et résolution.

## Bilan consolidé — session de nuit

- Recrutement : formulaires configurables et instantanés de questions, affectation staff, calendrier d'entretiens, évaluations après l'heure prévue, notifications de décision et rappels individuels anti-doublons.
- PND Access : attribution persistante des invitations et de l'URL personnalisée, avec attribution inconnue dès que les compteurs ne permettent pas de conclure.
- PND Logs : historique staff unifié (modération, audit, présence vocale, recrutement, incidents) et attribution Audit Log vocale plus stricte.
- SYS+ : Time Machine / Blueprints (création, liste, comparaison, export JSON vérifié) et Incident Center (création, affectation staff, statut, résolution et logs centraux).
- PND Intelligence : création de rôles sans permissions, en plus des actions de salons déjà présentes, toujours avec aperçu et confirmation.
- Sécurité : propriétaires PND exacts, accès SYS+/ADMIN+ cohérent, rôles de gestion vérifiés pour les affectations, contrôle des permissions du demandeur et du bot.
- Validation ciblée finale : 79 tests réussis, 0 échec ; syntaxe JavaScript vérifiée sur les fichiers bot hors dépendances locales ; catalogue TypeScript compilé, 100 commandes racines, 19 sous-commandes SYS+, aucun doublon ni dépassement de limite.
- Non validé dans cet environnement : suite complète dashboard/bot, interactions Discord réelles, OAuth réel, appels IA externes et restauration destructive de blueprint. L'environnement disponible reste Node 22 et l'installation locale de `discord.js`/dépendances du projet est incomplète ; le projet cible Node 24.
- Aucun déploiement, aucune migration de production, aucun secret ajouté.

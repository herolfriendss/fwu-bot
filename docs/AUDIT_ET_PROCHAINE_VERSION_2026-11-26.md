# FWU — audit complet du 26/11/2026 et préparation de la prochaine version

Branche : `claude/epic-curie-dg0bud`. Aucun déploiement, redémarrage ou accès au VPS n'a été fait.

## 1. Résumé

Le code est en bon état : tous les tests passent, la protection des rôles, la hiérarchie et le cloisonnement des serveurs sont solides. L'audit a trouvé **6 défauts réels**, tous corrigés et couverts par des tests. Le principal risque restant n'est pas dans le code : environ 40 vérifications manuelles de `RECETTE_STAGING.md` n'ont pas encore été faites sur un serveur de test.

## 2. Ce qui a été vérifié (commandes exécutées)

| Vérification | Commande | Résultat |
|---|---|---|
| Tests des bots | `npm --prefix bot test` | 1 010 réussis, 0 échec, 26 ignorés (ils ont besoin de la base PostgreSQL partagée) |
| Smoke de toutes les commandes | `npm --prefix bot run smoke` | 2 694 exécutions, 0 anomalie |
| Catalogue des commandes | `npm --prefix bot run audit:commands` | valide, toutes les applications sous la limite Discord |
| Réponses aux interactions | `npm --prefix bot run audit:replies` | valide, 0 réponse dangereuse |
| Tests du site | `npx vitest run` | 273 réussis |
| Typage du site | `npx tsc --noEmit` | 0 erreur |
| Lint | `npx eslint .` | 9 erreurs avant, **0 après** (6 avertissements de style) |
| Archive publique du bot | `python3 scripts/package-bot.py` + inspection | 466 fichiers ; aucun `.env`, aucune base de données, aucun dossier `data/`, aucune dépendance |

Revue manuelle ciblée sur les zones à risque :
- **Attribution de rôles** : tous les chemins qui donnent un rôle (hors restaurations) passent bien par `role-grant-guard.js` (règle du 25/11). Le rankall revérifie le rôle à chaque membre.
- **Routage** : préfixes par bot, gel du staff, hiérarchie centrale avant chaque interaction.
- **Routes publiques du site** : secret du bot vérifié, schémas stricts, codes d'événements fixes. Les 196 codes envoyés par les bots sont tous connus du site, donc aucun rapport de statut n'est rejeté.
- **Cloisonnement par serveur** : une seule requête SQL lit par membre sans serveur (le modmail), et c'est voulu (une conversation à la fois par membre).
- **Tâches de fond** : chaque minuterie de `bot/index.js` a été relue.

## 3. Défauts corrigés

| # | Gravité | Défaut | Correctif |
|---|---|---|---|
| 1 | Haute | Les aperçus d'automatisation tournent à **chaque message**, arrivée et mouvement vocal, sans filet. Une erreur SQLite (base verrouillée, disque plein) devenait un rejet non géré. Au bout de 10 en 10 minutes, `process-guard` arrête le bot : il redémarre en boucle tant que la panne dure. | `bot/automation-rules-runtime.js` : les deux fonctions d'aperçu ne rejettent plus jamais ; l'erreur est notée `automation_preview_error`. Test ajouté. |
| 2 | Haute | La minuterie d'expiration de PND Intelligence faisait un appel SQLite sans `try`. Une exception dans une minuterie n'est pas rattrapée et arrête le processus. | `bot/index.js` : appel protégé. |
| 3 | Moyenne | LE FISC : l'impôt sur la fortune et le recouvrement des prêts étaient dans le même `try`. Si l'impôt échouait, les prêts en retard n'étaient jamais recouvrés. | `bot/index.js` : les deux tâches sont indépendantes. |
| 4 | Moyenne | Alertes LIVE : une erreur hors de la boucle des flux n'était pas rattrapée et produisait un rejet non géré. | `bot/index.js` : `.catch` ajouté aux appels. |
| 5 | Moyenne | Modmail : `/modmail bloquer` n'empêchait que les **nouvelles** conversations. Un membre bloqué en pleine conversation continuait d'écrire au staff. | `bot/features/modmail.js` : la conversation est close et le membre prévenu à son MP suivant. Test ajouté. |
| 6 | Basse | Modmail : la table anti-rafale gardait chaque expéditeur pour toujours, donc la mémoire grossissait sans limite. | Ménage des expéditeurs inactifs. Test ajouté. |
| — | Outillage | ESLint en échec : `useSession` de TanStack côté serveur était pris pour un hook React, plus deux blocs `catch {}` vides. | `eslint.config.js` et commentaires. 0 erreur. |

Commits : `f2e9208`, `e93e888` (puis FWU V2 : `c762a09` et suivants). Chaque nouveau test a d'abord été lancé sur l'ancien code (il échoue), puis sur le nouveau (il passe).

## 4. Suite des constats (mise à jour FWU V2, même jour)

| Constat | État |
|---|---|
| ~~Les 26 tests de quotas partagés ne tournent pas.~~ | **Erreur de l'audit** : la CI lance déjà un service PostgreSQL 16 (`SHARED_DATABASE_URL_TEST`). Ces tests ne sont ignorés qu'en local, sans base. |
| ~~ESLint absent de la CI.~~ | **Erreur de l'audit** : la CI lintait les fichiers modifiés. Elle lint maintenant **tout le dépôt** (`npx eslint .`), propre depuis ce jour. |
| Journal central : la commande apparaissait sous sa forme interne (`=ban`). | ✅ Corrigé : le journal montre le texte tapé (`+ban`). |
| Faux log « rôles ajoutés » pour un membre hors cache. | ✅ Vérifié, pas de défaut : sans partial `GuildMember`, discord.js n'émet pas `guildMemberUpdate` pour un membre hors cache. |
| Les routes `/api/public/*` lisaient tout le corps avant de vérifier sa taille. Les interactions Discord ne sont authentifiées qu'**après** cette lecture. | ✅ Corrigé : `src/lib/http-body.ts` refuse un `Content-Length` trop grand et coupe un corps envoyé par morceaux dès la limite (5 routes, 4 tests). |
| « FWU » visible dans Discord. | ✅ FWU V2 : plus aucun « FWU » dans Discord, verrouillé par `bot/discord-branding.test.js`. |
| 38 vérifications manuelles de `RECETTE_STAGING.md`. | ⏳ **À faire par toi** sur un bot et un serveur de test. Impossible depuis cet environnement. |
| `bot/index.js` (1 741 lignes, environ 50 handlers enchaînés dans un ordre fragile). | ⏳ Non fait volontairement : refonte du routage à faire **après** la recette, pour que la recette puisse servir de référence. |
| LE FISC : le capital d'un prêt va au Trésor seulement en cas de recouvrement forcé. | ✅ Décidé le 26/11 (décision 28) : le capital est toujours détruit, la caisse ne reçoit que les intérêts et la pénalité. |

## 5. Idées pour la prochaine version (recensées dans le dépôt)

Sources : `docs/architecture/FWU_MASTER_EVOLUTION_2026-11.md`, `docs/FWU_SERVER_EXPERIENCE_PLAN.md`, `docs/PND_V5_reference/PND_V5_FEATURES.md`, `DECISIONS.md`, `docs/architecture/FWU_COMMAND_CONSOLIDATION_PLAN.md`, `docs/archives/PND_ASSIST_PLUS_MASTER_PLAN.md`. Légende : ✅ fait, 🟡 commencé, ⬜ à faire, ❓ idée sans spécification.

### Transversal (les 6 applications)
- 🟡 Consolidation des commandes : `/music player` et `/voice` sont faits ; continuer les regroupements (129 commandes racines aujourd'hui) avec une matrice de parité.
- ⬜ FWU CENTRAL / API : échanges authentifiés entre bots, signatures anti-rejeu, aucun token qui circule.
- ⬜ FWU MEMORY : mémoire des événements et décisions, avec une durée de conservation réglable.
- ⬜ FWU ID / PASSPORT : fiche membre (réputation, ancienneté, progression), données minimales.
- 🟡 FWU BACKUP & RESTORE : sauvegardes versionnées (Time Machine existe), restauration sélective toujours confirmée.
- ⬜ FWU INCIDENT CENTER : incidents, gravité, responsable, chronologie, résolution.
- 🟡 FWU LIVE STATUS : disponibilité, latence, erreurs, état des bases (statut et santé existent).
- ⬜ FWU LAB : tester règles et configurations en simulation, sans effet sur Discord.
- 🟡 FWU KNOWLEDGE : FAQ et procédures (`=knowledge` existe).
- 🟡 Logs centralisés : classement complet par catégorie, déduplication, file persistante, compteurs de pertes.
- 🟡 Pack emoji FWU : 16 PNG préparés, à compléter (statut, sécurité, staff, tickets, vocal, économie, premium…).
- ⬜ `/setup` interactif complet (boutons, menus, fenêtres) comme surface d'administration principale (Discord First).

### FWU (administration, accueil, tickets)
- ✅ Messages d'arrivée et de départ configurables.
- 🟡 Tickets natifs : SLA, priorités, escalade, réouverture, transcription contrôlée.
- ⬜ Dossiers membres, activité du staff, rapports et suggestions.
- ⬜ Planning du staff : présences, missions, absences, escalades.
- ⬜ Indicateurs de santé de la communauté.
- ⬜ Academy : parcours d'accueil et de formation (étapes, quiz, rôle en récompense, sous réserve de la hiérarchie).

### GUARD (sécurité)
- 🟡 Détection graduée : raids, impersonation, changements de permissions (Guardian, score indicatif).
- ⬜ Reconstitution d'incident et recommandations après attaque.
- ⬜ Procédures d'urgence guidées (le gel d'urgence existe).
- Règle à garder : une détection probabiliste produit une alerte, jamais une sanction irréversible.

### FDPDLAVOC (vocal, musique)
- ⬜ Statistiques vocales enrichies, files et réservations, notifications.
- ⬜ Outils de modération vocale supplémentaires.
- ⬜ Recette d'une lecture réellement audible (musique et radio) sur un serveur de test.
- Règle à garder : ne pas toucher au Join-to-Create en service.

### SUCK ME (staff, SYS+)
- 🟡 Welcome Journey et rôles automatiques conditionnels.
- ⬜ Workflows, missions staff, absences, rappels.
- ✅ À préserver : SYS+, ADMIN+, WHITELIST, DOG, MENOTTE, WAKEUP, LOCKNAME, Anti-Move.

### LE FISC (économie, jeux)
- 🟡 Missions, métiers, entreprises, enchères (en place) ; ⬜ collections, succès, saisons, classements saisonniers.
- ⬜ Régulation économique (inflation, Trésor) ; à trancher avec la question du capital des prêts (§4).
- ⬜ Événements avec inscriptions et récompenses ; tirages vérifiables (graine et participants journalisés).
- ⬜ Sessions de jeu persistantes, mises via le journal comptable, anti-abus.

### Invest + (facultatif)
- 🟡 Abonnements et droits temporaires (en place) ; ⬜ fidélité, parrainage, créateurs, analyses.

### Idées jamais spécifiées (décision n°15 de `DECISIONS.md`)
- ❓ **Relations entre membres** (amis, couples, rivalités ?).
- ❓ **Studio de profil personnel** (profil personnalisable, badges).
- ❓ **Nouvelles fonctions IA.**

Pour ces trois idées, il faut ta liste précise des fonctionnalités voulues avant de développer quoi que ce soit.

## 6. Cadrage de FWU V2 et des versions suivantes

Une évolution, pas une réécriture : c'est la règle du dépôt, et la base actuelle est saine.

1. **Base verte de référence** : recette staging P1, ESLint et PostgreSQL dans la CI.
2. **Routeur déclaratif** : chaque module déclare ses commandes, préfixes de `customId` et préfixes de messages ; `index.js` ne fait plus que charger les modules. C'est la condition pour ajouter des fonctions sans fragiliser l'ordre des handlers.
3. **Versions numérotées** des 6 applications (le projet « Éclaireur » de `/maj`), avec un changelog lisible depuis Discord.
4. **Socle transversal** : CENTRAL/API, INCIDENT CENTER, LAB, puis MEMORY et PASSPORT.
5. **Modules spécialisés**, dans l'ordre du plan d'évolution : GUARD, vocal, SUCK ME, économie, Invest +.
6. **Idées ❓** une fois spécifiées.

Décidé le 26/11 : la version s'appelle **FWU V2** (`v2.0.0`), sans « FWU » dans Discord. Décidé ensuite le 26/11 : le bloc 4 passe avant le bloc 5 (décision 29) et le capital des prêts est toujours détruit (décision 28). Reste à fournir : la spécification des trois idées ❓.

# Audit du projet PND Assist + (Her? V5)

Audit statique en lecture seule réalisé le 14 novembre 2026. Aucun fichier de code n’a été modifié, aucune dépendance installée, aucune migration lancée et aucun déploiement effectué. Les valeurs de secrets n’ont pas été consultées ni divulguées.

## Résumé exécutif

Le projet contient un dashboard web et un bot Discord autonome doté d’un catalogue important de commandes et de modules. Le code couvre l’économie PND, la modération, SYS+/ADMIN+, DOG, MENOTTE, salons vocaux temporaires, musique, radio, IA, webhooks, automatisations et logs centralisés. La présence de ces implémentations ne prouve pas leur fonctionnement en production.

Problèmes les plus graves :

- **État Git non vérifiable** : `.git/` existe mais est vide. Les commandes Git ont échoué avec `fatal: not a git repository`.
- **Isolation PND/MZ incomplète** : le serveur principal est actif dans l’allowlist du code ; le second serveur est réservé et inactif (`bot/logs-hub.js:2-5`, `bot/index.js:44-47`).
- **Permissions du hub de logs à vérifier** : les overwrites sont définis à la création ; une catégorie existante réutilisée peut ne pas avoir les mêmes permissions (`bot/logs-hub.js:63-78`).
- **Musique/radio non validées en exécution** : extraction YouTube, flux, Opus, connexion Discord, reprise et autostart demandent une recette. Le code récupère les vidéos d’une playlist avant de limiter le nombre retenu (`bot/music/music.js:97-105`).
- **Validation globale incomplète** : Node et npm étaient absents du PATH lors de l’audit. Aucun test n’a été exécuté pendant cette passe.
- **Identité produit incohérente** : de nombreuses références textuelles et visuelles affichent encore Her? au lieu de PND Assist +.

Fonctionnalités présentes dans le code : commandes slash et préfixées, modération, permissions, économie PND, DOG, MENOTTE, systèmes vocaux, social, cartes, jeux, tickets, automatisations, IA, webhooks, alertes LIVE et musique/radio. Elles restent à recetter en conditions réelles.

Priorités recommandées : recette audio instrumentée ; vérification et durcissement des permissions du hub de logs ; configuration isolée et testée pour PND/MZ ; recette des systèmes privilégiés ; harmonisation de l’identité et de la documentation.

## A. État général du projet

Le projet comprend deux processus principaux :

- **Dashboard** : `src/`, avec React, TypeScript, TanStack Start/Router, Vite/Nitro et Supabase. Routes dans `src/routes/`, fonctions partagées dans `src/lib/`, composants dans `src/components/`.
- **Bot Discord permanent** : `bot/`, processus Node indépendant utilisant `discord.js`, `@discordjs/voice` et `play-dl`. Son démarrage est dans `bot/index.js`.
- **Données** : SQLite locale pour l’économie et plusieurs modules ; Supabase et Drizzle pour les données partagées avec le dashboard. Migrations dans `supabase/migrations/` et `drizzle/migrations/`.
- **Déploiement** : configurations PM2, exemple Nginx et documentation Oracle dans `ecosystem*.config.cjs` et `deploy/oracle/`. Aucun accès ou changement Oracle n’a été effectué.

### État Git et environnement

Le dossier `.git/` est présent mais vide. `git status`, `git rev-parse --show-toplevel` et `git log` ont échoué avec `fatal: not a git repository (or any of the parent directories): .git`. L’historique et l’état des changements ne sont pas consultables. Aucune initialisation Git n’a été tentée.

Aucun fichier `.env` réel n’a été trouvé ; seuls `.env.example` et `bot/.env.example` existent. Aucun contenu de secret n’a été lu. `ffmpeg` et `ffprobe` sont présents dans l’environnement d’audit, sans preuve qu’ils le soient sur l’hôte. Les commandes `node` et `npm` étaient introuvables dans le PATH.

## B. Fonctionnalités réellement opérationnelles, à vérifier ou manquantes

**Présentes dans le code, sans validation de production** : dashboard et synchronisation bot-dashboard ; commandes slash et préfixées ; modération ; GuildGuard ; SYS+/ADMIN+ ; DOG ; MENOTTE et commandes vocales ; salons temporaires ; économie PND ; jeux, social, cartes ; tickets ; automatisations ; webhooks ; IA ; alertes LIVE ; journaux centralisés et rapports d’état.

Le registre slash est défini dans `src/lib/slash-commands.ts:56`, et le dispatch se trouve dans `bot/index.js:698-733`. Les catégories couvrent Général, Sécurité, Modération, SYS+, Automatisation, Économie PND, Social/cartes, Jeux/événements, Vocal/DOG et Musique/radio. Exemples : `/aide`, `/status`, `/guildguard`, `/warn`, `/ban`, `/rank`, `/sysp`, `/ticket`, `/webhook`, `/automation`, `/balance`, `/daily`, `/pay`, `/pnd`, `/profil`, `/cards`, `/giveaway`, `/event`, `/dog`, `/undog`, `/access`, `/pv`, `/voc`, `/play`, `/radio`. Les préfixes `=` restent également disponibles.

**À vérifier sur Discord** : enregistrement effectif des commandes ; synchronisation des paramètres ; permissions et hiérarchies des rôles ; boutons, menus, panneaux et modales ; accès du hub de logs ; restauration après redémarrage ; musique/radio ; isolation des guilds sources.

**Manquantes ou non démontrées** : activation et configuration isolée de MZ ; recette complète sous Node 24 ; cahier des charges produit unique. `HER-V5-VALIDATION-BLOCKERS.md:10-19` énumère des vérifications encore attendues, dont tests/build, enregistrement des commandes et recette des permissions/modules.

### Permissions privilégiées

`bot/systems/sysplus/permissions.js:8-30` définit SYS+ comme propriétaire du serveur, administrateur Discord ou détenteur du rôle SYS+ configuré. ADMIN+ est distinct et limité. La configuration SYS+/ADMIN+ est réservée au propriétaire ou à l’administrateur Discord. `bot/role-commands.js` contrôle aussi les hiérarchies pour la gestion des rôles. Ces règles restent à tester avec les rôles et overwrites réels.

### DOG, MENOTTE, vocal et salons temporaires

- **DOG** : état persistant dans `bot/data/dog-state.json`, rôle marqueur et réapplication du surnom/rôle ; exige `ManageRoles` et une hiérarchie correcte (`bot/dog-commands.js:18-45, 99-125`).
- **MENOTTE** : enregistrement SQLite par serveur/membre, déplacement et réconciliation au démarrage (`bot/voice-commands.js:235-268, 276-315`). Le bot nécessite `MoveMembers` dans les salons source et destination, ainsi que `Connect` à destination.
- **Panneaux vocaux/PV** : snapshots des overwrites restaurables (`bot/voice-commands.js:82-103`) ; accès revérifié lors des interactions (`381-408`). Tester les overwrites combinant rôles et membres.
- **Salons temporaires** : `bot/voice-v2.js` et `bot/voice-v2-policy.js` gèrent le hub de création et le nettoyage ; état conservé dans SQLite.
- Ces fonctionnalités reposent sur des données locales ; une perte/restauration incohérente peut affecter leur état.

### Économie PND, SQLite et migrations

`bot/database.js` initialise les tables wallets, ledger, boutique, jeux, tickets, audit SYS+, MENOTTE, salons temporaires, webhooks et automatisations, entre autres. Les données pertinentes sont indexées par `guild_id`. Des migrations additives au chargement ajoutent notamment la banque PND, des colonnes aux événements et `managed_webhooks.animation_enabled` (`bot/database.js:184-199`).

`bot/economy.js` traite SQLite comme source de vérité ; le dashboard reçoit des instantanés. `bot/data/economy.sqlite` est présent, mais son contenu n’a pas été ouvert. `bot/scripts/export-economy.js` est documenté comme export en lecture seule.

Les migrations Supabase et Drizzle sont dans `supabase/migrations/` et `drizzle/migrations/`. Aucune migration n’a été exécutée. Tout démarrage du bot sur une base de production doit être précédé d’une sauvegarde et d’une procédure de restauration validées.

## C. Bugs et risques

| Gravité | Fichier(s) / lignes | Constat et recommandation |
|---|---|---|
| Bloquante pour la traçabilité | `.git/` (vide) | Git ne reconnaît pas le projet. Confirmer si le checkout est incomplet et retrouver la source attendue ; ne pas initialiser sans validation. |
| Élevée | `bot/logs-hub.js:2-5`, `bot/index.js:44-47` | Le serveur secondaire est réservé mais exclu de l’allowlist. Définir une configuration par guild et tester l’isolation avant activation. |
| Élevée | `bot/logs-hub.js:63-78` | Les permissions des catégories sont définies à leur création. Les ressources préexistantes réutilisées n’ont pas leurs overwrites vérifiés/corrigés. Auditer leurs accès avant les envois. |
| Élevée | `bot/index.js:105-113`, `bot/logs.js`, `PND_ASSIST_LOGS_HUB.md:27-33` | Migration vers le hub incomplète ; anciens canaux conservés en compatibilité, risque de doublons. Terminer le routage par source et le tester module par module. |
| Élevée | `bot/music/music.js:97-105` | Les playlists sont récupérées avant le plafonnement par `slice`. Ajouter une vraie limite de récupération ou une pagination. |
| Moyenne | `bot/database.js:184-199` | Migrations SQLite additives exécutées au chargement. Sauvegarder et valider la restauration avant toute mise à jour de l’instance réelle. |
| Moyenne | `HER-V5-VALIDATION-BLOCKERS.md:10-19`, `HER-V5-IMPLEMENTATION-STATUS.md:59-64` | Tests complets, build et recette Discord restent à effectuer selon les documents. Les résultats mentionnés ailleurs sont historiques, pas réexécutés pendant cet audit. |
| Moyenne | `bot/live-alerts.js`, `bot/automation.js`, `src/lib/bot-ai.server.ts` | Dépendances réseau et permissions à recetter. Les alertes LIVE dépendent de flux RSS/Atom signalant explicitement les directs ; pas de détection native universelle. |
| Moyenne | Documentation et assets Her? | Identité ancienne persistante et documentation de plusieurs générations. Inventorier et décider la compatibilité avant renommage. |

Les consignes de sécurité d’`AGENTS.md` incluent les contrôles `requireOwner()`, les frontières `.server.ts`, la vérification Ed25519 des interactions Discord, les rapports bot bornés et l’absence de secrets dans les téléchargements. L’audit n’a pas exécuté d’analyse dynamique de ces protections.

## D. Diagnostic détaillé du système musical

**Emplacements** : logique `bot/music/music.js`, politique `bot/music/music-policy.js`, définitions slash `src/lib/slash-commands.ts:847-907`, adaptation slash `bot/v4-commands.js:205-255`, dispatch `bot/index.js:729-732`.

**Fonctionnement observé** :

- Recherche YouTube et résolution d’URL vidéo/playlist avec `play-dl` (`bot/music/music.js:81-116`).
- Flux remis à `@discordjs/voice`, ressource audio et volume inline (`207-217`).
- Connexion vocale, contrôles `Connect`/`Speak` et reprise de connexion (`148-197`).
- File plafonnée, cooldown, commandes de lecture et panneau à boutons (`15-32, 119-145, 387-420`).
- Radio stockée par guild dans `bot/data/radio-config.json`, redémarrage au lancement, boucle playlist et tentatives de reconnexion (`54-71, 220-301`, autostart dans `bot/index.js:528-530`).
- Aucun support Spotify/SoundCloud n’a été repéré.

**Dépendances audio** : `bot/package.json` déclare `discord.js`, `@discordjs/voice` et `play-dl`. Le code n’invoque pas FFmpeg explicitement. FFmpeg/ffprobe sont présents dans l’environnement d’audit, pas nécessairement sur l’hôte. Le manifeste ne déclare explicitement ni `@discordjs/opus` ni `opusscript` ; la présence d’un encodeur Opus utilisable sur le serveur n’a pas été vérifiée. Node/npm étant absents du PATH, les paquets effectivement résolus et leurs versions n’ont pas été vérifiés.

**Causes possibles à vérifier** : changement de l’extraction YouTube ; blocage réseau, géographique ou de consentement ; vidéo indisponible ; échec de flux ; encodeur Opus absent/incompatible ; permissions vocales insuffisantes ; instabilité de connexion. Les messages génériques ne distinguent pas ces causes. Ajouter des diagnostics structurés sans exposer secrets ni contenu sensible.

**Risques précis** :

1. `resolveInput()` appelle `playlist.all_videos()` avant `slice(0, playlistLimit)` (`97-105`) : les grandes playlists peuvent provoquer récupération lente ou échec avant plafonnement.
2. `src/test/music-policy.test.ts` vérifie seulement l’obligation d’être dans le même vocal. Aucun test repéré ne couvre extraction YouTube, flux, Opus, player, reconnexion, autostart ou boucle radio.
3. La détection utilisateur accepte Stage (`bot/music/music.js:199-204`), mais `connectChannel()` refuse les types autres que `GuildVoice` (`148-155`). Confirmer que c’est voulu.
4. La radio active bloque la musique standard (`bot/music/music.js:402`). Confirmer cette politique.
5. Les logs audio ne permettent pas encore d’isoler clairement source, flux, encodage et connexion.

**Conclusion** : musique et radio sont implémentées, mais leur fonctionnement réel n’est pas confirmé. Priorité : recette contrôlée avec journaux des étapes résolution, flux, connexion et player, puis tests d’intégration lecture/erreurs/reconnexion/radio après redémarrage.

## E. Architecture recommandée

1. Faire de Discord l’interface opérationnelle principale et du dashboard l’interface de configuration.
2. Déclarer une configuration isolée par serveur (PND, MZ, hub de logs) : modules, rôles, canaux, économie, vocal et permissions.
3. Router chaque log selon la guild source ; vérifier les overwrites du hub au démarrage et ignorer les commandes ordinaires dans ce serveur.
4. Conserver l’isolation par `guild_id`. Si plusieurs processus/hôtes doivent écrire simultanément, adopter un stockage partagé transactionnel avant leur lancement.
5. Séparer résolution audio, récupération du flux, encodage, player, file, radio, reprise et observabilité en composants testables.
6. Respecter les protections d’`AGENTS.md`, notamment fichiers `.server.ts`, fonctions protégées, interactions Discord signées et secrets non exposés.

## F. Plan de développement priorisé

1. **Recette musique/radio** : vérifier runtime et dépendances en test ; essayer vidéo, recherche, playlist, interruption, erreur source, reconnexion et autostart. Conserver des diagnostics expurgés.
2. **Stabiliser l’audio** : limiter réellement la récupération de playlists ; clarifier Stage et coexistence musique/radio ; couvrir les transitions player et reprises.
3. **Sécuriser le hub** : auditer catégories/salons existants, vérifier overwrites, terminer la migration et contrôler les doublons.
4. **Préparer PND/MZ** : valider mapping, rôles et paramètres par guild ; tester l’absence de croisement des données, logs et réglages avant activation.
5. **Recetter les permissions** : SYS+, ADMIN+, rôles, DOG, MENOTTE, panneaux et salons temporaires en serveur de test.
6. **Harmoniser la marque** : inventorier textes, visuels, noms d’assets, documentation et URLs ; convertir vers PND Assist + selon une compatibilité validée.
7. **Validation globale** : tests, lint, vérification des types, build et recette humaine dans un environnement Node conforme, avant déploiement.

## G. Actions nécessitant une validation humaine

- Clarifier l’origine du `.git` vide et fournir le checkout/historique attendu ; ne pas initialiser Git sans validation.
- Confirmer identifiants, rôles, canaux, paramètres et politique d’activation de MZ.
- Valider accès et audience du hub de logs, y compris overwrites existants.
- Confirmer sources audio, support Stage et priorité entre radio et musique.
- Fournir un serveur Discord de recette et consulter les journaux audio expurgés. Ne pas partager les secrets.
- Consolider le cahier des charges et approuver le périmètre de renommage PND Assist +.
- Autoriser séparément toute migration, activation de serveur, modification de données ou déploiement.

## Vérifications réalisées pendant l’audit

- Lecture intégrale de `AGENTS.md` et inventaire statique des dossiers, manifestes, modules, migrations, documentation et tests.
- Vérification de `.git/` et commandes Git en lecture seule : échec, répertoire vide.
- Recherche de fichiers `.env` réels sans lire de valeurs : seuls les exemples ont été trouvés.
- `ffmpeg` et `ffprobe` présents dans l’environnement d’audit.
- Node et npm introuvables dans le PATH.
- **Aucun test exécuté** ; aucune dépendance installée, migration lancée, déploiement, modification ou suppression de fichier.

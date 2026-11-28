# FWU V2 — plan directeur de l'écosystème (11 bots)

Document de référence unique du chantier FWU V2 : il ne remplace pas `docs/FEUILLE_DE_ROUTE.md`
(fiabilité au quotidien), `docs/V2_PROGRESS.md` (journal des tâches V2) ni `DECISIONS.md`
(décisions de l'OWNER) ; il les relie et fixe la cible à 11 bots.

- Cahiers des charges de l'OWNER, conservés tels quels : `docs/specs/CAHIER_DES_CHARGES_FWU_V2.md`
  (plan global, 11 bots) et `docs/specs/EXTENSION_ULTIMATE.md` (extension « autonomie intelligente »,
  à intégrer une fois les phases en cours terminées : d'abord un plan d'intégration, sans code).
- Audit réalisé le 28/11/2026, sur `main` au commit `63b3e64`, en lecture seule (aucun
  déploiement, aucun processus PM2 créé, aucune configuration Discord touchée).
- Seule modification de code faite pendant l'audit, à la demande de l'OWNER : la garde de
  budget de connexions Discord (§ 9.1), sur la branche `claude/fwu-v2-audit-session-budget`,
  non fusionnée dans `main`.

---

## 1. État réel du projet (résumé)

| Point | Constat |
|---|---|
| Taille | 1009 fichiers suivis : `bot/` 595, `src/` 187, `docs/` 112. |
| Bots en code | 6 profils dans `src/lib/bot-profiles.ts` : `fwu`, `guard`, `fdpdlavoc`, `suckme`, `fisc`, `investplus`. **Un seul code** (`bot/index.js`), le profil est choisi par `PND_BOT_PROFILE`. |
| Commandes slash | 184 définitions uniques, 0 doublon, 0 commande sans propriétaire (`npm --prefix bot run audit:commands`). |
| Tests | `bash scripts/verify-all.sh` : **les 7 contrôles passent** (détail § 10). |
| Production | Bot principal dans `/home/opc/her-v5-production` (PM2 `her-v5-bot`, site `her-v5-web`) ; bots spécialisés dans `/home/opc/fwu-bots/fwu-<profil>` (PM2 `fwu-<profil>`). Les deux chemins sont réels : le cahier des charges ne citait que le premier. |
| Incidents récents | 26/11 : GUARD et LE FISC ont épuisé leurs connexions Discord du jour (boucles de redémarrage). 27/11 : mise à jour échouée pour ces deux bots → retour arrière → redémarrages supplémentaires ; ~30 redémarrages pour GUARD, LE FISC et SUCK ME. Corrigé dans le code (§ 9.1), à déployer. |
| Bloquant connu | Application Discord « fwu » du site en quarantaine anti-spam (connexion OAuth de la console), contestation en cours (`docs/FEUILLE_DE_ROUTE.md`). |

## 2. Architecture actuelle

```
                         Render : site TanStack Start (her-v3-dashboard.onrender.com)
                           ├─ /console/ (OWNER, OAuth Discord + cookie)
                           ├─ /api/public/bot-sync      ← réglages + IA (secret BOT_SYNC_SECRET)
                           ├─ /api/public/bot-status    ← instantanés de santé (codes fixes)
                           ├─ /api/public/discord-interactions (signature Ed25519)
                           └─ Supabase (13 migrations, service_role côté serveur seulement)
                                         ▲ HTTPS
VPS Oracle (opc, PM2) ───────────────────┘
  her-v5-bot (fwu) ─┐
  fwu-guard        ─┤  même code bot/index.js, PND_BOT_PROFILE + token propre
  fwu-fdpdlavoc    ─┤
  fwu-suckme       ─┼─ SQLite partagé (PND_DATA_DIR, ex. /home/opc/fwu-data) :
  fwu-fisc         ─┤    économie, baux de domaine, fwu_events (bus), outbox des journaux,
  fwu-investplus   ─┘    bot_gateway_failures, bot_gateway_starts (nouveau)
                       PostgreSQL local (SHARED_DATABASE_URL) : quotas, paliers, sanctions,
                         exemptions, gel du staff, journaux de configuration (bot/shared/)
```

Mécanismes communs déjà en place (réutilisables pour FWU CORE) :

- **Baux de domaine** (`bot/bot-runtime.js`, `createDomainGate`) : chaque bot spécialisé tient
  un bail sur son domaine tant qu'il est connecté ; sinon le bot principal reprend ce domaine en
  moins d'une minute. GUARD et SUCK ME se secourent mutuellement si le principal tombe aussi.
  → Le bot principal n'est déjà pas un point de panne unique pour la sécurité.
- **Bus d'événements persistant** (`bot/event-bus.js`, table `fwu_events` + curseurs par
  consommateur) : un bot arrêté rattrape les événements à son retour.
- **Outbox des journaux** avec reprises exponentielles (`bot_log_outbox`).
- **Garde de connexion** (`bot/gateway-watchdog.js`) : arrêt définitif (code 78) après
  6 échecs, attente de la réinitialisation Discord en cas de limite de sessions.
- **Mise à jour depuis Discord** (`/maj lancer`, `scripts/installation/fwu-auto-update.sh`) avec
  sauvegarde et retour arrière par bot (`fwu-maj-un-bot.sh`).

## 3. Les 11 bots

### 3.1 Bots existants (ne rien casser)

| Profil | Nom Discord | PM2 | Commandes slash (limite 100) | Préfixe | Rôle aujourd'hui |
|---|---|---|---|---|---|
| fwu | Bot principal | her-v5-bot | 21 | — | IA, modération à quota (warn, tempmute…), sanctions, accueil/screening, secours de tous les domaines |
| guard | GUARD | fwu-guard | 25 | `+` | ban/kick/blacklist/purge, anti-raid, anti-nuke, automod, quarantaine, casier |
| fdpdlavoc | FDPDLAVOC | fwu-fdpdlavoc | 24 | `;` | musique, radio, vocaux temporaires, accès vocaux, déplacements |
| suckme | SUCK ME | fwu-suckme | **84** (dont `/authority`, provisoire) | `=` | SYS+, rôles, DOG, MENOTTE, tickets, staff, giveaways, IA, social, logs, `/maj` |
| fisc | LE FISC | fwu-fisc | 37 | `-` | économie PND, casino, jeux, cartes, business, braquages |
| investplus | Invest + | fwu-investplus | 4 | `$` | abonnements membres (facultatif) |

`aide` et `status` sont partagés par les 6 applications.

**Alerte limite slash** : SUCK ME est à 83/100. STAFF CENTER (phase 1) doit passer par des
**sous-commandes de racines existantes** (`/staff`, `/dossier`, `/rapportstaff`) et non par de
nouvelles racines. Toute nouvelle racine sur SUCK ME doit être justifiée et comptée.

### 3.2 Nouveaux bots (aucun processus créé tant que l'architecture n'est pas validée)

| Profil | Nom | Mission | Reprend de l'existant |
|---|---|---|---|
| social | SOCIAL | Vie communautaire | `/profil`, `/bio`, `/rep`, `/toprep`, `/award`, `/membredumois`, `/anciennete`, `/clan`, `/famille`, `/confession` (aujourd'hui SUCK ME et `bot/features/`) |
| event | EVENT | Événements | `/event`, `/pndevent`, `/giveaway`, `/decompte`, `/saison` |
| dispatch | DISPATCH | Notifications | `/annonce`, `/rappel`, `/live`, alertes de `bot/live-alerts.js` |
| arcade | ARCADE | Jeux | `/blindtest` (FDPDLAVOC), `/trivia`, `/duel`, `/defi`, `/quete`, `bot/games.js` |
| authority | AUTHORITY | Dérogations | rien de dédié ; voir § 5 pour les systèmes d'exception éparpillés à fédérer |

Déplacer une commande d'un bot à l'autre change l'application qui la porte : il faut garder
l'équivalent préfixé, prévenir les membres et prévoir la période où l'ancienne commande
redirige vers la nouvelle (le mécanisme `RETIRED_SLASH_COMMANDS` / `slashCommandNamesOwnedElsewhere`
de `bot/bot-runtime.js` le permet déjà).

Ajouter un profil demande : une entrée dans `src/lib/bot-profiles.ts`, une ligne dans `BOTS` de
`scripts/package-fwu-bots.py`, la boucle de `fwu-auto-update.sh`, une application Discord (token
fourni par l'OWNER lui-même, jamais par le chat) et les tests de profil.

### 3.3 Services internes (pas de bot Discord)

- **FWU CORE** : infrastructure commune (§ 4).
- **INSIGHT** : analyses ; part de `bot/activity-snapshot.js`, `analytics-buffer.js`,
  `shared/staff-stats.js` et de la page Analyse de la console.

## 4. FWU CORE — ce qui existe et ce qui manque

| Brique demandée | Existe | À faire |
|---|---|---|
| Bus d'événements, file persistante | `event-bus.js` (uid, idempotence, version) + `core-queue.js` (tâches, bail, reprises) | — (fait en 2.1 / 2.2) |
| Reprise après panne | outbox des journaux, curseurs | file générique « à traiter quand le destinataire revient » avec reprises bornées |
| Identité universelle | IDs Discord partout | table d'identité par serveur (membre ↔ profils, historique) |
| Permissions | `role-grant-guard.js`, `shared/tiers.js`, `hierarchy-guard.js`, `pnd-owner-policy.js` | service unique de décision (API) consommé par tous les bots |
| Journal d'audit | `shared/audit.js`, `systems/sysplus/audit.js`, `config_changes` | journal unifié, en ajout seul, consultable depuis la console |
| API économique | `economy.js`, `economy-integrity.js`, `economy-antifraud.js` | registre transactionnel central idempotent, seul autorisé à créer des PND (§ 7) |
| Santé | `health-report.js`, `bot-status`, baux, `gateway-watchdog.js`, `session-budget.js` | page Santé de la console, alertes staff (feuille de route A.2) |
| Authentification interservices | secret `BOT_SYNC_SECRET` (site ↔ bots) ; entre bots : fichier SQLite commun | signature des événements sensibles (AUTHORITY) pour qu'une ligne écrite à la main dans la base ne vaille pas approbation |
| Isolation des serveurs | `guild_id` partout, MZ désactivé | tests d'isolation systématiques pour chaque nouvelle table |

Principe : **pas de nouveau serveur réseau entre les bots** tant que le SQLite partagé suffit
(un seul VPS). L'« API centrale » est d'abord une bibliothèque commune dans `bot/` + des tables
partagées ; on passera à un service HTTP seulement si les bots quittent le même VPS.

## 5. AUTHORITY — cadrage technique

### 5.1 Systèmes d'exception déjà existants (à fédérer, pas à dupliquer)

| Système | Fichier | Qui accorde aujourd'hui |
|---|---|---|
| Exemptions de quota | `bot/shared/quotas.js` (`quota_exemptions`), `/quota exemption` | OWNER |
| Whitelist de bots | `bot/shared/db.js` (`bot_whitelist`) | OWNER |
| Packs premium (droits temporaires) | `bot/entitlements.js`, `bot/systems/entitlements/` | OWNER, expiration calculée à la lecture |
| WHITELIST SYS+ | `/sysp whitelist` | OWNER |
| Accès vocaux | `voice-access-requests.js`, `voice-access-store.js` | selon `voiceAccess` |
| Double validation, gel du staff | `/sysp urgence`, `shared/freeze.js` | OWNER / SYS+ |
| Coupure de commande | `/stabilite` | OWNER / admins |

`entitlements.js` applique déjà presque toutes les règles d'AUTHORITY (OWNER seul, par serveur,
expiration à la lecture donc fiable après redémarrage, révocation enregistrée jamais effacée,
audit). **C'est le modèle à généraliser** plutôt qu'un système neuf.

### 5.2 Architecture cible

- Table `authority_requests` (SQLite partagé) : id unique, `guild_id`, demandeur, bénéficiaire,
  permission (liste fermée de types), service, justification obligatoire, durée, statut
  (`pending`, `approved`, `refused`, `active`, `suspended`, `expired`, `revoked`), horodatages.
- Table `authority_events` en ajout seul (historique et prolongations).
- Expiration **calculée à la lecture** (`expires_at`) + tâche de rappel ; aucun timer en mémoire
  n'est la source de vérité.
- API `checkException({ guildId, userId, permission, service })` : refus par défaut ; cache de
  30 s maximum ; une révocation incrémente une génération qui invalide les caches.
- Approbation : `interaction.user.id === PND_OWNER_DISCORD_ID` revérifié à chaque clic.
  Seul l'OWNER approuve ; **l'OWNER ne peut pas être bénéficiaire** et aucun demandeur ne
  peut approuver sa propre demande.
- Boutons à usage unique : identifiant de demande + nonce stocké ; un clic sur une demande déjà
  traitée ou expirée est refusé (rejeu d'ancienne interaction).
- Signature HMAC des lignes approuvées avec un secret serveur (`PND_AUTHORITY_SECRET`, à créer par
  l'OWNER lui-même) : une ligne modifiée à la main dans la base est ignorée.
- **Jamais de permission Discord** : une dérogation applicative ne donne aucun rôle. Une demande
  touchant aux permissions Discord produit une recommandation vérifiée (hiérarchie, capacités
  réelles du bot, rôle protégé via `roleGrantRefusal`), jamais une action automatique.
- Indisponibilité : si la table ne répond pas, `checkException` répond « pas de dérogation » et
  les permissions normales continuent.

### 5.3 Commandes

AUTHORITY est une nouvelle application : 0/100 commandes. Proposition : **une seule racine**
`/authority` (`demander`, `mes-demandes`, `statut`, `historique`, et pour l'OWNER `panneau`), plus
le préfixe à choisir. Panneau OWNER en MP avec boutons Approuver / Refuser / Suspendre / Révoquer.

### 5.4 Intégration

Ordre : exemptions de quota (le plus utilisé) → packs premium → accès vocaux → économie →
nouveaux bots. Chaque service garde ses permissions normales et appelle `checkException`
seulement quand le contrôle normal refuse.

## 6. SUCK ME — STAFF CENTER (phase 1) : existant

Déjà présent : `/staff` (liste, échelle, promouvoir, rétrograder, absence, retour),
`/staffhistory`, `/rapportstaff` (rapport du lundi, alerte d'inactivité), `/dossier`,
`/candidature` (dépôt, entretiens, évaluation), `/academy` (parcours, quiz), `/sysp suivi`
(fiche, stats, notes, vote), `/sysp urgence`, quotas et sanctions partagés (`bot/shared/`),
`staff-abuse.js` (alertes d'abus), `staff-freeze-gate.js`, `/guide` (permissions).

Ajouté en phase 1 (28/11) : disponibilités et astreintes, planning, passation, dossiers
d'intervention, missions, réunions, formation (exercices, certification), `/staff centre`.
Tout passe par la racine `/staff` existante (SUCK ME reste à 83/100) et `=staff`.
Reste : analyse du staff (charge, délais, participation) dans INSIGHT (phase 9), à partir des
totaux déjà enregistrés (`onCallTotals`, `missionTotals`, historique des dossiers).

## 7. Économie commune : existant

LE FISC : `economy.js` + `economy-integrity.js` (réconciliation), `economy-antifraud.js`,
`economy-operations.js`, marché, enchères, contrats, métiers, missions (`docs/modules/pnd-economy-*`).
Invest + : `bot/features/investplus.js`, `business-investments.js`. Instantanés vers Supabase
(`bot_economy_snapshots`). `/pnd-add` limité à l'OWNER configuré.

Manque : un **registre transactionnel unique** par lequel passent toutes les créations et tous
les transferts (ARCADE, EVENT et SOCIAL devront l'utiliser), avec clé d'idempotence par opération,
corrections et remboursements tracés.

## 8. Centre d'aide : existant

- `/aide` partagé par les 6 bots ; `bot/features/help-panel.js` (panneau d'aide).
- `/guide` (SUCK ME) = guide des **permissions**, pas un guide membre.
- `/knowledge` + `bot/pnd-knowledge.js` : rubriques d'information utilisées par l'IA.
- **`/assistance` n'existe pas** (le mot n'apparaît que dans `tickets.js`).
- Tickets : `bot/tickets.js`, `ticket-records.js`, `/ticket` (panel, close, add, remove, list,
  notes, assign, historique, transcript), notation (`ticket-rating.js`), file d'attente
  (`support-waiting.js`), modmail (`/outils modmail`). → Le centre d'aide doit **s'appuyer sur ce
  système de tickets**, pas en créer un second.
- Documentation des commandes : le catalogue `src/lib/slash-commands.ts` contient nom, description,
  usage et catégorie : base de la documentation automatique.

## 9. Sécurité et fiabilité

### 9.1 Boucles de reconnexion Discord — corrigé pour tous les bots (à déployer)

Cause : chaque démarrage consomme une des ~1000 connexions quotidiennes d'une application.
`gateway-watchdog.js` freinait les connexions **échouées**, mais pas un bot qui se connecte puis
plante, ni les redémarrages PM2 pour mémoire (`max_memory_restart` : 140 Mo pour le principal,
160 Mo pour les spécialisés, 220 Mo pour FDPDLAVOC), les déploiements ou les retours arrière.
Avec `min_uptime: 15s`, un plantage après 15 s n'était jamais compté par PM2 : boucle sans fin.

Correctif (`bot/session-budget.js`, appelé par `bot/index.js` avant chaque connexion, donc pour
**les 6 profils actuels et les 5 futurs**) :

1. Chaque démarrage est noté dans le SQLite partagé (`bot_gateway_starts`, par profil).
   6 démarrages libres par 6 h ; au-delà, pause de 1, 2, 4, 8, 16 puis 30 min avant de se
   connecter. Une boucle de plantage toutes les 5 s passe de ~17 000 à moins de 100 connexions
   par jour (testé).
2. Lecture de `/gateway/bot` (gratuite) : à 10 connexions restantes ou moins, le bot attend la
   réinitialisation Discord (réglable : `PND_SESSION_RESERVE`).
3. Pendant l'attente, le bot ne tient pas son bail : le bot principal couvre son domaine.
4. Marqueur `.session-wait` : les installateurs (`installer.sh` des bots,
   `deploy-pnd-v5-oracle.sh`) ne prennent plus cette attente pour un échec, donc plus de retour
   arrière inutile (c'est ce qui avait aggravé le 27/11).
5. Toute erreur de ces contrôles laisse la connexion se faire (jamais de blocage sur un diagnostic).

### 9.2 Constats de sécurité

| # | Constat | Gravité | Action |
|---|---|---|---|
| S1 | Règles centrales présentes et testées : OWNER par ID seul, `role-grant-guard.js` (rôles protégés par ID et permissions, jamais par nom), Tier 0 (`tier0-shield.js`), BLR, MZ désactivé, test anti-« FWU » dans Discord (`discord-branding.test.js`). | OK | conserver |
| S2 | Secrets passés par le chat (`DISCORD_CLIENT_SECRET`, `SESSION_SECRET`) non encore régénérés (feuille de route D.10). | Haute | OWNER : régénérer |
| S3 | `fwu-auto-update.sh` téléchargeait par défaut `herolfriendss/her-v3-` (ancien nom). | Corrigé | essaie `fwu-bot` puis `her-v3-` |
| S4 | La mise à jour automatique installe `main` (ou la dernière version publiée) chaque nuit : **fusionner dans `main` = déployer en production**. | Moyenne | ne fusionner qu'après validation ; envisager des versions publiées uniquement |
| S5 | Pas d'environnement de test (bot et serveur Discord séparés) (D.18). | Moyenne | à créer par l'OWNER |
| S6 | Sauvegardes chiffrées hors VPS et test de restauration absents (D.19) ; `fwu-sauvegarde.sh` existe mais tourne seulement si sa ligne cron a été ajoutée. | Moyenne | vérifier sur le VPS |
| S7 | `pm2 startup` / `pm2 save` et rotation des journaux PM2 non vérifiés (A.3, D.17). | Moyenne | vérifier sur le VPS |
| S8 | Commande slash nommée `fwu` (« Vue d'ensemble des cinq bots ») : le nom contient « FWU », que la règle d'identité réserve au site. | Faible | décision OWNER : renommer (`/bots` ?) en gardant l'ancien nom un temps |
| S9 | Description « cinq bots » / « 5 bots » dans plusieurs commandes (`/fwu`, `/maj`, `/quota`) : à mettre à jour quand les nouveaux bots arrivent. | Faible | lors de la phase concernée |
| S11 | Dans une vingtaine de modules (`/staff`, `/roletemp`, `/stabilite`, vocal de masse, tickets, presence…), le **propriétaire du serveur Discord** a les mêmes droits d'acteur que l'OWNER configuré. Les rôles protégés restent réservés à l'OWNER par ID (`role-grant-guard.js`), et le propriétaire Discord a de toute façon tous les droits dans Discord. Le retirer partout pourrait bloquer des usages actuels. | Décision OWNER | AUTHORITY et toute nouvelle commande OWNER : **ID configuré uniquement** (règle appliquée) ; harmoniser l'existant si l'OWNER le décide |
| S10 | 26 tests sautés : tests PostgreSQL (`pgTest`) qui demandent une base de test. | Info | fournir une base PostgreSQL jetable dans la vérification |

## 10. Tests

Exécuté le 28/11/2026 dans l'espace de travail (Node 22, sans token, sans base de production) :

```
bash scripts/verify-all.sh
OK   bot-test        1305 tests : 1279 réussis, 0 échec, 26 sautés (PostgreSQL)
OK   smoke           3178 exécutions, 0 anomalie
OK   audit-commands  184 commandes, 0 doublon
OK   audit-replies
OK   vitest          294 réussis
OK   tsc
OK   eslint          0 erreur, 6 avertissements (react-refresh, existants)
```

Nouveaux tests : `bot/session-budget.test.js` (9 cas : démarrages libres, pause croissante,
boucle de 24 h < 100 connexions, séparation par profil, réserve Discord, erreurs réseau sans
blocage ni fuite du token, marqueur d'attente).

À ajouter au fil des phases : profils (6 + 5), isolation des serveurs pour chaque table nouvelle,
AUTHORITY (liste du cahier des charges § 5.J), transactions idempotentes, files persistantes et
reprise, tutoriels, centre d'aide, confidentialité.

Non vérifiable depuis l'espace de travail (à faire sur le VPS ou en staging) : comportement réel
des connexions Discord, PM2, cron, sauvegardes.

## 11. Risques

| Risque | Mesure |
|---|---|
| Fusion dans `main` = déploiement automatique nocturne | branches + validation OWNER avant fusion |
| SUCK ME proche de 100 commandes | sous-commandes ; SOCIAL et EVENT reprennent des commandes de SUCK ME |
| 5 applications Discord de plus = 5 budgets de connexion et 5 tokens à gérer | garde de budget commune (fait), installation par l'OWNER uniquement |
| Mémoire du VPS (11 processus) | mesurer avant d'ajouter ; limites `max_memory_restart` par profil |
| AUTHORITY devient une porte dérobée | refus par défaut, OWNER seul par ID, signature, aucune permission Discord, tests d'attaque |
| Quarantaine Discord par excès d'appels | quotas DISPATCH, regroupement des notifications |
| Deux systèmes concurrents (tickets, aide, exceptions) | toujours étendre l'existant (§ 5.1, § 8) |

## 12. Plan de migration et ordre des tâches

Ordre du cahier des charges, ajusté aux dépendances réelles : AUTHORITY et le registre
économique dépendent de FWU CORE ; SOCIAL/EVENT/ARCADE dépendent du registre économique pour les
récompenses ; le centre d'aide peut avancer en parallèle de CORE car il lit le catalogue existant.

**Phase 0 — Audit et stabilisation**
- [x] 0.1 Audit du dépôt et ce plan.
- [x] 0.2 Garde de budget de connexions pour tous les bots (fusionnée, PR #76).
- [x] 0.3 Alerte staff dans Discord quand un bot tombe, attend son budget de connexions, s'arrête définitivement ou revient (`bot/fleet-watch.js`) : le bot principal surveille tous les autres, SUCK ME surveille le bot principal ; MP à l'OWNER seulement pour un arrêt définitif.
- [x] 0.4a `fwu-auto-update.sh` choisit seul le bon nom de dépôt (`fwu-bot` puis l'ancien `her-v3-`) ; surveillance externe : « Bot principal » au lieu de « FWU » dans Discord.
- [ ] 0.4b Contrôles VPS (avec l'OWNER, accès VPS requis) : `pm2 startup`/`pm2 save`, rotation des journaux, cron de sauvegarde et de surveillance.
- [x] 0.5 Les 26 tests PostgreSQL tournent déjà dans la CI GitHub (PostgreSQL 16) ; seuls les essais locaux sans base les sautent.

**Phase 1 — STAFF CENTER (SUCK ME, sans nouvelle racine)**
- [x] 1.1 Disponibilités et astreintes : `/staff dispo`, `/staff astreinte`, `/staff disponibles` (`bot/staff-availability.js`, expiration stockée donc fiable après redémarrage, aucun rôle donné, staff seulement).
- [x] 1.2 Planning et passation : `/staff planning` (couverture de la semaine par tranche, trous signalés), `/staff passation` (notes de relève, sans mention possible).
- [x] 1.3 Dossiers d'intervention : `/staff intervention` (ouvrir, liste, voir, assigner, preuve, note, cloturer, valider) — `bot/staff-interventions.js`. Numéro par serveur, historique en ajout seul, preuves https ou messages du même serveur, références `sanction:12` / `journal:34` / `ticket:7` / `appel:3` vers les systèmes existants, validation secondaire par un autre SYS+/OWNER pour la priorité haute. Rappels des dossiers inactifs : prévus avec `/staff centre` (1.6).
- [x] 1.4 Missions et réunions : `/staff mission` (creer, liste, terminer, annuler ; individuelle ou collective, échéance) et `/staff reunion` (planifier, liste, compte-rendu, annuler ; rappel 30 min avant, une seule fois même après redémarrage) — `bot/staff-missions.js`.
- [x] 1.5 Formation : `/staff formation` (exercice : cas pratiques raid / conflit / signalement avec correction expliquée ; reponse ; valider : certification d'un parcours `/academy` terminé par un autre SYS+/OWNER ; certifications) — `bot/staff-training.js`. Jamais de rôle donné ; un test vérifie que les cas pratiques ne citent que des commandes existantes.
- [x] 1.6 `/staff centre` : tableau de commandement (staff joignable, interventions dont urgentes et inactives depuis 48 h, validations, tickets, Guardian, contestations, missions en retard, réunions, état des bots) — `bot/staff-command-center.js`. Les demandes de dérogation AUTHORITY s'y ajouteront en phase 3.

**Phase 2 — FWU CORE**
- [x] 2.1 Événements : identifiant universel (`uid`), clé d'idempotence par serveur, version de schéma (`bot/event-bus.js`, colonnes ajoutées sans réécrire l'existant).
- [x] 2.2 File persistante de tâches entre bots (`bot/core-queue.js`) : idempotence, bail (une tâche jamais faite deux fois en parallèle, jamais perdue si le bot plante), reprises 30 s → 1 h, échec définitif visible dans `/staff centre`, relance manuelle seulement. Chaque bot traite les tâches de son profil toutes les 15 s.
- [x] 2.3 Service de décision des permissions (`bot/core-permissions.js`) : catalogue fermé d'actions, refus par défaut, OWNER par ID configuré uniquement, gel du staff respecté, permissions Discord exigées en plus, dérogation AUTHORITY consultée seulement pour les actions « dérogeables », jamais pour une action OWNER ni pour l'OWNER. À utiliser par tout nouveau module et nouveau bot.
- [x] 2.4 Journal d'audit unifié (`bot/core-audit.js`) : en ajout seul, numéroté par serveur, chaîné par empreinte SHA-256 (HMAC avec `PND_AUDIT_SECRET` si l'OWNER le crée) ; toute modification manuelle est détectée par `verifyAuditChain` ; secrets masqués ; export CSV protégé contre les formules.
- [ ] 2.5 Registre transactionnel : déplacé en phase 6 (il doit être construit avec le code économique de LE FISC, `economy.js` / `economy-integrity.js`, pour ne pas créer un second système).

**Phase 3 — AUTHORITY**
- [x] 3.1 Registre et vérification (`bot/authority.js`) : demandes avec justification et durée (1 h à 30 j), décisions OWNER seul (approuver, refuser, suspendre, réactiver, révoquer, prolonger), nonce à usage unique, signature HMAC (`PND_AUTHORITY_SECRET`, sinon `BOT_SYNC_SECRET`), expiration à la lecture, rappels, journal chaîné. `hasException()` branché sur `core-permissions.js`. Les 15 cas d'attaque du cahier des charges sont testés (`bot/authority.test.js`).
- [x] 3.2 Quotas de modération : une dérogation `moderation.quota.extra` approuvée par l'OWNER double le quota du membre pendant sa durée (`bot/shared/quotas.js`). Elle ne remplace jamais l'accès à la modération, n'ouvre jamais une commande interdite au palier (0), ne passe jamais le gel d'urgence ; les exemptions `/quota exemption` existantes sont inchangées.
- [x] 3.3 Commandes `/authority` (demander, mes-demandes, statut, historique ; OWNER : panneau, decider ; MP à l'OWNER avec boutons Approuver / Refuser à usage unique) — `bot/features/authority-commands.js`. Portées par SUCK ME (84/100 commandes) jusqu'à la création du bot AUTHORITY : l'OWNER crée l'application Discord et fournit son token lui-même, puis la racine `authority` passe au profil `authority` dans `src/lib/bot-profiles.ts`. `/staff centre` affiche les dérogations en attente et actives.
- [ ] 3.4 Page AUTHORITY de la console (même service).

**Phase 4 — Centre d'aide** : 4.1 documentation générée depuis le catalogue ; 4.2 présentation des bots ; 4.3 tutoriels interactifs ; 4.4 assistant IA branché sur la documentation réelle ; 4.5 parcours dépannage → ticket existant.

**Phase 5 — SOCIAL et EVENT** · **Phase 6 — Économie interconnectée** · **Phase 7 — DISPATCH** ·
**Phase 8 — ARCADE** · **Phase 9 — INSIGHT** · **Phase 10 — Automatisation et supervision.**

## 13. Critères de validation (pour chaque tâche)

1. `bash scripts/verify-all.sh` entièrement vert, tests nouveaux inclus.
2. Aucune fonctionnalité ni commande existante retirée (audit des commandes comparé avant/après).
3. Nombre de commandes slash par application ≤ 100, équivalents préfixés conservés.
4. Aucun secret dans le code, les messages, les journaux ou les tests.
5. Règle d'identité respectée (`discord-branding.test.js`).
6. Plan de validation en staging pour ce qui dépend de Discord.
7. Branche dédiée ; fusion dans `main` seulement après accord de l'OWNER (déploiement automatique).

## 14. Suivi des tâches

| Tâche | État | Branche |
|---|---|---|
| 0.1 Audit et plan directeur | terminé | `claude/fwu-v2-audit-session-budget` |
| 0.2 Garde de budget de connexions | fusionné (#76) | `claude/fwu-v2-audit-session-budget` |
| 0.3 / 0.4a | fusionné (#77) | `claude/fwu-v2-fleet-watch` |
| 1.1 / 1.2 | fusionné (#78) | `claude/fwu-v2-staff-center` |
| 1.3 Dossiers d'intervention | fusionné (#79) | `claude/fwu-v2-staff-cases` |
| 1.4 Missions et réunions | fusionné (#80) | `claude/fwu-v2-staff-missions` |
| 1.5 Formation | fusionné (#81) | `claude/fwu-v2-staff-training` |
| 1.6 Centre de commandement | fusionné (#82) | `claude/fwu-v2-staff-command` |
| 2.1 / 2.2 Événements idempotents, file persistante | fusionné (#83) | `claude/fwu-v2-core-queue` |
| 2.4 Journal d'audit unifié | fusionné (#85) | `claude/fwu-v2-core-audit` |
| 2.3 Décision des permissions | fusionné (#86) | `claude/fwu-v2-core-permissions` |
| 3.1 Registre AUTHORITY | fusionné (#87) | `claude/fwu-v2-authority-core` |
| 3.3 Commandes AUTHORITY | fusionné (#88) | `claude/fwu-v2-authority-commands` |
| 3.2 Quotas et AUTHORITY | terminé | `claude/fwu-v2-authority-quota` |

## 15. Reprise du travail (pour une nouvelle session)

1. Lire ce document, puis `docs/specs/` (demandes de l'OWNER) et `AGENTS.md` (règles du dépôt).
2. Prendre la première case non cochée du § 12, une tâche à la fois.
3. Branche `claude/fwu-v2-<tâche>` depuis `origin/main` ; tests (`bash scripts/verify-all.sh`) ;
   `python3 -I scripts/package-bot.py` puis `git add -f public/downloads/bot-oracle.zip` quand `bot/` change ;
   mise à jour de ce document et de `CHANGELOG.md` ; PR, CI verte, fusion (accord permanent de
   l'OWNER du 28/11 pour fusionner seul après tests et CI verts). Jamais de force-push.
4. Si `main` a bougé (autre session), fusionner `origin/main` dans la branche ; seul conflit
   habituel : l'archive `bot-oracle.zip`, à régénérer.
5. GitHub bloque les pushs contenant un faux token dans un test : construire ces chaînes à
   l'exécution.

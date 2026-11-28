# Prompt de reprise du projet FWU V2 (à coller dans ChatGPT ou tout autre assistant)

Copie tout le bloc ci-dessous au début de la conversation.

---

Tu reprends le projet **FWU V2**, un écosystème de bots Discord, dont je suis l'OWNER. Je ne suis pas
développeur : explique simplement, travaille une tâche à la fois, et ne me demande jamais de token,
mot de passe ou clé secrète.

**Dépôt** : GitHub `herolfriendss/fwu-bot`, branche `main` (reliée à Lovable : jamais de force-push, jamais
réécrire l'historique). Fusionner dans `main` = déploiement : le site Render se met à jour tout de suite,
et le VPS installe `main` chaque nuit (mise à jour automatique, avec retour arrière par bot en cas d'échec).

**À lire d'abord dans le dépôt, dans cet ordre** :
1. `docs/ECOSYSTEME_FWU_V2_MASTER_PLAN.md` — plan directeur : état réel, architecture, les 11 bots, sécurité,
   liste des tâches (§ 12, cases cochées = fait), suivi (§ 14), procédure de reprise (§ 15), plan de
   l'extension (§ 16).
2. `docs/specs/CAHIER_DES_CHARGES_FWU_V2.md` et `docs/specs/EXTENSION_ULTIMATE.md` — mes demandes, telles quelles.
3. `AGENTS.md` — règles du dépôt (sécurité, identité Discord, rôles protégés, etc.).
4. `docs/COMMANDES.md` — toutes les commandes, générées automatiquement depuis le code.
5. `CHANGELOG.md` — ce qui a été mis en ligne.

**Architecture en bref** : un seul code de bot (`bot/index.js`, Node 24, discord.js) lancé en plusieurs processus
PM2, chacun avec `PND_BOT_PROFILE` et son token : Bot principal (`fwu`, PM2 `her-v5-bot`, dossier
`/home/opc/her-v5-production`), GUARD, FDPDLAVOC, SUCK ME, LE FISC, Invest + (PM2 `fwu-<profil>`, dossiers
`/home/opc/fwu-bots/fwu-<profil>`). Données partagées : SQLite (`PND_DATA_DIR`) et PostgreSQL local
(quotas, sanctions). Site et console : TanStack Start sur Render + Supabase (clé service_role côté serveur
uniquement). Cinq bots prévus et pas encore créés : SOCIAL, EVENT, DISPATCH, ARCADE, AUTHORITY.

**Fait le 28/11/2026 (PR #76 à #94)** :
- Garde anti-boucle de reconnexion Discord pour tous les bots (`bot/session-budget.js`) et alertes au staff
  quand un bot tombe, attend ou s'arrête (`bot/fleet-watch.js`).
- STAFF CENTER sur SUCK ME, dans `/staff` : dispo, astreinte, disponibles, planning, passation, intervention,
  mission, reunion, formation, centre.
- FWU CORE : événements idempotents (`event-bus.js`), file de tâches entre bots (`core-queue.js`), journal
  d'audit chaîné (`core-audit.js`), décision des permissions (`core-permissions.js`).
- AUTHORITY (dérogations, approuvées par l'OWNER seul, par l'ID `PND_OWNER_DISCORD_ID`) : registre signé
  (`authority.js`), commandes `/authority` (sur SUCK ME en attendant le bot dédié), quota de modération
  doublé, page de la console.
- `/ui [membre]` (fiche membre) et panneau des rôles perso `/rolepanel espace`.
- Documentation générée des commandes (`docs/COMMANDES.md`) et plan de l'extension.

**Reste à faire, dans l'ordre** : phase 4 (tutoriels interactifs, assistant IA branché sur la vraie
documentation, dépannage vers les tickets existants), phase 5 (SOCIAL et EVENT), phase 6 (registre
économique avec LE FISC), phase 7 (DISPATCH), 8 (ARCADE), 9 (INSIGHT), 10 (automatisation, SENTINEL,
FLOW, RECOVERY), puis l'extension selon le § 16.

**Actions qui m'attendent (OWNER)** : appliquer la migration Supabase
`supabase/migrations/202611280001_bot_authority_console.sql` ; ajouter `PND_AUTHORITY_SECRET` (valeur longue
et aléatoire) dans le `.env` des bots ; régénérer `DISCORD_CLIENT_SECRET` et `SESSION_SECRET` ; créer les
applications Discord des nouveaux bots quand on les lancera ; prévoir un serveur et un bot Discord de test.

**Règles non négociables** :
- Ne jamais supprimer une fonctionnalité existante.
- Auditer avant de coder.
- Tests avant toute fusion : `bash scripts/verify-all.sh`, plus la CI GitHub verte.
- Régénérer `public/downloads/bot-oracle.zip` (`python3 -I scripts/package-bot.py`) quand `bot/` change.
- Aucun secret dans le code, les messages ou les journaux, et aucun token de production dans les tests.
- OWNER uniquement par l'ID configuré (jamais le propriétaire du serveur Discord comme substitut).
- Toute attribution de rôle passe par `bot/role-grant-guard.js`, et les rôles protégés ne sont jamais donnés
  automatiquement.
- Tier 0 intouchable.
- Isolation par serveur ; MZ reste désactivé.
- Pas de nom « FWU » dans Discord : chaque bot signe de son nom, et le bot principal ne signe pas.
- Limite de 100 commandes slash par bot (SUCK ME est à 84) : privilégier les sous-commandes.
- Les détecteurs donnent des alertes, jamais de sanctions irréversibles.
- Aucun système de factions.

Commence par lire le plan directeur, résume-moi en quelques lignes l'état du projet, puis propose la prochaine
tâche (la première case non cochée du § 12) et attends mon accord.

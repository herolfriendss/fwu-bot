# Her? V4 — Audit technique final

Date : 4 novembre 2026
Base auditée : `46a6160` (`feat: add Her? V4 modules`) + fondation `bb3db61`
Périmètre : code local uniquement. Aucune base distante modifiée, aucun déploiement Oracle, aucun secret modifié, aucun commit ni push supplémentaire.

## 1. Résumé exécutif

Les 9 modules livrés dans `46a6160` (GuildGuard, modération, vérification, économie PND, social, cartes, vocal V2, jeux/événements, tickets, automatisation) sont câblés dans `bot/index.js` et leurs commandes slash sont toutes routées vers un gestionnaire réel. Les bugs bloquants découverts ont été corrigés localement et couverts par des tests.

État global : **opérationnel localement**, sous trois conditions externes :
1. appliquer la migration Supabase `202611040001_bot_economy_snapshots.sql` si elle ne l’est pas déjà ;
2. configurer `V4_ALLOWED_GUILD_IDS` sur le VPS pour garantir le blocage du troisième serveur ;
3. valider une fois en conditions réelles Discord/Oracle les actions qui touchent l’API Discord (sanctions, salons, vocal, streaming).

Validation finale :

| Vérification | Résultat |
|---|---|
| `npx vitest run` | **28 fichiers / 161 tests réussis** |
| `npx tsc --noEmit` | **aucune erreur** |
| `npm run build` | **build réussi** |
| `node --check` sur tous les fichiers bot | **aucune erreur de syntaxe** |
| Préparation SQL SQLite (121 requêtes statiques) | **0 requête invalide** |
| Commandes slash | **74 commandes, 0 doublon, 100 % routées** |
| Codes d’événements runtime | **56 utilisés, tous déclarés** (`ticket_error` déclaré mais non utilisé) |

## 2. Statut par fonctionnalité

Légende : **opérationnelle** = code complet + tests locaux ; **partielle** = code complet mais validation live indispensable ou configuration requise ; **non opérationnelle** = blocage fonctionnel ; **bloquée** = hors périmètre / action distante volontairement non exécutée.

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Câblage et initialisation des modules | **Opérationnelle** | Tous les modules sont importés et branchés dans `bot/index.js` ; schedulers jeux/automatisation démarrés ; `recoverBlackjackGames()` appelé au démarrage. |
| Enregistrement des slash commands | **Opérationnelle** | Fusion commande par commande via `POST`/`PATCH`, aucun `PUT` global, commandes personnalisées préservées. Propagation Discord globale : jusqu’à 1 h. |
| Gestionnaires des slash commands | **Opérationnelle** | Les 74 commandes ont un handler (cœur, économie, social, cartes, DOG, vocal, musique, radio, modération, GuildGuard, tickets, automatisation, jeux, SYS+). Test de couverture exhaustif. |
| Permissions et sécurité | **Opérationnelle** | Permissions revérifiées dans les handlers ; hiérarchie des rôles protégée ; propriétaire du serveur et administrateurs protégés ; aucun secret renvoyé au navigateur. Validation live des sanctions Discord restant à faire. |
| Isolation des deux serveurs | **Opérationnelle** | Toutes les tables SQLite et tous les réglages sont indexés par `guild_id` ; tests d’isolation wallets/profils/cartes ; événements filtrés par guilde. |
| GuildGuard — admission / anti-raid / quarantaine | **Opérationnelle** | Décisions pures testées + handler runtime testé (kick réel simulé, bots ignorés, guard désactivé). |
| GuildGuard — blocage d’un troisième serveur | **Opérationnelle sous condition** | Allowlist appliquée à `ready`, `shardResume`, `guildCreate`, et en défense en profondeur sur les événements. **Nécessite `V4_ALLOWED_GUILD_IDS`** ; vide = bot accepte tous les serveurs (données toujours isolées). |
| Modération (warn/mute/kick/ban/purge/lock…) | **Opérationnelle** | Politique et hiérarchie testées ; handler complet. Les appels Discord réels (timeout, kick, ban) n’ont pas été exécutés contre un serveur réel. |
| Vérification (`/verify`) | **Opérationnelle** | Panneau + bouton, âge minimal, rôle configurable via dashboard ; correction de l’utilisation du salon configuré. |
| Économie PND | **Opérationnelle** | Wallet partagé, daily, work, banque, historique, vol, loterie, boutique, blackjack, classement (banque incluse). **Transactions imbriquées corrigées**. |
| Social (profils, bio, couleur, réputation) | **Opérationnelle** | Bug SQL corrigé (le `user_id` n’est plus écrasé) ; cooldown de réputation testé ; couleur et bio persistées sur une seule ligne. |
| Cartes et échanges | **Opérationnelle** | Pack atomique, remboursement en cas de solde insuffisant, échange avec mention corrigé, isolation par guilde, persistance disque. |
| Vocal V2 (hub, salons temporaires) | **Opérationnelle** | Création/suppression, propriétaire, claim, lock/unlock, limite et nom. Validation live Discord recommandée. |
| Jeux et événements | **Opérationnelle** | Dés, pile ou face, trivia, giveaways, événements ; giveaways/événements persistés. Les sessions de trivia en cours sont volontairement éphémères (mémoire). |
| Tickets staff | **Opérationnelle** | Panneau, ouverture, claim, close, add/remove, journal, audit SYS+, nettoyage si salon supprimé. Validation live de création de salon recommandée. |
| Automatisation | **Opérationnelle** | Rôles automatiques via politique testée (doublons, rôles gérés, hiérarchie), MP de bienvenue, messages planifiés persistés. |
| Dashboard — Modules V4 | **Opérationnelle** | Onglet « Modules V4 », édition des 6 modules, sauvegarde via fonctions owner-only ; test statique de câblage. Validation navigateur recommandée. |
| Dashboard — Économie PND | **Opérationnelle sous condition** | Page `/economie`, snapshots bornés, lecture owner-only. Dépend de la migration `bot_economy_snapshots`. |
| Persistance après redémarrage | **Opérationnelle** | SQLite WAL, tables additives, migrations sans suppression ; test de réouverture de la base et de remboursement des blackjacks actifs. |
| Migrations Supabase | **Bloquée (volontairement)** | Aucune migration distante appliquée ni vérifiée. Liste en section 6. |
| Déploiement Oracle / live Discord | **Bloquée (hors périmètre)** | Aucun déploiement, aucun redémarrage VPS, aucun test contre l’API Discord réelle. |
| DOG / musique / radio / IA (V3) | **Opérationnelle, non modifiée** | Systèmes V3 conservés ; seuls les branchements V4 et tests de non-régression ont été ajoutés. Streaming YouTube et crédits IA non testables localement. |

## 3. Bugs réels corrigés

1. **Transactions imbriquées** — `bot/database.js`
   `/pack` et les paiements de jeux ouvraient une transaction dans une transaction, ce qui échouait avec `cannot start a transaction within a transaction`. Ajout de SAVEPOINT réentrants (`transactionDepth`).
2. **SQL du profil couleur** — `bot/social.js`
   La requête `=color` écrivait `''` à la place du `user_id`. Requête réécrite avec les 5 paramètres corrects.
3. **Échange de cartes par slash** — `bot/cards.js`
   La mention `<@id>` restait dans les arguments et décalait les identifiants de cartes. Les mentions sont maintenant retirées avant lecture.
4. **Panneau de vérification** — `bot/moderation.js`
   `/verify panel` sans salon explicite utilise désormais `verification.channelId` configuré.
5. **Classement PND** — `bot/economy.js`
   Le classement ignore désormais uniquement les soldes nuls et inclut la banque (`balance + bank`).
6. **Rôles automatiques** — `bot/automation.js`
   Application via `autoRolePlan()` : déduplication, rôles déjà possédés, rôles gérés et hiérarchie du bot.
7. **Blocage du troisième serveur** — `bot/guild-guard.js` + `bot/index.js`
   Ajout de `guildAllowed()` et `enforceGuildAllowlist()` ; application au démarrage, à la reprise, aux invitations et à chaque événement. Les rapports statut/économie filtrent aussi les serveurs non autorisés.
8. **Snapshot économique rejeté** — `src/lib/economy.ts`
   Un wallet peut contenir `balance + bank` jusqu’à 2 × 10¹² ; la limite du schéma Zod est alignée pour éviter de faire rejeter tout le snapshot.
9. **Pile ou face non atomique** — `bot/games.js`
   Débit et gain sont maintenant dans une seule transaction (slash et préfixe).
10. **Tests exécutables hors jsdom** — `bot/database.js`, `src/test/setup.ts`
    Chemin SQLite configurable (`HER_DB_PATH`), `fileURLToPath`, et setup compatible environnement Node.
11. **Déclarations TypeScript** — ajout de `bot/{database,economy,social,cards,guild-guard}.d.ts` pour les tests d’intégration.

## 4. Tests ajoutés

| Fichier | Couverture |
|---|---|
| `src/test/bot-wiring.test.ts` | Imports/initialisation, schedulers, enregistrement sans `PUT`, allowlist, couverture des 74 commandes, limite des embeds `/aide`. |
| `src/test/database-flows.test.ts` | PND partagé, transactions imbriquées, pack atomique + rollback, profil bio/couleur, cooldown réputation, échange de cartes, isolation par guilde, persistance disque, daily/work/banque, loterie, remboursement blackjack, snapshot dashboard. |
| `src/test/guild-guard-runtime.test.ts` | `guildAllowed`, `handleGuildCreate`, `enforceGuildAllowlist`, refus de quitter, erreur Discord, kick réel simulé, bots/guard désactivé. |
| `src/test/v4-dashboard.test.ts` | Onglet Modules V4, édition des 6 modules, fonctions owner-only, liste blanche `module-settings`. |
| `src/test/bot-settings.test.ts` | Ajout des défauts V4, bornage indépendant des 6 modules, fusion d’un module sans écraser les autres. |
| `src/test/guild-guard.test.ts`, `src/test/economy.test.ts` | Déjà présents ; complétés pour l’allowlist et la limite de wallet. |

## 5. Fonctionnalités non couvertes par les tests locaux

Ces points ne peuvent pas être validés sans un serveur Discord réel, le VPS Oracle ou la base Supabase distante :

- sanctions Discord réelles : timeout, kick, ban, suppression de messages, permissions de salon ;
- création/suppression réelle de salons de tickets et vocaux temporaires ;
- connexion vocale, lecture YouTube et radio continue ;
- propagation réelle des commandes globales côté Discord ;
- parcours navigateur complet du dashboard (les tests vérifient le câblage, pas le rendu) ;
- application des migrations Supabase et lecture/écriture distante ;
- réponse IA externe et crédits du fournisseur ;
- redémarrage PM2/Oracle et reprise réelle des schedulers.

## 6. Migrations à appliquer

Aucune migration distante n’a été exécutée. Impossible de savoir depuis le dépôt seul lesquelles sont déjà appliquées sur Supabase. À vérifier avant mise en service :

| Migration | Rôle |
|---|---|
| `supabase/migrations/202611040001_bot_economy_snapshots.sql` | **Nouvelle migration V4** : miroir borné de l’économie PND pour le dashboard. À appliquer en priorité si absente. |
| `supabase/migrations/202611020001_bot_runtime_guilds.sql` | Statut runtime et guildes du bot. |
| `supabase/migrations/202611010002_sysplus_audit_grants.sql` | Droits d’audit SYS+. |
| `supabase/migrations/202611010001_discord_interaction_receipts.sql` | Reçus d’interactions Discord. |
| `supabase/migrations/202610300002_sysplus_role.sql` | Rôle SYS+. |
| `drizzle/migrations/0001_bot_settings.sql` | Table `bot_settings`. |
| `drizzle/migrations/0002_bot_runtime_status.sql` | Table de statut runtime. |

Sans `202611040001`, la page `/economie` et l’envoi des snapshots échoueront (message explicite prévu). Les modules eux-mêmes continuent de fonctionner car SQLite reste la source de vérité.

## 7. Sécurité et isolation — points vérifiés

- Toutes les fonctions serveur Discord appellent `requireOwner()` (sauf l’endpoint public d’interactions, protégé par signature Ed25519, et les endpoints bot protégés par `BOT_SYNC_SECRET`).
- Aucun secret n’est renvoyé au client ; seuls des booléens de présence sont exposés.
- Les commandes de modération vérifient permission, position hiérarchique, propriétaire et administrateurs.
- Les boutons de tickets, vérification, giveaways, trivia et blackjack vérifient la guilde et/ou l’auteur avant toute action.
- Les données SQLite ne sont jamais supprimées lors du retrait d’un serveur ; seul le serveur est quitté.
- L’allowlist vide est volontairement permissive ; pour un déploiement à deux serveurs, renseigner `V4_ALLOWED_GUILD_IDS`.

## 8. Limites et actions restantes

1. **Appliquer `202611040001_bot_economy_snapshots.sql`** si elle n’est pas déjà sur Supabase (action distante, non réalisée ici).
2. **Configurer `V4_ALLOWED_GUILD_IDS`** avec les deux identifiants de serveur sur le VPS, puis redémarrer le bot.
3. **Valider en live** les sanctions, tickets, vocal temporaire, giveaways et la musique/radio.
4. **Vérifier le dashboard** dans un navigateur après application de la migration.
5. **Régénérer et redéployer** `public/downloads/bot-oracle.zip` si la distribution publique est publiée (archive locale déjà régénérée et inspectée : aucun `.env` réel, aucune base, aucun secret).

## 9. État du dépôt

Les corrections et tests de cet audit sont **locaux et non commités**. `main` reste sur `46a6160` ; aucun push n’a été effectué. Les systèmes V3 fonctionnels n’ont pas été réécrits.

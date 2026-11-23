# Her? V4 — Rapport de stabilisation des modifications non commitées

Date : 4 novembre 2026
Base : `46a6160` — `feat: add Her? V4 modules (guard, moderation, economy, social, cards, voice, games, tickets, automation)`
Périmètre : code local uniquement. **Aucun commit, aucun push, aucune migration distante, aucun déploiement, aucune donnée de production modifiée.**

## 1. Synthèse

Les corrections issues de l’audit technique sont toujours présentes localement, non commitées, et la validation complète repasse au vert :

| Vérification | Résultat |
|---|---|
| `npx vitest run` | **28 fichiers / 161 tests réussis** |
| `npx tsc --noEmit` | **aucune erreur** |
| `npm run build` | **build réussi** (`✓ built in 5.94s`) |
| `node --check` (9 fichiers bot) | **aucune erreur de syntaxe** |
| `git diff --check` | **propre** (aucun espace/tab en fin de ligne, aucun conflit) |
| Secrets / données dans le diff | **aucun secret, aucune base, aucune donnée** |
| HEAD | **`46a6160`**, rien de staged, rien de poussé |

État git : **15 fichiers suivis modifiés** (+223 / −52), **10 fichiers non suivis** (881 lignes). `main` n’a pas bougé.

## 2. Inventaire précis

### 2.1 Fichiers suivis modifiés (15)

| Fichier | Δ | Correction |
|---|---:|---|
| `bot/database.js` | +37 / −2 | Transactions réentrantes par `SAVEPOINT` (`transactionDepth`), chemin SQLite configurable `HER_DB_PATH`, `fileURLToPath` pour les chemins. |
| `bot/social.js` | +2 / −2 | `=color` écrit enfin `user_id` : la requête avait 4 paramètres pour 5 colonnes et écrasait l’utilisateur par `''`. |
| `bot/cards.js` | +6 / −2 | `/trade propose` et `=trade propose` retirent la mention `<@id>` des arguments avant de lire les deux identifiants de cartes. |
| `bot/moderation.js` | +4 / −1 | `/verify panel` sans salon explicite utilise `verification.channelId` configuré, puis le salon courant en dernier recours. |
| `bot/economy.js` | +1 / −1 | Classement PND : `balance + bank`, tri stable `balance DESC, user_id ASC`, seuls les soldes strictement positifs. |
| `bot/automation.js` | +20 / −12 | Rôles automatiques via `autoRolePlan()` : déduplication, rôles déjà possédés, rôles gérés, hiérarchie du bot. Un seul `fetch` par rôle. |
| `bot/guild-guard.js` | +29 | Ajout de `guildAllowed()` et `enforceGuildAllowlist()` ; `handleGuildCreate` réutilise la même règle. Ne supprime aucune donnée. |
| `bot/index.js` | +21 / −8 | Allowlist appliquée à `ready`, `shardResume`, `guildCreate`, `messageCreate`, `guildMemberAdd/Update`, `voiceStateUpdate`, `channelDelete`, `interactionCreate` ; statut et snapshots économie filtrés. |
| `bot/games.js` | +8 / −4 | Pile ou face atomique : débit et gain dans une seule transaction (slash + préfixe). |
| `src/lib/economy.ts` | +2 / −1 | Limite Zod du wallet alignée sur `balance + bank` ≤ 2 × 10¹² pour ne plus rejeter un snapshot valide. |
| `src/test/bot-settings.test.ts` | +48 | Défauts V4 d’une configuration héritée, bornage indépendant des 6 modules, fusion d’un module sans écraser les autres. |
| `src/test/economy.test.ts` | +4 | Un wallet à 2 × 10¹² est accepté par le schéma de snapshot. |
| `src/test/setup.ts` | +20 / −18 | Le setup jsdom ne référence `window` que s’il existe, pour les tests SQLite en environnement `node`. |
| `bot/.env.example` | +5 | Documentation de `V4_ALLOWED_GUILD_IDS` (vide = permissif, liste = isolation). |
| `bot/README.md` | +17 | Section « Isolation des serveurs » : comportement au démarrage, reprise et invitation. |

### 2.2 Fichiers non suivis (10)

| Fichier | Lignes | Rôle |
|---|---:|---|
| `HER_V4_AUDIT_FINAL.md` | 140 | Rapport d’audit technique final (existant). |
| `HER_V4_STABILISATION.md` | ce fichier | Rapport de stabilisation. |
| `bot/cards.d.ts` | 1 | Déclaration TypeScript minimale pour les tests. |
| `bot/database.d.ts` | 9 | `db`, `transaction`, signatures. |
| `bot/economy.d.ts` | 24 | API économie utilisée par les tests. |
| `bot/guild-guard.d.ts` | 33 | API GuildGuard + allowlist. |
| `bot/social.d.ts` | 1 | Déclaration minimale. |
| `src/test/bot-wiring.test.ts` | 94 | Câblage, schedulers, enregistrement sans `PUT`, allowlist, couverture des 74 commandes. |
| `src/test/database-flows.test.ts` | 278 | Flux SQLite/PND, transactions, packs, profils, cartes, isolation, persistance, blackjack, snapshot. |
| `src/test/guild-guard-runtime.test.ts` | 133 | Refus du 3ᵉ serveur, `guildCreate`, `enforceGuildAllowlist`, kick réel simulé. |
| `src/test/v4-dashboard.test.ts` | 44 | Onglet Modules V4, édition des 6 modules, fonctions owner-only. |

## 3. Vérification secrets et données

- `.env`, `bot/.env`, `bot/data/`, `public/downloads/` sont **ignorés par git** (`git check-ignore` confirmé).
- Scan du diff suivi : seules occurrences de `secret`/`token` = **noms de variables** (`BOT_SYNC_SECRET`, `DISCORD_TOKEN=`) et un test négatif (`secret: "nope"`). Aucune valeur.
- Scan des fichiers non suivis : uniquement de la prose de sécurité. Aucune clé, aucun webhook, aucun token.
- `git diff --check` : propre.
- Archive `public/downloads/bot-oracle.zip` : ignorée par git, 51 fichiers, `.env.example` présent à champs vides, **aucun `.env` réel, aucun `.sqlite`, aucun `data/`, aucun `node_modules`**. Elle contient bien les versions corrigées (`index.js`, `database.js`, `guild-guard.js`, `games.js`, `automation.js`, `cards.js`, `README.md`).

## 4. Corrections conservées

Les 11 corrections de l’audit sont toutes retrouvées dans le code et couvertes par les tests :

1. transactions imbriquées → `SAVEPOINT` réentrants ;
2. SQL couleur du profil → `user_id` correct ;
3. échange de cartes avec mention → arguments nettoyés ;
4. panneau `/verify` → salon configuré ;
5. classement PND → banque incluse ;
6. rôles automatiques → planificateur pur ;
7. blocage du 3ᵉ serveur → allowlist runtime + événements ;
8. snapshot économique → limite Zod alignée ;
9. pile ou face → transaction unique ;
10. tests hors jsdom → `HER_DB_PATH` + setup conditionnel ;
11. déclarations TypeScript → 5 fichiers `.d.ts`.

Aucune correction n’a été perdue ni écrasée : les 161 tests repassent, dont les tests d’intégration ajoutés.

## 5. Systèmes V3 préservés

Le diff ne touche **aucun** fichier V3 : `bot/music/`, `bot/systems/sysplus/`, `bot/dog*.js`, `bot/radio*.js`, les routes, les composants dashboard et les fonctions serveur existantes sont inchangés. Seuls les modules V4, leur câblage, le schéma de snapshot et les tests sont modifiés. Les commandes préfixées `=` continuent de partager la même logique métier.

## 6. Ce qui n’a pas été fait (volontairement)

- Aucun commit ni push : les corrections restent locales sur `main`.
- Aucune migration Supabase appliquée ou vérifiée : l’état distant est inconnu depuis le dépôt.
- Aucun déploiement, redémarrage PM2/Oracle ou test contre l’API Discord réelle.
- Aucune donnée de production lue, modifiée ou supprimée.

La suite est décrite dans `HER_V4_DEPLOIEMENT_SECURISE.md` : vérification de la migration, configuration de `V4_ALLOWED_GUILD_IDS`, tests sur serveur privé, puis déploiement conditionné à validation.

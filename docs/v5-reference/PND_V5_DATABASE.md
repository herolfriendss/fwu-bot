# PND V5 — Modèle de données

> Dépend de : ARCHITECTURE, PERMISSIONS. Tables ✅ vues dans des extraits de `database.js` : `temp_voice`, `voice_panels`, `voice_menottes` (+ `expires_at`), `guild_permission_roles`, `admin_plus_scope_permissions`, tables d'audit SYS+. Tout le reste est 🆕 ou ❓ (économie, modération, tickets… : schéma jamais vu).

## 1. Conventions

- Moteur : SQLite via `node:sqlite` (existant). Réglages dashboard : JSON Supabase `bot_settings` (existant, conservé, voir D4).
- **Chaque table métier porte `guild_id TEXT NOT NULL`** et un index commençant par `guild_id`. Exception justifiée : `guilds`, `schema_migrations`.
- Identifiants Discord en `TEXT` (snowflakes). Dates en epoch millisecondes `INTEGER`.
- Montants en entiers (pas de flottants).
- Suppression : douce (`deleted_at`) pour économie, modération, tickets ; dure uniquement pour la rétention.
- Contraintes d'unicité **par guilde** (`UNIQUE(guild_id, …)`).
- Accès uniquement par dépôts bornés à `guild_id` (ARCHITECTURE §5).

## 2. Migrations

- Table `schema_migrations(version, name, applied_at, checksum)`.
- Fichiers `modules/<id>/migrations/NNNN_nom.sql` ; **additives et idempotentes** (`CREATE TABLE IF NOT EXISTS`, ajout de colonne avec vérification `PRAGMA table_info`, comme la migration `expires_at` déjà vue).
- Jamais de `DROP` ou de renommage destructif sans validation humaine.
- Sauvegarde automatique du fichier SQLite avant toute migration (copie datée).
- Test : appliquer la suite depuis un instantané de schéma V4/V5 et vérifier l'idempotence (deux exécutions = même état).
- Aucune migration lancée sur des données de production sans validation.

## 3. Plateforme

```sql
guilds(id PK, name, status CHECK(status IN('active','disabled','pending')), prime INTEGER DEFAULT 0, created_at)
guild_modules(guild_id, module_id, enabled INTEGER, config_json, updated_by, updated_at, PRIMARY KEY(guild_id, module_id))
guild_settings(guild_id PK, prefix, locale, settings_json, updated_at)
guild_entitlements(guild_id, key, source CHECK(source IN('prime','license','manual')), granted_at, expires_at, PRIMARY KEY(guild_id, key, source))
licenses(id PK, guild_id, plan, status, starts_at, ends_at)             -- modèle seul, aucun paiement
permission_scopes(guild_id, role_id, scope, granted_by, granted_at, PRIMARY KEY(guild_id, role_id, scope))
audit_log(id PK, guild_id, ts, actor_id, actor_kind, action, target, decision, code, request_id, meta_json)
jobs(id PK, guild_id, kind, run_at, payload_json, status, attempts, locked_until)
```

`permission_scopes` remplace à terme `admin_plus_scope_permissions` et `guild_permission_roles` (❓ contenu inconnu) : migration par copie, anciennes tables conservées.

## 4. Modules (tables principales)

**Guardian** : `moderation_cases(id, guild_id, user_id, type, reason, moderator_id, created_at, expires_at)`, `warnings(id, guild_id, user_id, case_id, created_at)`, `appeals(id, guild_id, case_id, status, created_at, decided_by)` — **un seul appel ouvert sous 7 jours** (index unique partiel).

**Economy** : `economy_accounts(guild_id, user_id, balance, updated_at, PK(guild_id,user_id))`, `economy_ledger(id, guild_id, user_id, delta, reason, ref_type, ref_id, idempotency_key UNIQUE(guild_id,idempotency_key), created_at)` **append-only** ; `escrows(id, guild_id, kind, holder, amount, status, ref)`.
Invariants : `balance = SUM(delta)` ; aucun `UPDATE/DELETE` sur le ledger (déclencheurs d'interdiction) ; solde ≥ 0.

**Business / Investments** : `businesses`, `business_members`, `investments(id, guild_id, user_id, principal, risk, opened_at, closed_at)`, `investment_ticks(investment_id, ts, seed, delta)`.

**Social / Events / Games** : `social_profiles`, `reputation_events(guild_id, giver, receiver, ts)`, `badges`, `events`, `event_signups`, `game_sessions(id, guild_id, game, state_json, bet, status)`.

**Academy / Awards / Recruitment / Stories** : `academy_tracks`, `academy_progress`, `award_campaigns`, `award_votes(guild_id, campaign_id, voter_id, UNIQUE)`, `applications`, `stories(…, expires_at)`.

**Tickets** : `tickets(id, guild_id, channel_id, opener_id, category, status, claimed_by, created_at, closed_at)`, `ticket_events(ticket_id, ts, kind, actor_id)` — **métadonnées seulement**.

**Voice** ✅/❓ : `temp_voice(channel_id PK, guild_id, owner_id, created_at)` ; `voice_panels(panel_id, guild_id, channel_id, created_by)` ; `voice_menottes(…, expires_at)` ; 🆕 `voice_snapshots(guild_id, channel_id, member_id, overwrite_json, created_at)` pour restaurer après redémarrage (à confirmer après audit de `voice-commands.js`, qui semble garder ces instantanés).

**DOG** ✅ : état actuellement dans un fichier JSON (`dog-state.json`, clé `guildId:memberId`). 🆕 `dog_leashes(guild_id, member_id, owner_id, role_id, previous_nick, since, PK(guild_id, member_id))`. Migration par import idempotent, fichier d'origine conservé.

**Automation** : `automations(id, guild_id, name, trigger_json, conditions_json, actions_json, enabled, created_by)`, `automation_runs(id, automation_id, ts, status, detail_json)`.

**Intelligence** : `ai_memory(id, guild_id, scope, scope_id, content, ttl_at, created_by)`, `ai_actions(id, guild_id, requester_id, plan_json, status, created_at)`, `ai_action_steps(action_id, idx, tool, args_json, result_json, undo_json, status)`, `ai_usage(guild_id, user_id, day, requests, tokens, writes)`.

**Radar / Wrapped** : `analytics_daily(guild_id, day, metric, value, PK(guild_id,day,metric))` — agrégats, **pas de contenu de messages** ; valeur absente = ligne absente (jamais zéro implicite).

**Sauvegardes** : `backup_manifests(id, guild_id, created_at, scope, size, sha256, location)` — jamais de secret ni de jeton.

## 5. Isolation

- Dépôt : `repo(guildId)` injecte `WHERE guild_id = ?` et refuse toute requête sans portée.
- Test d'isolation générique : pour chaque dépôt, écrire en guilde A et vérifier l'absence de lecture/écriture en guilde B.
- Journaux et analytics portent la guilde source ; aucune jointure inter-guildes dans le code applicatif.
- MZ : lignes autorisées dans `guilds` avec `status='disabled'` ; aucune écriture de module tant que désactivé.

## 6. Rétention (propositions, à valider)

Audit : 12 mois. Tickets (métadonnées) : 6 mois après fermeture. Mémoire IA : 30 jours par défaut. Analytics : 24 mois en agrégats. Données de candidature : 3 mois après décision. Purge par `jobs`, journalisée.

## 7. Sauvegarde et restauration

- Sauvegarde : copie cohérente du fichier SQLite (API de sauvegarde ou verrou court), nom daté, somme SHA-256, manifeste.
- Restauration : **toujours sur une copie** d'abord ; vérification d'intégrité (`PRAGMA integrity_check`) et de version de schéma.
- Le serveur de production n'est jamais atteint sans votre validation (Oracle/VPS).

## 8. Critères de validation

- Chaque table a `guild_id` ou une exception documentée (test statique sur le schéma).
- Migration depuis un instantané V5 : réussie, idempotente, sans perte (comptage avant/après).
- Ledger : tentative d'`UPDATE`/`DELETE` refusée ; somme = solde sur jeu aléatoire de 10 000 opérations.
- Index unique partiel : un second appel ouvert est refusé.
- Import DOG JSON → SQLite : même contenu, deux exécutions sans doublon.

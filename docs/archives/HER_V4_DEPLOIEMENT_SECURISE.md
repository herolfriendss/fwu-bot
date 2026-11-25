# Her? V4 — Procédure de déploiement sécurisée

Date : 4 novembre 2026
Prérequis : `HER_V4_STABILISATION.md` validé (28 fichiers / 161 tests, TypeScript, build et bot OK).
Règle absolue : **aucun test sur la production**, **aucune écriture sans sauvegarde**, **un seul processus bot** sur la base SQLite.

> Statut actuel : procédure **préparée, non exécutée**. Les corrections sont locales et non commitées sur `main` (`46a6160`).

## Phase 0 — Préparation et sauvegardes (obligatoire)

1. Choisir une fenêtre de maintenance et prévenir les utilisateurs des deux serveurs.
2. Relever l’état de départ :
   ```bash
   git log -1 --oneline          # doit afficher 46a6160 + corrections locales
   node --version                # Node 24 LTS
   pm2 status
   ```
3. Sauvegarder la base SQLite **de façon cohérente** (WAL) :
   ```bash
   sudo install -d -m 700 /var/backups/her
   sqlite3 bot/data/economy.sqlite \
     ".backup '/var/backups/her/economy-$(date +%F-%H%M).sqlite'"
   npm --prefix bot run export:economy -- \
     "/var/backups/her/economy-$(date +%F-%H%M).json"
   ```
4. Sauvegarder les fichiers d’environnement (chiffrés, jamais dans git) :
   ```bash
   tar czf /var/backups/her/env-$(date +%F-%H%M).tar.gz .env bot/.env
   chmod 600 /var/backups/her/env-*.tar.gz
   ```
5. Sauvegarder Supabase : tableau de bord → **Database → Backups** (ou `pg_dump` fourni par le propriétaire). Vérifier que la restauration est possible avant de continuer.
6. Sauvegarder aussi `bot/data/dog-state.json`, `bot/data/voice-locks.json`, `bot/data/radio-config.json` si présents.
7. Vérifier l’espace disque et que `pm2` ne lance **pas** le bot en cluster.

## Phase 1 — Vérifier la migration Supabase

La migration concernée est `supabase/migrations/202611040001_bot_economy_snapshots.sql` (table `public.bot_economy_snapshots`, miroir borné de l’économie PND). Elle est **additive** : nouvelle table, RLS activée, aucun droit `anon`/`authenticated`, `service_role` uniquement.

### 1.1 Vérifier d’abord sur un projet Supabase de test

Dans **SQL Editor** du projet de test :

```sql
-- La table existe-t-elle ?
select to_regclass('public.bot_economy_snapshots') as table_exists;

-- RLS active ?
select c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'bot_economy_snapshots';

-- Droits attendus : service_role seulement
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'bot_economy_snapshots'
order by grantee, privilege_type;
```

Attendu : `table_exists = public.bot_economy_snapshots`, `rls_enabled = true`, aucun privilège pour `anon`/`authenticated`, `service_role` avec `SELECT/INSERT/UPDATE/DELETE`.

- **Si la table existe déjà** : ne rien réappliquer, passer à 1.3.
- **Si elle manque** : appliquer le fichier tel quel, sans le modifier :
  - avec la CLI liée au projet de test :
    ```bash
    supabase link --project-ref <ref-test>
    supabase db push --dry-run     # relire la liste
    supabase db push
    ```
  - ou coller le contenu du fichier dans le SQL Editor du projet de test.
- Ne jamais utiliser `supabase db reset` ni recréer la base.

### 1.2 Tester les lectures/écritures sur le projet de test

```sql
-- Insertion de test (service_role / SQL Editor)
insert into public.bot_economy_snapshots (guild_id, guild_name, total_balance)
values ('000000000000000000', 'test', 0)
on conflict (guild_id) do update set captured_at = now();
select * from public.bot_economy_snapshots where guild_id = '000000000000000000';
delete from public.bot_economy_snapshots where guild_id = '000000000000000000';
```

Puis, avec un dashboard de test et une session propriétaire, ouvrir `/economie` : la page doit se charger sans le message « Vérifie que la migration bot_economy_snapshots est appliquée ».

### 1.3 Vérifier la production (lecture seule d’abord)

Rejouer les trois requêtes de 1.1 sur le projet **de production**, sans insertion. Si la table manque :

1. refaire la sauvegarde Supabase (Phase 0) ;
2. appliquer la migration (CLI ou SQL Editor) ;
3. rejouer les requêtes de contrôle ;
4. ouvrir `/economie` avec la session propriétaire ;
5. vérifier les logs : aucun `Impossible de lire/enregistrer les soldes PND`.

En cas d’échec : ne pas insérer de données manuellement, restaurer la sauvegarde et revenir en arrière. La migration étant additive, les modules Discord continuent de fonctionner sans elle (SQLite reste la source de vérité).

## Phase 2 — Configurer `V4_ALLOWED_GUILD_IDS` sur Oracle

L’allowlist n’est lue **que par le nouveau code**. Ordre recommandé : déployer le code (Phase 4), puis renseigner la variable et redémarrer. Tant que la variable est vide, le bot accepte toutes les invitations (les données restent isolées par `guild_id`).

1. Récupérer les identifiants des deux serveurs autorisés (Discord → mode développeur → clic droit sur le serveur → **Copier l’identifiant**).
2. Éditer `bot/.env` sur le VPS, avec un éditeur de confiance :
   ```dotenv
   V4_ALLOWED_GUILD_IDS=111111111111111111,222222222222222222
   ```
   - séparateur : virgule, **sans espaces** ;
   - ne jamais committer ce fichier ;
   - `chmod 600 bot/.env`.
3. Redémarrer **uniquement** le bot, après le déploiement du code :
   ```bash
   pm2 restart her-v3-bot
   pm2 logs her-v3-bot --lines 100
   ```
4. Contrôles attendus :
   - log `[bot] allowlist: N serveur(s) non autorisé(s) quitté(s).` si un serveur en trop était présent ;
   - `/status` (dashboard) ne liste que les serveurs autorisés ;
   - les snapshots économie ne concernent que ces serveurs ;
   - inviter le bot sur un serveur tiers de test : il doit quitter immédiatement (`guild_blocked`) ;
   - un message/interaction provenant d’un serveur non autorisé est ignoré.
5. Si un serveur légitime a été retiré par erreur : le réinviter **après** avoir corrigé l’allowlist. Ses données SQLite n’ont pas été supprimées.

> Attention : l’allowlist ne remplace pas les permissions Discord. Le rôle du bot doit rester au-dessus des rôles qu’il gère.

## Phase 3 — Tester sur un serveur Discord privé

### 3.1 Isolation des tests

- Créer un **serveur Discord privé** dédié, avec des comptes de test (dont un compte non administrateur).
- Recommandé : instance de test séparée (token Discord de test) et base dédiée :
  ```bash
  HER_DB_PATH=/var/lib/her-test/economy.sqlite npm --prefix bot start
  ```
  Ne jamais pointer les tests vers la base de production ni vers le bot de production.
- Si le même bot est utilisé, ajouter temporairement l’ID du serveur privé à `V4_ALLOWED_GUILD_IDS` et **le retirer après les tests**, puis redémarrer.
- Ne pas exécuter de sanctions, purges ou giveaways sur des membres réels.

### 3.2 Matrice de tests minimale

| Domaine | À tester | Attendu |
|---|---|---|
| Démarrage | `ready`, enregistrement des slash | commandes fusionnées, aucun `PUT` global, IDs existants préservés |
| Économie | `/balance`, `/daily`, `/work`, banque, `/pay`, `/leaderboard` | soldes corrects, classement **banque incluse**, pas de double débit |
| Boutique | `/shop`, `/buy`, `/inventory` | débit et rôle atomiques, remboursement si échec |
| Jeux | `/roulette`, `/blackjack`, `/dice`, `/coinflip` | un seul débit, boutons protégés par auteur/guilde |
| Social / cartes | `/profil`, `/bio`, `/rep`, `/color`, `/pack`, `/trade propose @membre …` | couleur persistée sur la bonne ligne, échange avec mention correct |
| Modération | `/warn`, `/warnings`, `/mute`, `/unmute`, `/kick`, `/ban`, `/purge`, `/slowmode`, `/lock`, `/unlock` | permissions et hiérarchie respectées, owner/admins protégés |
| Vérification | `/verify panel` avec salon configuré | panneau dans le bon salon, bouton attribue le rôle |
| GuildGuard | statut, enable/disable, quarantaine, log | décisions conformes, aucun kick de bot |
| Tickets | panneau, ouverture, claim, close, add/remove | salon créé/supprimé, journal, permissions |
| Vocal V2 | hub, limite, nom, claim, lock/unlock, delete | salon temporaire isolé, propriétaire respecté |
| Automatisation | autorole, MP de bienvenue, messages planifiés | doublons/gérés/hiérarchie ignorés, un seul rôle appliqué |
| Événements | trivia, giveaway, event | persistance après redémarrage |
| Redémarrage | arrêt puis relance | wallets, tickets, giveaways conservés ; blackjacks actifs remboursés ; salons vocaux orphelins nettoyés |
| Allowlist | invitation d’un serveur tiers | départ immédiat, données locales intactes |
| Dashboard | `/economie`, onglet Modules V4 | lecture owner-only, sauvegarde d’un module sans écraser les autres |

### 3.3 Critères de sortie

- Aucune erreur `[bot]` dans les logs, aucun secret affiché.
- Aucun débit/perte de PND inattendu.
- Les commandes répondent en moins de quelques secondes.
- Les tests d’isolation (serveur tiers, autre guilde) passent.
- Consigner les résultats (date, testeur, commandes, anomalies) dans un ticket.

Tant qu’un point échoue : **ne pas déployer en production**, corriger, relancer `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `node --check`.

## Phase 4 — Déployer la V4 après validation

### 4.1 Figer et publier le code validé

1. Relire `git status` et `git diff` (aucun secret, aucune donnée).
2. Créer une branche, commiter les corrections et tests, ouvrir une PR (le commit n’est pas fait dans cette étape de préparation).
3. Attendre la CI/validation, puis fusionner sur la branche déployée. **Ne pas** réécrire l’historique déjà poussé (contrainte Lovable).
4. Taguer la version validée, par exemple `v4.0.0`.

### 4.2 Mettre à jour Oracle

```bash
# Sur le VPS, dans le dossier du projet
git fetch --tags
git checkout v4.0.0
npm ci
npm --prefix bot ci
npm run build
node --check bot/index.js
pm2 restart her-v3-web her-v3-bot
pm2 save
```

- Conserver `.env` et `bot/.env` existants (ne pas les remplacer).
- Vérifier que `V4_ALLOWED_GUILD_IDS` est bien renseigné après le redémarrage (Phase 2).
- Ne jamais lancer deux processus bot sur la même base.

### 4.3 Vérifications post-déploiement

```bash
pm2 status
pm2 logs her-v3-bot --lines 200
curl -fsS https://<domaine>/api/health   # si disponible
```

Puis :
- `/status` et `/economie` dans le dashboard ;
- une commande économique et une commande de modération sur un serveur autorisé ;
- vérification que le bot a quitté tout serveur hors allowlist ;
- contrôle des logs d’événements (aucun code inconnu, aucun secret).

Surveiller 24–48 h : erreurs PM2, snapshots économie, tickets/vocal, mémoire.

### 4.4 Rollback

| Situation | Action |
|---|---|
| Erreur de code | `git checkout <tag-précédent>` → `npm ci` → `npm --prefix bot ci` → `npm run build` → `pm2 restart her-v3-web her-v3-bot`. |
| Corruption de données SQLite | Arrêter le bot, restaurer la sauvegarde `.backup`, redémarrer, vérifier les soldes. |
| Migration Supabase problématique | Restaurer la sauvegarde Supabase. La table étant additive, un retour du code V3 fonctionne même si elle reste présente. |
| Allowlist trop restrictive | Corriger `bot/.env`, `pm2 restart her-v3-bot`, réinviter les serveurs légitimes. |

Les données SQLite ne sont jamais supprimées par les migrations V4 (tables additives uniquement).

## Phase 5 — Checklist go/no-go

- [ ] Sauvegardes SQLite, Supabase et `.env` vérifiées et restaurables.
- [ ] Migration `202611040001_bot_economy_snapshots.sql` vérifiée (table, RLS, droits) sur test **puis** production.
- [ ] `/economie` se charge sans erreur de migration.
- [ ] Code validé (161 tests, TypeScript, build, `node --check`).
- [ ] Commit/PR/tag effectués (hors de cette préparation).
- [ ] `V4_ALLOWED_GUILD_IDS` renseigné avec les deux IDs, redémarrage effectué.
- [ ] Serveur privé : matrice de tests passée, aucune anomalie bloquante.
- [ ] Serveur tiers : bot quitte immédiatement.
- [ ] Dashboard et commandes vérifiés après déploiement.
- [ ] Fenêtre de surveillance 24–48 h planifiée.

Tant que les cases 1 à 5 ne sont pas cochées, **ne pas déployer**.

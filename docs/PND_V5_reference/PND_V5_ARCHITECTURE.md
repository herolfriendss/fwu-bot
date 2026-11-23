# PND V5 — Architecture technique

> Dépend de : `PND_V5_MASTER_PLAN.md`. Les chemins `bot/…` existants sont ✅ ou ❓ selon le plan ; les chemins nouveaux sont 🆕.

## 1. Vue d'ensemble

```
Discord (Gateway + Interactions)        Dashboard (navigateur)
        │                                        │
  adapters/discord-slash                  src/ (TanStack Start)
  adapters/discord-prefix                 *.functions.ts, routes/api/
  adapters/discord-components                    │
        └──────────────┬─────────────────────────┘
                       ▼
              platform/catalog  ──►  platform/policy (authorize)
                       │
                       ▼
              modules/<id>/service.js   (logique métier partagée)
                       │
        ┌──────────────┼───────────────┐
        ▼              ▼               ▼
   platform/db    platform/jobs   platform/ai (provider adapters)
   (SQLite,       (planificateur) (Intelligence)
   migrations)
```

Règle de dépendance : `adapters → catalog/policy → services → core/db`. Un service **ne dépend pas de discord.js** : il reçoit un objet `DiscordPort` (interface minimale : `getMember`, `addRole`, `createChannel`…) injecté, ce qui permet de le tester sans Discord.

## 2. Existant à conserver

- ✅ `bot/index.js` : démarrage, intents, branchement des événements, autostart radio.
- ✅ `bot/v4-commands.js` : routage slash/préfixe V4. **Conservé tel quel**, appelé via un pont « legacy ».
- ✅ `bot/systems/sysplus/*`, `bot/systems/setup/*`, `bot/dog-*.js` : conservés, rebranchés sur `policy` en P2.
- ✅ `bot/module-settings.js` + `src/routes/api/public/bot-sync.ts` : canal bot ↔ dashboard, conservé.
- ❓ Modules économie, vocal, musique, social, GuildGuard, automatisation : enveloppés par des façades, jamais réécrits avant audit.

## 3. Organisation des dossiers (proposée)

```
bot/
  platform/
    registry.js          chargement des manifestes, activation par guilde
    catalog/             commands.js, build-slash.js, build-docs.js
    policy/              authorize.js, tiers.js, entitlements.js, scopes.js
    db/                  open.js, migrate.js, repo.js (dépôts à portée guilde)
    errors.js            erreurs de domaine
    logger.js            journal sans secrets
    jobs.js              planificateur persistant
    ai/                  core.js, providers/, tools/, agents/, memory.js
  modules/
    guardian/ economy/ business/ investments/ social/ events/
    academy/ games/ awards/ wrapped/ radar/ stories/ recruitment/
    tickets/ voice/ music/ automation/ intelligence/
      manifest.js  service.js  commands.js  events.js  settings.js
      migrations/  tests/
  adapters/
    discord-slash.js  discord-prefix.js  discord-components.js  api.js
  legacy/
    bridge.js            appelle v4-commands.js tant que la parité n'est pas prouvée
  (fichiers V4/V5 existants inchangés)
src/
  lib/                   schémas partagés (zod), types
  routes/api/            routes protégées ; /api/public/* signées ou à secret
  routes/…               pages dashboard
docs/ (les 10 documents + recettes/)
```

## 4. Manifeste de module

```js
export default {
  id: "economy",
  version: "1.0.0",
  tier: "CORE",                       // CORE | SYS+
  entitlements: [],                   // ex. ["economy.advanced"]
  requires: ["platform"],             // dépendances de modules
  commands: ["eco"],                  // groupes déclarés au catalogue
  settings: ecoSettingsSchema,        // schéma zod, valeurs par défaut sûres
  scopes: ["economy.manage"],         // scopes ADMIN+ exposés
  migrations: "./migrations",
  events: ["guildMemberAdd"],
  init(ctx) {}, dispose() {},
};
```

Le registre refuse de charger un module dont une dépendance manque, dont une commande n'est pas au catalogue, ou dont la migration n'est pas additive.

## 5. Services : contrat

```js
// Entrée toujours validée et contextualisée ; sortie typée ou erreur de domaine.
async function transfer(ctx, { toUserId, amount }) {
  // ctx = { guildId, actor, requestId, db: repo(guildId), discord: DiscordPort }
}
```

- `ctx.db` est un dépôt **déjà borné à `guildId`** : impossible d'écrire sans portée de guilde.
- Les mutations multi-lignes sont transactionnelles.
- Erreurs : `PermissionDenied`, `NotFound`, `LimitReached`, `ValidationError`, `Conflict`, `Unavailable`. Chaque adaptateur les traduit ; les erreurs techniques sont journalisées sans secret ni contenu de message.

## 6. Flux d'exécution

**Slash** : interaction → vérif. signature/contexte → catalogue (résolution commande) → validation des options → `authorize` → service → réponse (éphémère par défaut pour les sensibles) → audit.

**Préfixe** : message → préfixe configuré de la guilde → résolution via le même catalogue → mêmes étapes. Le préfixe est indépendant des noms de modules.

**Composant (bouton/select/modale)** : `customId` signé → recontrôle auteur, guilde, permissions fraîches (membre re-fetché) → service. Expiration obligatoire.

**API dashboard** : session propriétaire (cookie existant) ou secret `BOT_SYNC_SECRET` → schéma d'entrée → `authorize` (mêmes règles) → service via le bot (`bot-sync`) → réponse.

**Événement Discord** : handler du module → service ; échec isolé (un module en erreur ne stoppe pas les autres).

## 7. Multi-serveurs

- Table `guilds` : `id`, `status` (`active|disabled|pending`), `prime` (bool), `created_at`.
- Allowlist runtime : PND actif ; MZ présent mais `status='disabled'`, activable seulement avec `PND_MZ_ENABLED=true` après validation humaine (existant ✅ côté logs hub).
- Chaque module s'active par guilde (`guild_modules`). Chaque journal et statistique porte la guilde source ; aucune diffusion croisée de données privées.
- Le serveur central de logs est une **destination**, jamais une source de configuration.

## 8. Dépendances

Existantes ✅/📄 : Node 24.22.2, discord.js 14, @discordjs/voice, `node:sqlite`, `node:test` (bot), Vitest (racine), TanStack Start, Supabase (réglages dashboard).
Proposées 🆕 (à justifier avant installation, compatibilité Node 24/lockfiles vérifiée) : `zod` (schémas partagés). Fournisseur IA : tout point d'accès compatible OpenAI, local ou open source en priorité. Aucune autre dépendance par défaut.

## 9. Observabilité et erreurs

- Journal structuré : `ts, level, guildId, module, requestId, code` ; jamais de contenu de message ni de secret.
- Codes d'erreur stables, traduits en messages utilisateur dans l'adaptateur.
- Rapport d'état du bot : codes fixes uniquement (règle existante AGENTS).

## 10. Critères de validation

- Un test démontre qu'un service s'exécute sans discord.js (port simulé).
- Le registre rejette chacun des trois cas invalides du §4.
- Un test d'isolation prouve qu'aucun dépôt n'accède à une autre guilde.
- `legacy/bridge` : chaque commande V4 reste joignable ; test de parité avant tout déplacement.
- Tout nouveau module se branche sans modifier `index.js` au-delà de l'appel du registre.

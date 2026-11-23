# PND V5 — Permissions

> Dépend de : ARCHITECTURE, COMMANDS. Base ✅ : `permissions.js`, `whitelist-policy.js`, politique DOG et `/setup` effectivement lus. Le reste (scopes ADMIN+ en production) est 📄.

## 1. Existant vérifié ✅

- `isSysPlus` : propriétaire du serveur, Administrateur Discord, ou rôle SYS+ configuré.
- `isAdminPlus` : tout SYS+ **ou** rôle ADMIN+ configuré. Il n'est appelé que par un test dans les fichiers vus ; l'usage de production est ❓.
- `canConfigureSysPlus` / `canConfigureAdminPlus` : propriétaire du serveur ou Administrateur.
- WHITELIST : rôle exact par serveur ; exemption de limites internes (quota DOG, anti-spam) ; **jamais** de permission native.
- `/pnd*` : réservé à `PND_OWNER_DISCORD_ID` (un seul ID Discord pour le propriétaire ; les cofondateurs sont déclarés séparément dans `PND_COFOUNDER_DISCORD_IDS`).
- `/setup`, `/panel` : propriétaire ou Gérer le serveur.

## 2. Acteurs et tiers

| Tier | Qui | Portée |
|---|---|---|
| OWNER | `PND_OWNER_DISCORD_ID` (un seul ID Discord pour le propriétaire ; les cofondateurs sont déclarés séparément dans `PND_COFOUNDER_DISCORD_IDS`) | commandes `/pnd*`, licences, PRIME, MZ |
| GUILD_OWNER | propriétaire de la guilde | configuration SYS+/ADMIN+ |
| SYS+ | propriétaire PND, cofondateurs configurés, rôle SYS+ ou admin Discord | fonctions exclusives selon entitlements ; le tier PND_OWNER reste réservé au propriétaire unique |
| ADMIN+ | rôle ADMIN+ | **par scopes** uniquement |
| STAFF | rôles de modération configurés | modération selon scopes |
| MEMBER | tout membre | commandes CORE |
| AI | agent Intelligence | **permissions déléguées** (§6) |

WHITELIST n'est pas un tier : c'est un **modificateur de limites**.

## 3. PND PRIME

- Colonne `guilds.prime` (booléen), modifiable **uniquement** par OWNER via commande propriétaire ou configuration serveur.
- Aucune table de membres ne référence PRIME. Aucune commande ne l'attribue à un rôle ou un utilisateur.
- Effets : ajoute des **entitlements** à la guilde (SYS+, expérimental, accès anticipé, capacités IA étendues). N'accorde aucun droit à un membre : un membre sans SYS+ n'y gagne rien.
- Test : rechercher dans le code toute lecture de `prime` hors `entitlements.js` ; échec si trouvée.

## 4. Entitlements et licences

`guild_entitlements(guild_id, key, source, granted_at, expires_at)`, `source ∈ {prime, license, manual}`. Les licences existent comme modèle de données et interface de lecture. **Aucun paiement.** Une fonction SYS+ exige : entitlement de la guilde **et** acteur SYS+.

## 5. Algorithme `authorize`

```js
authorize({ guildId, actor, action, target?, now }) → { allow, code, needsConfirmation, audit }
```

1. Guilde autorisée (`guilds.status='active'`) ; MZ exige `PND_MZ_ENABLED`. Sinon `GUILD_NOT_AUTHORIZED`.
2. Module activé pour la guilde. Sinon `MODULE_DISABLED`.
3. Entitlement requis présent. Sinon `ENTITLEMENT_MISSING`.
4. Tiers de l'acteur **re-résolus à chaud** (membre re-récupéré, jamais de cache périmé). Sinon `TIER_INSUFFICIENT`.
5. ADMIN+ sans SYS+ : le scope de l'action doit être accordé dans `permission_scopes`. Sinon `SCOPE_DENIED`.
6. Permissions Discord natives de l'acteur si exigées, puis permissions du bot et **hiérarchie des rôles** (acteur > cible, bot > cible). Sinon `DISCORD_PERMISSION` / `HIERARCHY`.
7. Limites (cooldown, quota). Exemption WHITELIST appliquée ici **seulement**. Sinon `LIMIT_REACHED`.
8. Confirmation requise pour actions sensibles → `needsConfirmation: true`.
9. Chaque décision (autorisée ou refusée) alimente `audit_log`.

Aucune étape ne peut être sautée par un tier supérieur, sauf indication explicite dans le catalogue.

## 6. Acteur IA

`actor = { kind: 'ai', onBehalfOf: userId, requestId }`. Droits effectifs = **intersection** de :
- droits du demandeur (re-résolus),
- permissions Discord du bot,
- allowlist d'outils du module,
- limites de quota IA.

Interdits permanents pour l'IA (liste fermée, testée) : modifier SYS+/ADMIN+/WHITELIST/PRIME/licences/entitlements, `/pnd*`, rôles supérieurs ou égaux au rôle du bot, sa propre configuration, sanctions automatiques (ban/kick/mute sans décision humaine), restauration de sauvegarde. L'IA ne lit jamais un secret.

## 7. Scopes ADMIN+

Quatre scopes 📄 existants : rôles, vocal/MENOTTE, LOCKNAME, tickets (stockage `admin_plus_scope_permissions` ❓). Extension 🆕 : un scope par module (`economy.manage`, `events.manage`…). Valeurs par défaut compatibles avec la V4 ; modification réservée à GUILD_OWNER/SYS+ configuration.

## 8. Matrice de référence (extrait, à compléter en P2)

| Action | MEMBER | STAFF | ADMIN+ | SYS+ | G.OWNER | OWNER |
|---|---|---|---|---|---|---|
| `/eco pay` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `/guardian ban` | ✘ | scope | scope | ✔ | ✔ | ✔ |
| `/dog` | ✘ | ✘ | ✘ | ✔ | ✔ | ✔ |
| Configurer SYS+/ADMIN+ | ✘ | ✘ | ✘ | ✘ | ✔ | ✔ |
| `/auto create` | ✘ | ✘ | ✘ | ✔ + entitlement | ✔ | ✔ |
| `/ai ask` | ✘ | ✘ | ✘ | ✔ + entitlement | ✔ | ✔ |
| `/pnd*`, PRIME, licences | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |

« ✔ » reste soumis aux étapes 1–8.

## 9. Interactions de composants

`customId` signé, lié à l'auteur et à la guilde, avec expiration. À chaque clic : mêmes étapes 4 à 7, membre re-récupéré. Les composants d'un autre utilisateur sont refusés.

## 10. Critères de validation

- Matrice complète (tier × scope × action × état de la guilde) générée en test.
- WHITELIST : aucune décision ne passe de « refus » à « accord » par WHITELIST seul, hors limites.
- PRIME : test statique d'usage ; test qu'un membre non SYS+ reste refusé dans une guilde PRIME.
- IA : chaque interdit permanent est refusé ; l'intersection est vérifiée sur 3 demandeurs.
- Isolation : un SYS+ de la guilde A est refusé dans la guilde B.
- Hiérarchie : un acteur ne peut pas agir sur un rôle ≥ au sien.

# PND V5 — Commandes et catalogue central

> Dépend de : ARCHITECTURE, PERMISSIONS. Basé sur le catalogue **réellement lu** (`src/lib/slash-commands.ts`).

## 1. Contrainte mesurée

Le catalogue actuel compte **100 commandes de premier niveau** (limite Discord atteinte) et 78 sous-commandes. Toute nouvelle commande de premier niveau est impossible sans libérer des emplacements. Limites Discord à revérifier à l'implémentation : 100 commandes globales par type, 25 sous-commandes par commande/groupe.

27 commandes déclarées n'ont **aucun gestionnaire dans les fichiers vus** (non forcément absentes du projet) : `action-history, addrole, coinflip, dice, event, giveaway, guildguard, lock, lockname, mute, permissions-edit, purge, removerole, rolepanel, slowmode, sys-add, sys-remove, sysp, ticket, trivia, unlock, unmute, verify, voc, waouf, warn, warnings, webhook`.

## 2. Entrée de catalogue

```js
{
  id: "eco.pay",
  module: "economy",
  slash: { group: "eco", sub: "pay", options: [...] },
  prefix: ["pay"],                  // alias V4 conservés
  tier: "MEMBER",                   // MEMBER | STAFF | ADMIN+ | SYS+ | GUILD_OWNER | OWNER
  scope: null,                      // scope ADMIN+ éventuel
  entitlement: null,                // ex. "economy.advanced"
  discord: { actor: [], bot: ["SendMessages"] },
  limits: { cooldownMs: 3000, quota: null },
  confirm: false,                   // true pour actions sensibles
  service: "economy.transfer",      // service réel obligatoire
  docs: { summary: "...", examples: ["..."] },
  legacy: "pay",                    // nom V4, pour le pont de parité
}
```

Règles vérifiées par test : `service` existe ; `tier` défini ; aucune option sans validateur ; noms uniques ; ≤ 100 commandes de premier niveau ; chaque `legacy` pointe vers une commande V4 réelle.

## 3. Génération depuis une source unique

`build-slash.js` produit les définitions Discord ; `build-docs.js` produit `docs/commands.md` ; `discord-prefix.js` construit sa table de routage ; le dashboard lit le même catalogue. Enregistrement : **POST/PATCH individuels** par commande, jamais de PUT en masse (règle AGENTS : préserver les définitions étrangères et les IDs).

## 4. Regroupement proposé (relocalisation, pas suppression)

Les anciens noms restent joignables en préfixe. Un nom slash n'est retiré qu'après **parité prouvée** et validation humaine.

| Groupe | Commandes V4 absorbées | Libère |
|---|---|---|
| `/music` | play, pause, resume, skip, stop, queue, loop, shuffle, volume, nowplaying, clearqueue, join, leave, radio, musicpanel, remove | 15 |
| `/games` | blackjack, roulette, dice, coinflip, lottery, trivia, card, cards, pack | 8 |
| `/eco` | balance, bank, daily, pay, shop, buy, inventory, work, job, rob, trade, leaderboard | 11 |
| `/social` | profil, bio, rep, toprep, color, salut, info-serveur | 6 |
| `/guardian` | warn, warnings, mute, unmute, kick, ban, history, purge, nettoyer, slowmode, lock, unlock, guildguard, verify, status | 14 |
| `/voice` | voc, pv, access, unaccess, menotte, unmenotte, menotteinfo, vocal-panel, lockname | 8 |
| `/tools` | addrole, removerole, rolepanel, sondage, giveaway, event, webhook, ticket | 7 |

Non regroupées (sensibilité de permission, conserver telles quelles) : `pnd`, `pnd-add`, `pnd-remove`, `pnd-history`, `pnd-audit`, `sys-panel`, `sys-add`, `sys-remove`, `sysp`, `whitelist-*`, `permissions`, `permissions-edit`, `action-history`, `setup`, `panel`, `dog`, `undog`, `doginfo`, `waouf`, `automation`, `ia`, `aide`.

Estimation : ≈ 69 emplacements libérés, 7 groupes créés → net **≈ 62 emplacements disponibles**. C'est une estimation à confirmer par l'audit réel.

**Ordre de migration (par groupe)** : 1) créer le groupe avec ses sous-commandes, 2) test de parité ancien/nouveau, 3) période de double enregistrement si l'espace le permet, 4) retrait individuel des anciens noms slash après validation. Si l'espace manque, commencer par `/music` (16 commandes libérées).

## 5. Sous-commandes de groupes nouveaux (V5)

`/eco` : balance, pay, daily, work, shop, buy, inventory, trade, rob, leaderboard, business (create/info/hire), invest (open/close/list).
`/guardian` : warn, mute, kick, ban, history, appeal, case, raid (status/lockdown/lift), purge, slowmode.
`/voice` : panel, lock, unlock, rename, limit, kick, invite, cuff (set/lift/info), access (add/remove).
`/events` : create, list, join, leave, remind. `/academy` : track, progress, quiz. `/awards` : campaign, vote, results. `/wrapped` : me, guild (SYS+). `/radar` : report, trends (SYS+). `/stories` : post, list, expire. `/recruit` : apply, review, decide. `/ticket` : open, close, claim, transcript. `/auto` : list, create, preview, enable, disable (SYS+). `/ai` : ask, memory (show/forget), quota, history, undo (SYS+). `/license` : status (lecture seule, aucun paiement).

Nouveaux groupes de premier niveau à prévoir : `events, academy, awards, wrapped, radar, stories, recruit, auto, license` → 9, à ajouter **après** libération d'emplacements.

## 6. Validation des paramètres

Un schéma par commande (zod proposé), partagé slash/préfixe/API. Messages d'erreur homogènes ; bornes numériques explicites ; identifiants Discord validés (snowflake). Le préfixe convertit ses arguments en objet puis passe par le même schéma.

## 7. Documentation automatique

Sortie : tableau par module (commande, tier, scope, entitlement, exemple, limites). Le test de documentation échoue si une entrée n'a pas de `docs.summary`.

## 8. Préfixe configurable

`guild_settings.prefix` par guilde, défaut conservé de la V4. Valide : 1 à 3 caractères, pas d'espace, ni mention ni slash initial. Indépendant des noms de modules. Les alias V4 sont conservés.

## 9. Critères de validation

- Test du catalogue : ≤ 100 premiers niveaux, aucune entrée orpheline, services résolus.
- Parité : pour chaque `legacy`, même entrée → même décision `authorize` et même effet métier sur jeu de données identique.
- Registre Discord : une re-synchronisation n'altère aucune commande étrangère au catalogue.
- Un test échoue si un nom slash est retiré sans parité enregistrée.

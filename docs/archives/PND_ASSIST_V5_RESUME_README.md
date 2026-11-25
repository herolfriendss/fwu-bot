# PND Assist V5 — état de reprise

- Date de l’export : 16 novembre 2026
- Référence source du snapshot : `4b5d98a` — baseline P1-C/D/E rapportée dans le dossier de reprise.
- Cette copie est isolée et ne contient pas le dépôt historique d’origine. Un historique Git de travail local a été initialisé pour produire le patch ; il n’est pas inclus dans le ZIP.
- Commit de cette session : `90b3b1a` — intégration slash, correction de la paie et Guardian Risk Review.
- Le ZIP contient l’état complet consolidé ; le patch fourni séparément contient uniquement les différences ajoutées pendant cette session par rapport à ce snapshot.
- Le snapshot ne contient pas le travail P1-A de Claude du commit `07d9cee` sauf si des fichiers correspondants ont été modifiés/ajoutés localement ; demander à Claude de comparer, pas d’écraser.
- P1-B et P1-C/D/E étaient déjà intégrés dans le snapshot de base avant les changements de reprise.
- P1-A OAuth et les extensions P2+ sont présentes dans l’arbre de travail local, mais doivent être auditées avant d’être considérées comme validées. Voir `docs/PND_V5_NIGHT_WORK_20261116.md` pour les contrôles et limites de cette session.

## Changements
 PND_ASSIST_PLUS_CHANGELOG.md                   |   2 +-
 PND_ASSIST_PLUS_MASTER_PLAN.md                 |   2 +-
 PND_ASSIST_PLUS_STATUS.md                      |   2 +-
 bot/README.md                                  |   2 +-
 bot/analytics-buffer.js                        |  34 +++
 bot/automation-rules-commands.js               | 145 +++++++++++
 bot/automation-rules-integration.test.js       |  84 ++++++
 bot/automation-rules-runtime.js                |  74 ++++++
 bot/automation-rules.js                        | 232 +++++++++++++++++
 bot/automation-rules.test.js                   |  96 +++++++
 bot/business-investments-commands.js           | 139 ++++++++++
 bot/business-investments-commands.test.js      |  72 +++++
 bot/business-investments-maintenance.js        |  32 +++
 bot/business-investments-maintenance.test.js   |  32 +++
 bot/business-investments.js                    | 245 +++++++++++++++++
 bot/business-investments.test.js               |  68 +++++
 bot/casino.js                                  |  54 +++-
 bot/casino.test.js                             |  17 ++
 bot/database.js                                | 150 +++++++++++
 bot/economy-integrity.js                       |  57 ++++
 bot/economy-integrity.test.js                  |  34 +++
 bot/economy-operations.js                      |  61 +++++
 bot/economy.js                                 |  24 +-
 bot/guild-guard-commands.js                    |  19 +-
 bot/index.js                                   |  50 ++++
 bot/logs-hub.test.js                           |   2 +-
 bot/organization-commands.js                   | 289 +++++++++++++++++++++
 bot/organization-commands.test.js              | 112 ++++++++
 bot/organization-maintenance.js                |  26 ++
 bot/organization-maintenance.test.js           |  27 ++
 bot/organization.js                            | 346 +++++++++++++++++++++++++
 bot/organization.test.js                       |  97 +++++++
 bot/platform/policy/authorize.js               | 158 +++++++++++
 bot/platform/policy/authorize.test.js          | 117 +++++++++
 bot/pnd-intelligence-access.js                 |   8 +
 bot/pnd-intelligence-access.test.js            |  29 +++
 bot/pnd-intelligence-policy.js                 |  42 +++
 bot/pnd-intelligence-policy.test.js            |  35 +++
 bot/pnd-intelligence-store.js                  |  18 ++
 bot/pnd-intelligence-store.test.js             |  25 ++
 bot/pnd-intelligence.js                        | 249 ++++++++++++++++++
 bot/pnd-owner-policy.js                        |  40 ++-
 bot/pnd-owner-policy.test.js                   |  28 +-
 bot/pnd-owner-routing.test.js                  |   4 +-
 bot/spam-policy.js                             |  19 +-
 bot/spam-policy.test.js                        |   1 +
 bot/systems/sysplus/admin-plus-scope-policy.js |  18 +-
 bot/systems/sysplus/admin-plus-scopes.test.js  |   2 +-
 bot/systems/sysplus/commands.js                |  52 +++-
 bot/systems/sysplus/permissions.js             |  79 +++++-
 bot/systems/sysplus/permissions.test.js        |   2 +-
 bot/systems/sysplus/whitelist-commands.js      |   2 +-
 bot/systems/sysplus/whitelist-policy.js        |  18 +-
 bot/systems/sysplus/whitelist-policy.test.js   |   6 +-
 bot/tickets.js                                 |   2 +
 bot/voice-access-policy.js                     |  32 +++
 bot/voice-access-policy.test.js                |  46 ++++
 bot/voice-access-requests.js                   |  32 ++-
 bot/voice-audit.js                             |  49 ++--
 bot/voice-commands.js                          |   2 +-
 bot/voice-session-reconciliation.js            |  92 +++++++
 bot/voice-session-reconciliation.test.js       |  71 +++++
 bot/voice-v2.js                                |  26 +-
 deploy/oracle/README.md                        |   2 +-
 docs/PND_V5_P1A_DISCORD_OAUTH.md               |  38 +++
 docs/PND_V5_reference/PND_V5_PERMISSIONS.md    |   4 +-
 docs/PND_V5_reference/PND_V5_TEST_PLAN.md      |   2 +-
 docs/v5-reference/PND_V5_PERMISSIONS.md        |   4 +-
 docs/v5-reference/PND_V5_TEST_PLAN.md          |   2 +-
 src/lib/bot-ai.server.ts                       |  71 ++++-
 src/lib/bot-settings.ts                        |   6 +-
 src/lib/discord.functions.ts                   |  16 +-
 src/lib/discord.server.ts                      | 129 +++++----
 src/lib/slash-commands.ts                      |   5 +-
 src/lib/voice-access.ts                        |   4 +-
 src/routeTree.gen.ts                           |  42 +++
 src/routes/api/auth/discord/callback.ts        |  63 +++++
 src/routes/api/auth/discord/start.ts           |  42 +++
 src/routes/api/incident.ts                     |   2 +-
 src/routes/api/public/bot-sync.ts              |  41 ++-
 src/routes/connexion.tsx                       |  76 +++---
 src/test/bot-settings.test.ts                  |  11 +-
 src/test/slash-commands.test.ts                |   9 +
 83 files changed, 4274 insertions(+), 225 deletions(-)

## Nouveaux fichiers

## Fichiers sensibles/runtime exclus de l’archive
- `.env*`, `node_modules`, `.git`, `.output`, `bot/data/`, bases SQLite/DB et clés privées.

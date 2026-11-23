# PND Assist V5 — P2 Guardian Risk Review

## Scope delivered

This increment adds a metadata-only risk signal pipeline and a staff review queue. It supplements the existing GuildGuard admission rules and anti-spam controls; it does not replace them.

## Signals and scoring

The bot observes only aggregate counts on messages from allowlisted source guilds:

| Signal | Trigger | Weight per event |
|---|---:|---:|
| `mention_flood` | At least 5 user, role, or everyone mentions in one message | 30 |
| `link_flood` | At least 3 HTTP(S) links in one message | 25 |
| `rapid_messages` | At least 5 messages from the same member in 10 seconds | 25 |

Signals are grouped per guild/member over a rolling 15-minute window. Each signal's contribution is capped at 3 occurrences and the overall score at 100. At 50 points, one pending staff-review dossier is opened or updated; 75 points is labelled `high`.

These scores are informational. They never trigger a timeout, kick, ban, quarantine, or deletion. Existing anti-spam/GuildGuard policies remain separate and keep their own controls.

## Privacy and retention

- No message text, URL, attachment, audio, or message embed content is stored by this feature.
- The stored record contains guild/member IDs, signal type, an observation count, a message event key, and timestamp.
- Signal rows are removed after 30 days.
- Resolved staff-review dossiers are removed after 180 days; pending dossiers are not automatically discarded.
- All reads, writes, review queues, and retention queries are guild-scoped.

## Staff interface

- Prefix: `=guardian-review list`
- Prefix: `=guardian-review resolve <id> reviewed|cleared [note]`
- Slash: `/guildguard review`
- Slash: `/guildguard resolve id decision note`

Only the server owner, members with `ManageGuild`, or administrators can access the queue. Resolving a dossier only records the human review decision; it never applies a sanction.

## Files

- `bot/guardian-risk-policy.js`: pure thresholds and scoring.
- `bot/guardian-risk.js`: SQLite persistence, review queue, commands, retention.
- `bot/database.js`: additive `guardian_risk_signals` and `guardian_review_queue` tables.
- `bot/index.js`: message metadata signal collection, log on first review dossier, retention timer.
- `bot/guild-guard-commands.js` and `src/lib/slash-commands.ts`: `/guildguard review` and `/guildguard resolve`.

## Validation

The focused Node test files are `bot/guardian-risk-policy.test.js` and `bot/guardian-risk.test.js`. A full bot suite still requires a complete `discord.js` installation and Node 24+, as required by the project manifest.

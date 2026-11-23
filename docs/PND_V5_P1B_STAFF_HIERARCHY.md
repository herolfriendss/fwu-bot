# PND Assist V5 — P1-B staff hierarchy and sanction supervision

## Implemented in this local work branch

- A per-guild `staff_supervisors` SQLite table stores one direct supervisor for each staff member.
- `bot/staff-hierarchy-policy.js` validates Discord snowflakes, prohibits self-supervision, keeps the server owner at the top, and rejects direct or indirect cycles.
- `bot/staff-hierarchy.js` exposes read, list, set, and remove operations. All reads and writes are scoped by `guild_id`.
- Existing `/sysp` gained `supervisor-set`, `supervisor-remove`, and `supervisor-list` subcommands. Configuration is restricted to the server owner or a Discord Administrator through the existing `canConfigureSysPlus` policy; ADMIN+/SYS+ role membership alone is not enough.
- Moderation sanctions snapshot the supervisor ID into the moderation case details at action time. This preserves the chain of responsibility even if the hierarchy changes later.
- Moderation logs add a `Responsable hiérarchique` field and allow an explicit ping to that one validated supervisor. When none is configured, the log says `Responsable non configuré` and sends no supervisor ping.
- Sanction logs are routed to the existing PND Logs category resolver (`logs-sanctions`) and retain the legacy local moderation log destination for compatibility.
- The global slash-command count remains 100 because the new actions are subcommands under the existing `/sysp` root.

## Commands

- `/sysp supervisor-set membre:<user> responsable:<user>`
- `/sysp supervisor-remove membre:<user>`
- `/sysp supervisor-list`

Only the server owner or a Discord Administrator can manage these mappings. Both selected users must currently belong to the guild. The guild owner cannot be assigned a supervisor.

## Important boundaries

- This P1-B slice records the supervisor for sanctions issued through the existing bot moderation commands (`warn`, `mute`, `unmute`, `kick`, `ban`).
- It does not yet attribute manual sanctions performed outside the bot. That requires correlating Discord Audit Log entries with gateway events, and must report unknown actors rather than guess.
- PND Logs currently sends through the existing bot log-hub channel transport. A dedicated webhook lifecycle/branding pass remains part of the later PND Logs refactor.
- No production database, Discord guild, Oracle instance, or running bot has been modified.

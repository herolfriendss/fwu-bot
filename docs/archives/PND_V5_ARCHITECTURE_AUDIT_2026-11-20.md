# PND Assist V5 — architecture & command audit (20 Nov 2026)

## Changes in this work batch

- Added `bot/runtime-profiles.js`, defining the target command ownership for PND CORE, GUARD, VOICE and SOCIAL.
- Added profile validation tests and dedicated-token validation. The legacy single-bot startup remains the default; a dedicated profile cannot start without its own token and cannot reuse `DISCORD_TOKEN`.
- Added `bot/scripts/audit-command-surface.mjs` and `npm run audit:commands`.
- Added `docs/architecture/PND_MULTI_BOT_TARGET.md` with the migration order, security invariants and blockers.
- Added `docs/architecture/PND_COMMAND_SURFACE_AUDIT.md` and `docs/architecture/PND_COMMAND_PREFIX_AUDIT.md`.

## Verified

- Slash catalogue: 100 root commands, 0 duplicate names. The Discord root-command limit is currently fully used.
- Four target profiles have a documented ownership assignment for every catalogue command.
- DOG, MENOTTE, WAKEUP and WAOUF are assigned to CORE; temporary voice/music/radio commands are assigned to VOICE; moderation/security commands to GUARD; economy/social/games/tickets to SOCIAL.
- Targeted Node 24 test batch: 63 passed, 0 failed.
- JavaScript syntax check: all non-test `.js` files under `bot/` passed.

## Not complete / do not deploy yet

- The four-bot split is not activated. The current monolith starts shared schedulers and services; starting it four times would duplicate scheduled work. Route handlers, database ownership and jobs must be extracted before runtime splitting.
- Four dedicated Discord applications/tokens and staging guilds are still required. No secrets are included in this archive.
- Slash-to-prefix equivalence is not complete. Moderation and GuildGuard are still mainly interaction-driven; utility commands also need a dedicated prefix audit and tests.
- Discord Gateway, role hierarchy, ticket channel lifecycle, actual voice playback and VPS deployment were not tested in this environment.

# PND Assist V5 — Audit Patch 02

Date: 2026-11-19

## Changes in this patch

- Fixed `/verify moi`: it now launches the existing CAPTCHA challenge instead of calling the undefined `claimVerification` function.
- Hardened CAPTCHA completion: force-refreshes the member, role and bot member; rejects protected roles; verifies `ManageRoles` and role hierarchy; handles already-verified members cleanly.
- `/verify panel` now refuses to publish a non-functional panel when verification is disabled or the verified role is not configured.
- Added `/rank` and `=rank` for individual role assignment, reusing the existing SYS+/ADMIN+ authorization, permission and hierarchy checks. `/rankall` and `=rankall` remain owner-only and retain preview/confirmation/audit safeguards.
- Added `/wakeup` and `=wakeup` to move a member who is already in voice to a public voice destination. Actor and bot permissions, destination type/access and target voice state are checked.
- Hardened ticket creation: validates support role/category and bot permissions; cleans up the channel and marks the DB row failed if initialization cannot complete.
- Ticket closure now uses a conditional state transition and rejects duplicate close attempts.
- Hardened AI response delivery against upstream/network timeouts and Discord's 2,000-character message limit.
- Added catalogue tests for `/rank` and `/wakeup`, plus prefix parser coverage for `=wakeup`.
- Updated bot README with command usage and behavior.

## Protected scope

No SYS+ permission catalogue, permission assignment, SYS+ authorization policy, or SYS+ command layout was intentionally changed in this patch.

## Validation

- `node --check` passed for all modified JavaScript runtime files.
- 38 focused policy/runtime-independent tests passed (AI memory, PND Intelligence, rankall policy, ticket policy, voice permissions).
- Full Discord-dependent test execution remains blocked in this environment: the archive does not contain an installed `discord.js` package, npm cache is incomplete, network installation timed out, and this environment runs Node 22.16.0 while the project requires Node >=24.
- Root slash command catalogue contains 88 unique root commands by static catalogue scan, below Discord's 100-command cap.

## Deployment note

This is a source patch only. Do not deploy until dependencies are installed under Node 24 and the complete bot/web test suites pass. No VPS process, Discord registration, Supabase migration, or production database was modified by this patch.

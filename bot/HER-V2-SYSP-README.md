# Her? V2 — SYS+ Phase 2

## Bot commands
- `=sysp`: opens the SYS+ status panel for the configured SYS+ role, server owner and Discord administrators.
- `=sysp role @Role`: configures the per-server SYS+ role. Only the server owner or Discord Administrators may run this command.

The role is stored in `bot_settings.settings.sysPlus.roleId` in Supabase through the existing authenticated `/api/public/bot-sync` endpoint. The bot receives the role ID on its normal 60-second settings sync. The bot checks the immutable Discord role ID, never the role name. Missing configuration denies access to ordinary members.

## Apply
1. Deploy the updated website source (including `src/lib/bot-settings.ts` and `src/routes/api/public/bot-sync.ts`) to the existing Lovable site using your normal GitHub deployment path.
2. On Oracle, copy the updated `bot/` files into `/home/opc/her-v2-test/bot`, preserving `.env` and `data/`.
3. Run `npm test` / `node --test systems/sysplus/permissions.test.js`.
4. Test in a private Discord test server before production.

## Important
The role configuration POST is authenticated with BOT_SYNC_SECRET. It is only invoked by a Discord command that checks the server owner / Administrator permission first. Keep BOT_SYNC_SECRET private and rotate it if exposed.
This phase delivers the permission foundation and a text-based SYS+ control panel. Other Her? V2 modules are not yet implemented.

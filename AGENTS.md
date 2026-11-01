<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Every Discord server function must call requireOwner() first (owner-only password session cookie); server functions are public endpoints otherwise.
- Server-only helpers (session, Discord gateway, AI calls) live in `src/lib/*.server.ts`; `*.functions.ts` and route files must not export them or import-protection breaks the client bundle.
- Streaming features (AI incident advisor) use a server route under `src/routes/api/` that checks `isOwner()` and dynamically imports `.server` modules inside the handler; server functions cannot stream NDJSON.
- Server analytics use a dedicated owner-protected server function and pure aggregation helpers; keep missing metrics null and label bounded audit samples so they cannot be mistaken for complete historical totals.
- Slash-command interactions live at `/api/public/discord-interactions`, verified by Discord's Ed25519 signature (public key auto-fetched from `oauth2/applications/@me`) instead of `requireOwner` — the caller is Discord, not a browser session. Commands are registered globally via `applications/{id}/commands`: guild-scoped command routes (`guilds/{id}/commands`) are rejected by the Discord gateway proxy, so never use them. Registration must merge with (never wipe) existing commands, since other tools may have registered their own.
- Register and modify commands individually via POST/PATCH, never bulk PUT, to preserve unrelated definitions and IDs; custom responses are stored in a server-only Cloud table, accessed only after the owner-cookie check or verified Discord signature.
- Native Discord server applications are not available to bots through the documented API; do not substitute pending guild members or use user tokens to simulate this workflow.
- The 24/7 bot is a standalone Node process in `bot/` hosted by the owner (Lovable cannot keep a Gateway connection alive); it pulls settings from `/api/public/bot-sync` with the BOT_SYNC_SECRET bearer, which also proxies AI replies so the AI key stays server-side.
- Prefix commands are guild-specific entries in bot settings, edited through dedicated owner-protected functions; general settings saves preserve them, and the Node bot uses a pure tested resolver before AI/keyword replies to enforce command permissions.
- Built-in voice commands run before custom replies and use independent guild voiceAccess role allowlists (null means legacy current-channel ManageChannels; empty means owner/admin only); recheck fresh member roles on each command and author-bound component interaction, including pv access for panel lock/unlock, to prevent bypasses. Persist Connect-only restoration snapshots on the VPS.
- Voice access is edited only through owner-protected admin functions in existing bot settings; unrelated settings/command saves preserve voiceAccess so stale forms cannot undo access changes. The Oracle process must run compatible code to enforce synchronized settings.
- Dashboard and configuration presentation share global semantic theme tokens and CSS motion primitives; respect reduced-motion preferences and keep Discord logic separate from visual changes.
- Bot monitoring uses authenticated periodic reports persisted as one bounded snapshot; accept only fixed event codes, never raw logs or message contents, to prevent credential leaks. Report age, not Discord REST availability, determines live presence.
- The /status interaction reads only connection state and process uptime from the authenticated bot snapshot after Discord signature verification; never use the website process uptime or expose monitoring events to Discord members.
- Installation downloads contain only public configuration and empty credential fields; connection functions return secret presence only, never stored secret values.
- The live status page renders client-side after its owner-protected loader, preventing heartbeat changes between SSR and hydration from producing mismatched live data.
- The public/downloads/bot-oracle.zip archive is a public source-only distribution; regenerate and inspect it whenever bot sources change, using an explicit allowlist, never including .env, data, repository metadata or dependencies. Updates preserve the VPS's existing configuration.

-- FWU: latest XP and activity snapshot per guild, sent every 15 minutes by the bot process
-- serving the fwu domain (POST /api/public/activity-snapshot). Display mirror only: the bot's
-- SQLite stays the source of truth, and the 30-day history lives inside the snapshot.
create table if not exists public.bot_activity_snapshots (
  guild_id text primary key,
  snapshot jsonb not null,
  captured_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.bot_activity_snapshots enable row level security;
-- No anon/authenticated policies: only the server (owner-gated reads, BOT_SYNC_SECRET writes,
-- opt-in public page) may access these rows.
revoke all on public.bot_activity_snapshots from anon, authenticated;
grant select, insert, update, delete on public.bot_activity_snapshots to service_role;

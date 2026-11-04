-- Her? V4: bounded, read-only mirror of the SQLite PND economy for the dashboard.
-- The Oracle bot remains the source of truth; these rows are display snapshots.
create table if not exists public.bot_economy_snapshots (
  guild_id text primary key,
  guild_name text,
  total_balance bigint not null default 0 check (total_balance >= 0),
  wallet_count integer not null default 0 check (wallet_count >= 0),
  ledger_count integer not null default 0 check (ledger_count >= 0),
  daily_claims integer not null default 0 check (daily_claims >= 0),
  active_games integer not null default 0 check (active_games >= 0),
  top_wallets jsonb not null default '[]'::jsonb,
  shop_items jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bot_economy_snapshots enable row level security;
-- No anon/authenticated policies: only the owner-gated server reads and the
-- BOT_SYNC_SECRET-authenticated bot write path may access these rows.
revoke all on public.bot_economy_snapshots from anon, authenticated;
grant select, insert, update, delete on public.bot_economy_snapshots to service_role;

-- Ensure the canonical per-guild bot settings table is present when deploying
-- through Supabase CLI. The original Drizzle migration also creates this table,
-- but it is not part of the Supabase migration chain in all V5 installations.
create table if not exists public.bot_settings (
  guild_id text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bot_settings enable row level security;
grant all on table public.bot_settings to service_role;

comment on table public.bot_settings is
  'Canonical per-guild PND bot settings. Access is server-side through the service role.';

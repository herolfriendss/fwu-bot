-- Ensure the canonical per-guild bot settings table is present when deploying
-- through Supabase CLI. The original Drizzle migration also creates this table,
-- but it is not part of the Supabase migration chain in all V5 installations.
create table if not exists public.bot_settings (
  guild_id text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bot_settings enable row level security;

-- The dashboard and bot server use the service role; browser roles must never
-- receive table privileges, even if a future RLS policy is accidentally added.
revoke all on table public.bot_settings from public, anon, authenticated;
-- The server performs reads and upserts only. It does not need TRUNCATE,
-- REFERENCES, TRIGGER or table DELETE privileges.
revoke all on table public.bot_settings from service_role;
grant select, insert, update on table public.bot_settings to service_role;

comment on table public.bot_settings is
  'Canonical per-guild PND bot settings. Access is server-side through the service role.';

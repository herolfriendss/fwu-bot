-- Her? V2: role-based SYS+ configuration is stored inside bot_settings.settings.sysPlus.
-- This migration adds an append-only audit table for future SYS+ actions.
create table if not exists public.sysplus_audit_log (
  id bigint generated always as identity primary key,
  guild_id text not null,
  actor_id text not null,
  action text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sysplus_audit_guild_created_idx
  on public.sysplus_audit_log (guild_id, created_at desc);
alter table public.sysplus_audit_log enable row level security;
-- No anon/authenticated policies: writes must use trusted server-side service credentials.

-- AUTHORITY dans la console (/console/) : miroir des dérogations envoyé par SUCK ME toutes les
-- minutes (POST /api/public/authority-sync, secret BOT_SYNC_SECRET) et décisions de l'OWNER
-- déposées par la console, appliquées par le bot avec les mêmes contrôles que sur Discord
-- (bot/authority.js : OWNER seul, nonce à usage unique, signature). Le registre de référence
-- reste le SQLite du VPS ; ces tables ne donnent jamais une dérogation par elles-mêmes.
create table if not exists public.bot_authority_snapshots (
  guild_id text primary key,
  snapshot jsonb not null,
  captured_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_authority_decisions (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  number integer not null,
  action text not null check (action in ('approve', 'refuse', 'suspend', 'resume', 'revoke', 'extend')),
  nonce text,
  duration_ms bigint,
  status text not null default 'pending' check (status in ('pending', 'applied', 'refused')),
  result text,
  requested_by text,
  requested_at timestamptz not null default now(),
  applied_at timestamptz
);
create unique index if not exists bot_authority_decisions_one_pending
  on public.bot_authority_decisions (guild_id, number) where status = 'pending';
create index if not exists bot_authority_decisions_recent on public.bot_authority_decisions (requested_at desc);

alter table public.bot_authority_snapshots enable row level security;
alter table public.bot_authority_decisions enable row level security;
revoke all on public.bot_authority_snapshots from anon, authenticated;
revoke all on public.bot_authority_decisions from anon, authenticated;
grant select, insert, update, delete on public.bot_authority_snapshots to service_role;
grant select, insert, update, delete on public.bot_authority_decisions to service_role;

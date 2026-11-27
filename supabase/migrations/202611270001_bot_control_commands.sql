-- FWU V2 : ordres envoyés par la console du site aux bots (redémarrage individuel).
-- Le site dépose un ordre ; le bot concerné le reçoit dans la réponse de son rapport de statut
-- (POST /api/public/bot-status, toutes les 20 s, authentifié par BOT_SYNC_SECRET), se ferme proprement
-- et PM2 le relance. Aucun accès SSH ni terminal. Seule action autorisée : « restart ».
create table if not exists public.bot_control_commands (
  id uuid primary key default gen_random_uuid(),
  profile text not null check (profile in ('fwu', 'guard', 'fdpdlavoc', 'suckme', 'fisc', 'investplus')),
  action text not null default 'restart' check (action = 'restart'),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'expired')),
  requested_at timestamptz not null default now(),
  requested_by text,
  delivered_at timestamptz
);

-- Un seul ordre en attente par bot : empêche les doubles clics et les ordres empilés.
create unique index if not exists bot_control_commands_one_pending_per_bot
  on public.bot_control_commands (profile) where status = 'pending';
create index if not exists bot_control_commands_recent on public.bot_control_commands (requested_at desc);

alter table public.bot_control_commands enable row level security;
-- Aucune politique anon/authenticated : seul le serveur du site (propriétaire authentifié pour écrire,
-- BOT_SYNC_SECRET pour livrer l'ordre au bot) lit et écrit ces lignes.
revoke all on public.bot_control_commands from anon, authenticated;
grant select, insert, update on public.bot_control_commands to service_role;

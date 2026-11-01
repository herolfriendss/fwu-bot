-- Her? V3: replay protection for signed Discord interaction requests.
create table if not exists public.discord_interaction_receipts (
  interaction_id text primary key,
  created_at timestamptz not null default now()
);

alter table public.discord_interaction_receipts enable row level security;
revoke all on public.discord_interaction_receipts from anon, authenticated;
grant insert, delete on public.discord_interaction_receipts to service_role;

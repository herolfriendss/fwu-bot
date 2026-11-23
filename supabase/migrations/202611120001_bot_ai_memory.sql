-- Her? V5: optional, bounded conversational memory for the Discord AI assistant.
-- Records are only written when ai.memoryEnabled is enabled in that guild's settings.
create table if not exists public.bot_ai_memory (
  id bigint generated always as identity primary key,
  guild_id text not null,
  user_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 1800),
  created_at timestamptz not null default now()
);

create index if not exists bot_ai_memory_scope_created_idx
  on public.bot_ai_memory (guild_id, user_id, created_at desc);
create index if not exists bot_ai_memory_expiry_idx
  on public.bot_ai_memory (created_at);

alter table public.bot_ai_memory enable row level security;
revoke all on public.bot_ai_memory from anon, authenticated;
grant select, insert, delete on public.bot_ai_memory to service_role;
grant usage, select on sequence public.bot_ai_memory_id_seq to service_role;

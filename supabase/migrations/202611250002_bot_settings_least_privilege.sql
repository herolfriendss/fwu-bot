-- FWU security hardening: narrow service-role grants for canonical bot settings.
-- Additive migration: do not rewrite the original table-creation migration.
alter table public.bot_settings enable row level security;

-- Browser roles must never access this table directly, even if a future
-- RLS policy is accidentally introduced.
revoke all on table public.bot_settings from public, anon, authenticated;

-- The dashboard and bot server read and upsert settings; they do not need
-- DELETE, TRUNCATE, REFERENCES or TRIGGER privileges on the settings table.
revoke all on table public.bot_settings from service_role;
grant select, insert, update on table public.bot_settings to service_role;

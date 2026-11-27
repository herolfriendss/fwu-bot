-- Alerte de panne indépendante des bots et du site : Supabase vérifie toutes les 2 min
-- l'état envoyé par les bots et poste sur un webhook Discord (pg_cron + pg_net).
-- Fonctionne même si tous les bots et le site sont tombés.
-- Activation : insérer l'URL du webhook (Discord → salon staff → Intégrations → Webhooks) :
--   update public.ops_alert_settings set webhook_url = '<url>', enabled = true where id = 1;

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.ops_alert_settings (
  id smallint primary key default 1 check (id = 1),
  webhook_url text check (webhook_url is null or webhook_url ~ '^https://(discord\.com|discordapp\.com)/api/webhooks/'),
  enabled boolean not null default false,
  down_after interval not null default interval '5 minutes'
);
insert into public.ops_alert_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.ops_bot_alert_state (
  id text primary key,
  down_since timestamptz,
  alerted boolean not null default false
);

-- Secret (URL du webhook) : aucune politique, donc aucun accès par les clés anon/authenticated.
alter table public.ops_alert_settings enable row level security;
alter table public.ops_bot_alert_state enable row level security;
revoke all on public.ops_alert_settings from anon, authenticated;
revoke all on public.ops_bot_alert_state from anon, authenticated;

create or replace function public.check_bot_outages()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg public.ops_alert_settings;
  bot record;
  st public.ops_bot_alert_state;
  is_down boolean;
  names jsonb := '{"primary":"Bot principal","guard":"GUARD","fdpdlavoc":"FDPDLAVOC","suckme":"SUCK ME","fisc":"LE FISC","investplus":"Invest +"}';
  label text;
  msg text;
  protection_down boolean;
begin
  select * into cfg from public.ops_alert_settings where id = 1;
  if cfg is null or not cfg.enabled or cfg.webhook_url is null then return; end if;

  for bot in select id, connected, last_seen from public.bot_runtime_status loop
    is_down := not (bot.connected and bot.last_seen > now() - interval '3 minutes');
    select * into st from public.ops_bot_alert_state where id = bot.id;
    if st is null then
      insert into public.ops_bot_alert_state (id) values (bot.id) returning * into st;
    end if;
    label := coalesce(names ->> bot.id, bot.id);
    msg := null;
    if is_down then
      if st.down_since is null then
        update public.ops_bot_alert_state set down_since = now(), alerted = false where id = bot.id;
      elsif not st.alerted and st.down_since < now() - cfg.down_after then
        msg := '🔴 **' || label || '** ne répond plus depuis ' || to_char(st.down_since at time zone 'Europe/Paris', 'HH24:MI') || '. Sur le VPS : `pm2 logs` puis `pm2 restart`.';
        update public.ops_bot_alert_state set alerted = true where id = bot.id;
      end if;
    elsif st.down_since is not null then
      if st.alerted then msg := '🟢 **' || label || '** est revenu.'; end if;
      update public.ops_bot_alert_state set down_since = null, alerted = false where id = bot.id;
    end if;
    if msg is not null then
      perform net.http_post(url := cfg.webhook_url, body := jsonb_build_object('content', msg, 'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)), headers := '{"Content-Type":"application/json"}'::jsonb);
    end if;
  end loop;

  -- Plus aucune protection : GUARD et le bot principal (son relais) tombés en même temps.
  select bool_and(not (connected and last_seen > now() - interval '3 minutes')) into protection_down
    from public.bot_runtime_status where id in ('guard', 'primary');
  if protection_down then
    select * into st from public.ops_bot_alert_state where id = '_protection';
    if st is null then insert into public.ops_bot_alert_state (id, down_since) values ('_protection', now()) returning * into st; end if;
    if st.down_since is null then update public.ops_bot_alert_state set down_since = now() where id = '_protection';
    elsif not st.alerted and st.down_since < now() - interval '3 minutes' then
      perform net.http_post(url := cfg.webhook_url, body := jsonb_build_object('content', '🚨 Plus aucun bot de protection en ligne (GUARD et bot principal). Le serveur n''est protégé que par l''AutoMod de Discord.', 'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)), headers := '{"Content-Type":"application/json"}'::jsonb);
      update public.ops_bot_alert_state set alerted = true where id = '_protection';
    end if;
  else
    update public.ops_bot_alert_state set down_since = null, alerted = false where id = '_protection';
  end if;
end;
$$;

revoke all on function public.check_bot_outages() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'check-bot-outages';
select cron.schedule('check-bot-outages', '*/2 * * * *', 'select public.check_bot_outages()');

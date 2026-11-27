-- Tables réservées au serveur (clé service_role, qui ignore RLS) : règle explicite qui refuse
-- tout accès aux clés anon et authenticated. Ne change rien au fonctionnement, rend l'intention lisible.
do $$
declare t text;
begin
  foreach t in array array['bot_activity_snapshots','bot_ai_memory','bot_control_commands','bot_economy_snapshots','bot_settings','discord_interaction_receipts','ops_alert_settings','ops_bot_alert_state','sysplus_audit_log'] loop
    execute format('drop policy if exists "server only" on public.%I', t);
    execute format('create policy "server only" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

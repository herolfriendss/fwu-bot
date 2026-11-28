-- Même règle explicite que 202611270004 pour les tables de la console d'autorité : réservées au
-- serveur (clé service_role, qui ignore RLS), tout accès refusé aux clés anon et authenticated.
-- Ne change rien au fonctionnement (aucun droit n'est accordé à ces rôles), rend l'intention lisible.
do $$
declare t text;
begin
  foreach t in array array['bot_authority_snapshots','bot_authority_decisions'] loop
    execute format('drop policy if exists "server only" on public.%I', t);
    execute format('create policy "server only" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

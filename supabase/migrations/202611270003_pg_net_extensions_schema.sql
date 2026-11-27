-- pg_net rangé dans le schéma « extensions » (avertissement de sécurité Supabase).
-- Ses fonctions restent dans le schéma « net » : check_bot_outages() n'a pas besoin de changer.
drop extension if exists pg_net;
create extension if not exists pg_net with schema extensions;

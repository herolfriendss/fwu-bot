# PND Intelligence — configuration et dépannage

## Paramètres IA serveur

La clé IA doit rester exclusivement dans les variables d’environnement du dashboard, jamais dans `bot/.env` ni dans le code client.

- Avec Lovable Cloud : `LOVABLE_API_KEY` est requis. Le modèle par défaut est `openai/gpt-5.5`, répertorié pour la passerelle Lovable.
- Facultatif avec Vercel AI Gateway : `AI_GATEWAY_API_KEY`. Le modèle par défaut pour le chat devient `openai/gpt-6.2-sol` et pour le planificateur d’actions `openai/gpt-6.2-astra`.
- Surcharges facultatives : `PND_AI_MODEL` (les deux usages), `PND_AI_CHAT_MODEL` (chat uniquement), `PND_AI_ACTION_MODEL` (planificateur uniquement).

Ne configure pas `AI_GATEWAY_API_KEY` avec une clé Lovable : ce sont deux passerelles et deux URLs différentes. Si les deux clés sont présentes, Vercel AI Gateway est prioritaire.
La mémoire conversationnelle reste facultative : lorsqu’elle est désactivée, aucune ancienne conversation n’est lue ni transmise au modèle. Une indisponibilité de la table `bot_ai_memory` ne bloque pas la réponse IA ; elle désactive temporairement le contexte mémoire et est inscrite dans les logs du dashboard.

## Synchronisation des réglages SYS+

La sauvegarde utilise `POST /api/public/bot-sync` et la table Supabase `public.bot_settings`. La migration `supabase/migrations/202611200001_bot_settings_sync.sql` garantit la présence de cette table et les droits `service_role`. Il faut appliquer les migrations Supabase du projet avant le redéploiement du dashboard.

Le bot et le dashboard doivent avoir exactement la même valeur `BOT_SYNC_SECRET`. Dans `bot/.env`, `SITE_URL` doit être la racine HTTPS publique du dashboard, sans le suffixe `/api/public/bot-sync` (le bot l’ajoute lui-même).

## Diagnostic du retour Discord

La commande `/sysp config intelligence-channel` affiche maintenant une cause de synchronisation lisible :

- `401` : secrets `BOT_SYNC_SECRET` différents ou manquants ;
- `404` : route absente sur la version du dashboard déployée ;
- `400` : identifiants Discord rejetés ;
- `503` : lecture/écriture Supabase en échec ; consulter les logs serveur `[bot-settings]` et `[bot-sync]`.

Après avoir défini le salon, activer séparément `/sysp config intelligence-toggle etat:true`. L’activation ne peut pas être enregistrée sans salon dédié.

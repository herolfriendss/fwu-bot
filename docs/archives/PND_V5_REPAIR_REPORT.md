# PND Assist V5 — rapport de corrections

Date : 20 novembre 2026

## Corrections incluses

- La sauvegarde de la configuration PND Intelligence vérifie désormais explicitement la réponse du dashboard avant de modifier le cache local du bot. Les réponses HTTP et les erreurs réseau sont distinguées, et les messages Discord indiquent les causes probables au lieu d'afficher uniquement une erreur générique.
- La route `/api/public/bot-sync` confirme que `intelligenceEnabled` et `intelligenceChannelId` ont bien été conservés par le mécanisme de sanitisation avant d'annoncer la réussite.
- Les erreurs Supabase de lecture et d'écriture de `bot_settings` sont journalisées avec leur code et les détails utiles côté serveur.
- Ajout d'une migration Supabase idempotente pour `public.bot_settings`, avec RLS activée et droits attribués à `service_role` : `supabase/migrations/202611200001_bot_settings_sync.sql`.
- PND Intelligence choisit désormais une passerelle et un modèle compatibles avec la clé serveur réellement présente. Lovable utilise `LOVABLE_API_KEY` et `openai/gpt-5.5` par défaut ; Vercel AI Gateway utilise `AI_GATEWAY_API_KEY`, `openai/gpt-6.2-sol` pour le chat et `openai/gpt-6.2-astra` pour le planificateur.
- La mémoire IA ne bloque plus une réponse lorsqu'elle est désactivée ou que son stockage est temporairement indisponible. Lorsque la mémoire est désactivée, l'ancien historique n'est jamais lu ni transmis au modèle ; sa suppression en base est tentée et toute erreur est journalisée.
- Les tests Marketplace ont été réalignés sur la règle déjà présente dans le code : les opérations réservées au propriétaire n'acceptent que l'identifiant Owner unique, et non une liste Owner+Cofondateurs. Aucun privilège Owner n'a été accordé aux Cofondateurs.

## Vérifications exécutées

- Node.js utilisé pour les contrôles : `v24.11.1`.
- Vérification syntaxique de 205 fichiers JavaScript du bot : 205 réussis, 0 échec.
- Vérification syntaxique TypeScript par transpilation des fichiers serveur modifiés : réussie.
- Batterie ciblée SYS+, PND Intelligence, politique Owner et Marketplace : 45 tests réussis, 0 échec.
- Suite complète du bot : 332 tests détectés, 309 réussis. Les 23 fichiers restants ne démarrent pas dans cet environnement, car le module `discord.js` n'y est pas installé. L'installation npm est actuellement bloquée par l'absence de résolution DNS vers le registre ; ces 23 cas ne sont donc pas déclarés réussis.

## Étapes nécessaires avant que la correction soit active en production

1. Appliquer la migration Supabase `202611200001_bot_settings_sync.sql` avec les autres migrations du projet.
2. Redéployer le dashboard afin que la route de synchronisation et le moteur IA corrigés soient en production.
3. Vérifier côté serveur que `BOT_SYNC_SECRET` est identique entre le dashboard et `bot/.env`, et que `SITE_URL` désigne la racine HTTPS du dashboard.
4. Vérifier qu'une seule clé IA valide est configurée côté dashboard : `LOVABLE_API_KEY` ou `AI_GATEWAY_API_KEY`.
5. Déployer le dossier bot corrigé, installer ses dépendances avec Node.js 24, puis redémarrer le processus PM2.

Aucun accès au VPS, à Supabase ou au serveur Discord n'a été utilisé pendant cette correction. La réussite en production ne peut donc être confirmée qu'après déploiement et essai de la commande Discord.

Les archives distribuées n'embarquent volontairement ni fichiers `.env`, ni `node_modules`, ni base SQLite `bot/data/economy.sqlite` : sauvegarde et conserve ces éléments de production avant tout remplacement de dossier.

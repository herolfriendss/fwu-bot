# PND Assist V5 — reprise et réparations

Date : 20 novembre 2026

## Périmètre traité

Cette copie de travail reprend `PND_Assist_V5_PRET_POUR_TESTS_DEMAIN.zip` et les corrections SYS+/PND Intelligence déjà présentes dans la copie d'audit. Les fichiers source restent séparés de la configuration de production : aucun secret, fichier `.env`, état SQLite local ou dépendance installée n'est inclus dans les archives livrées.

## Catalogue slash

- Catalogue d'origine : 101 commandes racines.
- Catalogue après nettoyage : 99 commandes racines, sous la limite Discord de 100.
- `/addrole` a été retirée du catalogue slash car son action était identique à `/rank`.
- `/rank` reste la commande slash d'attribution individuelle.
- L'alias historique `=addrole` reste accepté, tout comme `=rank` et `=removerole`.
- Les actions de dépôt et de gestion du recrutement sont réunies sous `/candidature` avec dix sous-commandes : `deposer`, `liste`, `questions`, `voir`, `review`, `assign`, `entretien`, `entretiens`, `evaluation`, `annuler-entretien`.
- Les préfixes `=candidature` et `=candidatures` sont conservés.
- DOG, UNDOG, DOGINFO, MENOTTE, UNMENOTTE, MENOTTEINFO, WAKEUP, WOUAF, GIVEAWAY, ACADEMY et AWARD restent des commandes distinctes.
- Les commandes PND EVENT, EVENT, ACADEMY, AWARD et STORY ne sont pas fusionnées artificiellement.

## SYS+ et PND Intelligence

- La sauvegarde `intelligence-channel` conserve l'ordre sûr : la configuration du cache bot n'est mise à jour qu'après confirmation de persistance côté dashboard.
- Le diagnostic de synchronisation différencie désormais l'absence de `public.bot_settings`, les droits `service_role`, l'absence des secrets Supabase serveur et les erreurs générales de persistance.
- Les réponses d'erreur PND Intelligence distinguent clé IA absente, crédits épuisés, limitation de débit, modèle indisponible et réponse vide, sans exposer de secret ni de détails internes.
- Les appels IA évitent d'envoyer un champ additionnel `reasoning.encrypted_content` qui n'est pas nécessaire pour les requêtes sans reprise d'état de raisonnement.
- Les politiques de permissions SYS+ et la séparation Owner / Cofondateurs n'ont pas été élargies par ces changements.
- La migration `supabase/migrations/202611200001_bot_settings_sync.sql` crée la table canonique `public.bot_settings` et accorde l'accès à `service_role`.

## Vérifications réalisées

- Runtime de contrôle : Node.js 24.11.1 (runtime local de cette session ; le Node système n'a pas été remplacé).
- Syntaxe JavaScript : 207 fichiers du bot validés par `node --check`.
- Syntaxe TypeScript/TSX : 143 fichiers transpilés sans diagnostic de syntaxe (ce contrôle ne remplace pas un contrôle complet des types).
- Manifests JSON : 3 fichiers de configuration lus avec succès.
- Catalogue slash : 99 racines, aucune racine dupliquée, options et descriptions dans les limites Discord, dix sous-commandes candidature, alias préfixés vérifiés.
- Tests ciblés IA / mémoire / SYS+ Intelligence / synchronisation : 32 réussis, 0 échec.
- Suite complète du bot : 335 tests, 312 réussis et 23 échecs de chargement. Les 23 fichiers en échec ne démarrent pas car le paquet `discord.js` est absent (`ERR_MODULE_NOT_FOUND`). Aucun de ces 23 échecs n'a été confirmé comme un échec d'assertion métier.

## Points qui restent dépendants de l'environnement externe

Les dépendances npm du bot et du dashboard n'ont pas pu être installées dans ce conteneur : `registry.npmjs.org` ne se résout pas par DNS et le cache npm local ne contient pas `discord.js`. Le build Vite, ESLint et les tests qui importent Discord.js ne peuvent donc pas être certifiés ici.

Avant de retester la sauvegarde SYS+ Intelligence en production :

1. Appliquer `supabase/migrations/202611200001_bot_settings_sync.sql` au projet Supabase utilisé par le dashboard.
2. Vérifier côté serveur dashboard `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`.
3. Vérifier que `BOT_SYNC_SECRET` est identique dans le dashboard et dans `bot/.env`.
4. Vérifier que `SITE_URL` dans `bot/.env` est l'URL racine HTTPS du dashboard, sans `/api/public/bot-sync` ajouté à la fin.
5. Pour l'IA, configurer côté serveur dashboard `LOVABLE_API_KEY` ou `AI_GATEWAY_API_KEY`. Le code choisit Vercel si les deux sont présents.

## Déploiement

Aucun déploiement n'a été effectué sur Oracle Cloud, Supabase ou Discord. Les archives fournies sont des livrables de code source à tester avant remplacement de la production.

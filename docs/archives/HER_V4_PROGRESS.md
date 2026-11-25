# Her? V4 — suivi de développement

> Document de travail local. Aucune base distante n’a été modifiée par ces travaux.
> Dernière mise à jour : 2026-11-04.

## Référence

Aucun fichier « cahier des charges » n’était présent dans le dépôt. Le périmètre V4
retenu est donc l’ordre de priorité fourni par le propriétaire :

1. Sécurité générale, GuildGuard et isolation des serveurs
2. Modération avancée et vérification
3. Économie PND V2
4. Social, profils et réputation
5. Collection de cartes et échanges
6. Vocal V2
7. Jeux et événements
8. Staff, tickets et SYS+ V2
9. Automatisation
10. Dashboard complet

## Audit initial (commit bb3db619)

### Terminé et testé avant cette phase

- Commandes slash V4 partagées entre dashboard et bot, enregistrement fusionné.
- Passerelle bot : commandes cœur, dispatch V4, commandes personnalisées.
- Économie PND de base : soldes, daily, transferts, boutique de rôles, classement,
  roulette, blackjack, journal et récupération après redémarrage.
- Instantané économique borné vers Supabase et page `/economie`.
- DOG : laisse, surnom, rappel vocal, réconciliation.
- Vocal V1 : `access`, `unaccess`, `panel`, `pv`, restauration Connect.
- Musique YouTube et radio PartyNextDoor.
- SYS+ V1 : rôle Perm SYS+, panneau.
- Modération de base : filtre de mots, anti-spam, timeout automatique.
- Accueil, mots-clés, IA sur mention, commandes préfixées personnalisées.
- Dashboard : profil, analyses, salons, rôles/membres, modération manuelle,
  annonces, commandes, adhésions, statut, installation.
- Tests au moment de l’audit : 15 fichiers / 82 tests.

### Partiel avant cette phase

- Isolation multi-serveurs : données SQLite déjà clés par `guild_id`, mais aucune
  politique d’admission, aucun anti-raid ni vue de contrôle global.
- Modération : actions manuelles via le dashboard, sans avertissements persistants,
  vérification par bouton ni journal de modération côté bot.
- Économie : pas de banque, de travail, de vol, d’historique consultable ni de loterie.
- SYS+ : panneau statique, pas d’audit local ni de modules staff/tickets.
- Vocal : pas de salons temporaires à la demande.

### Absent avant cette phase

- GuildGuard (allowlist, anti-raid, âge de compte, quarantaine).
- Vérification par rôle et panneau de vérification.
- Profils sociaux, biographie, réputation.
- Collection de cartes, packs et échanges.
- Vocal V2 (hub, salons temporaires, limite, propriétaire).
- Jeux et événements (dés, pile ou face, trivia, giveaways).
- Tickets staff.
- Automatisation (rôle automatique, messages planifiés, MP de bienvenue).
- Dashboard des modules V4.

### Migration

- Nouvelles tables SQLite locales uniquement, créées par `bot/database.js` avec
  `CREATE TABLE IF NOT EXISTS` : avertissements, profils, réputation, cartes,
  échanges, vocal temporaire, tickets, giveaways, événements, planifications,
  audit SYS+.
- Deux migrations additives sur la base locale existante, sans suppression :
  `wallets.bank` et `events.channel_id` / `events.notified`.
- Extension de `bot_settings.settings` (JSON) pour les nouveaux modules, avec
  valeurs par défaut et bornage dans `sanitizeSettings`. Aucune migration Supabase
  nouvelle n’est nécessaire pour ces modules.

## Journal d’implémentation

Un module n’est coché « terminé » que lorsque ses tests passent, que ses commandes
slash sont routées et que les fonctions existantes restent vertes.

- [x] Phase 1 — GuildGuard / isolation
- [x] Phase 2 — Modération avancée / vérification
- [x] Phase 3 — Économie PND V2
- [x] Phase 4 — Social / réputation
- [x] Phase 5 — Cartes / échanges
- [x] Phase 6 — Vocal V2
- [x] Phase 7 — Jeux / événements
- [x] Phase 8 — Tickets / SYS+ V2
- [x] Phase 9 — Automatisation
- [x] Phase 10 — Dashboard modules

### Phase 1 — Sécurité, GuildGuard et isolation

- Politiques pures : allowlist globale, âge de compte, détection de rafale,
  décision `allow` / `log` / `kick` / `quarantine`, confinement.
- Handler d’arrivée : anti-raid, action configurée, journal, retour après
  redémarrage sans état persistant nécessaire.
- `guildCreate` : quitte immédiatement un serveur absent de `V4_ALLOWED_GUILD_IDS`
  quand l’allowlist est définie. Vide = accepte tous les serveurs, mais les données
  restent isolées par `guild_id`.
- Commande `/guildguard status|enable|disable|account-age|raid|quarantine|log|lockdown`.
- Réglages exposés dans le dashboard « Modules V4 ».
- Fichiers : `bot/guild-guard.js`, `bot/guild-guard-policy.js`,
  `bot/guild-guard-commands.js`, `src/test/guild-guard.test.ts`.
- Testé : `src/test/guild-guard.test.ts` (7 tests).

### Phase 2 — Modération avancée et vérification

- `/warn`, `/warnings`, `/mute`, `/unmute`, `/kick`, `/ban`, `/purge`, `/slowmode`,
  `/lock`, `/unlock`, `/verify moi|panel`.
- Avertissements SQLite avec expiration, journal de modération, MP optionnel,
  raisons bornées, vérification de hiérarchie et protection du propriétaire.
- Bouton `verify:claim` avec contrôle d’âge de compte et vérification du rôle.
- Fichiers : `bot/moderation.js`, `bot/moderation-policy.js`,
  `src/test/moderation.test.ts`.
- Testé : `src/test/moderation.test.ts` (6 tests).

### Phase 3 — Économie PND V2

- `/bank solde|deposit|withdraw`, `/work`, `/history`, `/rob`, `/loterie info|buy|draw`.
- Banque séparée du portefeuille, cooldowns SQLite, journal des mouvements,
  vol risqué avec restitution en cas d’échec, loterie plafonnée à 10 tickets.
- Helpers partagés `grantPnd` / `pndBalance` pour les autres modules.
- L’instantané économique inclut désormais la banque.
- Fichiers : `bot/economy.js`, `bot/economy-policy.js`,
  `src/test/economy-v2.test.ts`.
- Testé : `src/test/economy-v2.test.ts` (4 tests) + tests économie existants.

### Phase 4 — Social, profils et réputation

- `/profil`, `/bio`, `/rep`, `/toprep`, `/color`.
- Tables `profiles` et `reputation`, bio bornée à 280 caractères, couleur hexadécimale,
  badges de réputation, cooldown de 24 h par destinataire.
- Le profil agrège réputation, PND (portefeuille + banque), cartes et date d’arrivée.
- Fichiers : `bot/social.js`, `bot/social-policy.js`, `src/test/social.test.ts`.
- Testé : `src/test/social.test.ts` (5 tests).

### Phase 5 — Collection de cartes et échanges

- Catalogue de 20 cartes et 5 raretés pondérées.
- `/cards`, `/card`, `/pack` (250 PND), `/trade proposer|accepter|annuler|liste`.
- Tables `user_cards` et `card_trades`, échanges atomiques avec expiration de 10 min.
- Contrôle de possession avant échange et valeur de collection calculée.
- Fichiers : `bot/cards.js`, `bot/cards-data.js`, `bot/cards-policy.js`,
  `src/test/cards.test.ts`.
- Testé : `src/test/cards.test.ts` (4 tests).

### Phase 6 — Vocal V2

- Hub « rejoindre pour créer » : salon personnel créé à l’arrivée dans le hub,
  suppression automatique quand il devient vide.
- `/voc panel|limit|name|claim|lock|unlock|delete`.
- Table `temp_voice`, propriétaire et serveur enregistrés, permissions du créateur,
  du staff et du bot, nettoyage lors de la suppression du salon ou du serveur.
- Fichiers : `bot/voice-v2.js`, `bot/voice-v2-policy.js`,
  `src/test/voice-v2.test.ts`.
- Testé : `src/test/voice-v2.test.ts` (4 tests).

### Phase 7 — Jeux et événements

- `/dice`, `/coinflip`, `/trivia`, `/giveaway start|end|list`, `/event creer|liste|supprimer`.
- Dés bornés, mise PND plafonnée, trivia à boutons avec récompense unique,
  giveaways avec bouton de participation et tirage sans doublon, événements avec
  rappel automatique dans leur salon.
- Boucle de fin des giveaways et de rappel des événements toutes les 30 secondes.
- Tables `giveaways`, `giveaway_entries`, `events` (colonnes additives
  `channel_id` / `notified`).
- Fichiers : `bot/games.js`, `bot/games-policy.js`, `src/test/games.test.ts`.
- Testé : `src/test/games.test.ts` (5 tests).

### Phase 8 — Staff, tickets et SYS+ V2

- `/ticket panel|close|add|remove|list`, boutons `ticket:open`, `ticket:claim`,
  `ticket:close`.
- Salons privés par ticket, limite de tickets ouverts par membre, rôle support,
  journal, prise en charge, suppression et cohérence si le salon est supprimé.
- Audit local `sysplus_audit` pour les actions de rôle, tickets et staff ;
  `/sysp audit` et `=sysp audit` affichent les dix dernières actions.
- Fichiers : `bot/tickets.js`, `bot/tickets-policy.js`,
  `bot/systems/sysplus/audit.js`, `src/test/tickets.test.ts`.
- Testé : `src/test/tickets.test.ts` (4 tests).

### Phase 9 — Automatisation

- `/automation status|autorole-add|autorole-remove|autorole-list|welcome|schedule-add|schedule-remove|schedule-list`
  et commandes préfixées `=automation`.
- Rôles automatiques à l’arrivée (sous le rôle du bot uniquement), MP de bienvenue
  avec `{user}` / `{server}`, messages planifiés récurrents (minimum 5 minutes).
- Boucle d’envoi toutes les 60 secondes, table `automation_messages`.
- Fichiers : `bot/automation.js`, `bot/automation-policy.js`,
  `src/test/automation.test.ts`.
- Testé : `src/test/automation.test.ts` (4 tests).

### Phase 10 — Dashboard des modules V4

- Nouvel onglet « Modules V4 » dans `/configuration`, protégé par `requireOwner()`
  via les fonctions serveur existantes `getBotSettings` / `saveBotSettings`.
- Configuration complète de GuildGuard, modération/vérification, tickets, vocal
  temporaire et automatisation ; mêmes réglages que les commandes Discord.
- Sélecteurs de salons, catégories et rôles, champs bornés, sauvegarde unique.
- Les messages planifiés restent gérés par `/automation schedule` (stockage local
  du VPS, non exposé au navigateur).
- Fichiers : `src/components/V4ModulesPanel.tsx`, `src/routes/configuration.tsx`.
- Vérifié par `tsc --noEmit`, la suite complète et `npm run build`.

## Vérifications finales

- `npx tsc --noEmit` : aucun diagnostic.
- `npx vitest run` : **24 fichiers / 128 tests réussis**.
- `npm run build` : build Nitro réussi.
- `python3 scripts/package-bot.py` : archive `public/downloads/bot-oracle.zip` régénérée.
  L’allowlist contient les nouveaux modules et aucun `.env`, `data/`, secret,
  métadonnée de dépôt ou dépendance.
- Les tests ciblés de chaque phase ont été exécutés avant la suite complète.

## Limites et points de vigilance

- Les catégories `/aide` sont à **10**, la limite pratique des embeds Discord.
  Toute nouvelle catégorie devra fusionner avec une catégorie existante.
- L’allowlist `V4_ALLOWED_GUILD_IDS` est optionnelle : vide, le bot accepte tous
  les serveurs, mais chaque lecture SQLite et chaque réglage filtrent `guild_id`.
- Les tickets, cartes, événements, giveaways et messages planifiés vivent dans
  `bot/data/economy.sqlite` sur le VPS. Le dashboard configure les réglages mais
  ne lit pas cette base locale.
- Aucune migration Supabase, aucun déploiement Oracle, aucune suppression de
  données et aucun commit n’ont été effectués pendant cette phase.

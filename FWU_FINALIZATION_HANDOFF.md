# FWU — reprise de la finalisation (28/11/2026)

Branche de travail : `claude/fwu-finalization-c4alv9`. D'autres sessions travaillent en parallèle sur `main` et sur
leurs propres branches : toujours `git fetch` avant de reprendre, ne jamais pousser sur leurs branches, et comparer
une PR au `main` actuel (pas à sa base) avant de la fusionner : plusieurs doublons ont déjà été ouverts.

## Fusionné

| PR | Contenu |
| --- | --- |
| #119 | Mise à jour automatique à 08:00 (heure de Paris). |
| #128 | Un seul contrôle par jour même après redémarrage, rattrapage limité à 4 h, échecs journalisés, bots inchangés non redémarrés ; lot de dépendances (remplace dependabot #106–#118). |
| #132 | Bouton de maintenance globale acquitté avant l'annonce ; assistant IA : 20 questions/min par serveur, chiffres non pris pour des commandes. |
| #133 | Page `/knowledge permissions` : un seul OWNER technique. |
| #135 | Test de fumée de toutes les commandes en CI (limites Discord, membre sans rôle) ; réglage « Expiration des avertissements » enfin appliqué ; fonction serveur d'écrasement complet retirée ; scripts shellcheck en CI, message de l'installateur corrigé, rétention optionnelle des anciennes versions. |

Fermée comme doublon : #134 (même correction que #132). #127 remplacée par #130.

## Vérifié

- Node 24.22.3 : tests du bot (0 échec), vitest (297), tsc, eslint (0 erreur), build, `audit:commands`,
  `audit:replies`, smoke (4 908 exécutions, 0 anomalie), shellcheck sur les 22 scripts, paquets des 5 bots et
  `public/downloads/bot-oracle.zip` (aucun `.env`, base, dépendance ni vrai jeton), `npm audit` (0 vulnérabilité).
- Sécurité : server functions toutes derrière `requireOwner` (sauf `logout`), routes publiques en bearer à temps
  constant, OAuth PKCE à usage unique, un seul OWNER, leases liés à la connexion Discord, RLS « refus total » pour
  `anon`/`authenticated` sur toutes les tables de production, aucune alerte de sécurité Supabase.

## Actions manuelles (OWNER)

1. ~~Migrations Supabase~~ : faites le 28/11 avec l'accord de l'OWNER. `202611250002_bot_settings_least_privilege`
   (`bot_settings` : plus aucun droit pour `anon`/`authenticated`, `service_role` limité à SELECT/INSERT/UPDATE),
   `202611280001_bot_authority_console` (tables créées, RLS) et `202611280002_authority_server_only_policies`
   (règle « server only » explicite). Aucune alerte de sécurité Supabase ensuite.
   Si la mise à jour automatique s'arrête une fois en les citant (version installée plus ancienne que ces
   fichiers), c'est normal : elles sont appliquées, lancer `/maj lancer` (confirmation manuelle).
2. ~~Disque du VPS~~ : `FWU_KEEP_PREVIOUS` vaut 3 par défaut depuis le 28/11 (décision OWNER) ; `0` garde tout.
3. **Recette en staging** (`RECETTE_STAGING.md`) : `/maj lancer` puis « paquet inchangé » dans `maj.log` ;
   boutons de `/stabilite etat` ; `/ia question` (refus d'un token, limites 3/min et 20/min par serveur) ;
   `/warn` sans option `expire` (expiration à 90 jours ou selon le réglage).

## Prochaine tâche précise

Aucune tâche de code ouverte de cette session. Reprendre par les actions manuelles ci-dessus, puis relire les
nouvelles PR des autres sessions contre le `main` actuel.

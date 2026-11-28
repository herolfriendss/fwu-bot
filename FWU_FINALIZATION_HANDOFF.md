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

1. **Migrations Supabase non appliquées en production** (constaté en lecture seule le 28/11) :
   - `202611250002_bot_settings_least_privilege.sql` : `anon` et `authenticated` ont encore tous les droits
     (dont `DELETE` et `TRUNCATE`) sur `bot_settings`. Non exploitable par l'API publique grâce au RLS « refus
     total », mais la défense en profondeur prévue manque.
   - `202611280001_bot_authority_console.sql` : tables `bot_authority_snapshots` et `bot_authority_decisions`
     absentes ; la console d'autorité du site ne peut rien enregistrer tant qu'elle n'est pas appliquée.
   Les appliquer dans l'éditeur SQL de Supabase, dans l'ordre des noms, après une sauvegarde.
2. **Disque du VPS** : décider de `FWU_KEEP_PREVIOUS=3` dans le `.env` de SUCK ME (sinon les copies
   `her-v5-production.prev-*` s'accumulent ; `maj.log` avertit au-delà de 3).
3. **Recette en staging** (`RECETTE_STAGING.md`) : `/maj lancer` puis « paquet inchangé » dans `maj.log` ;
   boutons de `/stabilite etat` ; `/ia question` (refus d'un token, limites 3/min et 20/min par serveur) ;
   `/warn` sans option `expire` (expiration à 90 jours ou selon le réglage).

## Prochaine tâche précise

Aucune tâche de code ouverte de cette session. Reprendre par les actions manuelles ci-dessus, puis relire les
nouvelles PR des autres sessions contre le `main` actuel.

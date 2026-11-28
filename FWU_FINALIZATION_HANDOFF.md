# FWU — reprise de la finalisation (28/11/2026)

Branche de travail : `claude/fwu-finalization-c4alv9` (PR #128 fusionnée, PR #132 en cours). D'autres sessions travaillent en parallèle sur
`main` et sur leurs propres branches : toujours `git fetch` avant de reprendre, ne jamais pousser sur leurs branches.

## Fait

- PR #119 (mise à jour automatique à 08:00 Paris) : relue, testée sur l'arbre fusionné, fusionnée (squash).
- PR #128 :
  - planificateur : heure stricte 0–23, un seul contrôle par jour même après redémarrage
    (`fwu-data/auto-update-jour`), rattrapage limité à 4 h, évaluation au démarrage, échecs `--auto` journalisés ;
  - `fwu-maj-un-bot.sh` : un bot au paquet inchangé et en ligne n'est ni réinstallé ni redémarré ;
  - lot de dépendances vérifié ensemble (remplace dependabot #106–#108, #110–#118) ; eslint-plugin-react-hooks 7
    avec les deux règles classiques explicites (les règles React Compiler ne sont pas adoptées).
- Vérifications sur `main` (Node 24.22.3) : tests du bot (1407, 0 échec), vitest (297), tsc, eslint (0 erreur),
  build, `audit:commands` (186 définitions, aucune sans propriétaire ni manquante), `audit:replies`, smoke
  (3270 exécutions, 0 commande sans réponse), paquets des 5 bots (aucun `.env`, base, `node_modules` ni token).
- Audit ciblé sans anomalie : toutes les server functions appellent `requireOwner` (sauf `logout`) ; les routes
  `/api/public/*` vérifient le bearer en temps constant ; session OAuth (PKCE, state à usage unique, cookie
  httpOnly/secure) ; un seul OWNER (`PND_OWNER_DISCORD_ID`), les cofondateurs ne sont plus privilégiés ;
  leases liés à la connexion Discord et refus en cas de base illisible ; RLS sur toutes les tables Supabase.

- PR #132 : bouton de maintenance globale acquitté avant l'annonce publique (suite de #124) ; assistant IA :
  plafond de 20 questions/min par serveur et chiffres (`-5`, `+10`) non lus comme des commandes (suite de #130).
- Revue de #124 (boutons OWNER liés à l'ID configuré) et de #130 (pas d'historique, pas d'action Discord, contexte
  limité au catalogue et aux pages publiques, secrets refusés, bearer côté serveur) : conformes.

## Restant

- PR #127 : remplacée par #130 (assistant IA), fusionnée par sa session ; #127 peut être fermée.
- Validation en staging de `/ia question` (réponse éphémère, refus d'un token, limite 3/min et 20/min par serveur).
- Validation en staging (manuelle) : `/maj lancer` puis vérifier `paquet inchangé` dans `maj.log`.

## Prochaine tâche précise

Fusionner #132 quand la CI est verte sur le dernier commit ; relire #129 (réponses types des tickets) quand elle sort du brouillon.

# FWU V2 — agents automatiques (à créer en tâches planifiées)

La création automatique de ces tâches planifiées a été refusée par le contrôle des permissions de la session.
Pour les activer : dans Claude Code, autoriser l'outil `create_trigger`, ou créer deux tâches planifiées
(« nouvelle session à chaque exécution ») avec les consignes ci-dessous.

## Agent 1 — terminer le travail restant (une seule exécution)

> Dépôt herolfriendss/fwu-bot. Réponds en français, en autonomie, sans sous-agent, en économisant les jetons : lis d'abord
> docs/V2_PROGRESS.md, docs/V2_CARTE.md et docs/V2_COMPLETUDE.md. Respecte AGENTS.md et DECISIONS.md (aucun « FWU » affiché
> dans Discord, thème noir et blanc, role-grant-guard + bouclier BLR, couche de réponses reply-layer.js, journaux typés
> log-events.js, pont préfixe→slash). Une tâche à la fois, tests d'abord, commit atomique en français :
> 1. Tâche 11 : smash or pass (SUCK ME, /smash : inscription volontaire, désinscription, votes anonymes, signalement, retrait par
>    le staff) ; SYS+ : =note, =watch, sanctions par points avec escalade, =tribunal (vote des SYS+ → BLR) ; FDPDLAVOC : transfert
>    de propriétaire d'un vocal, classement du temps vocal ; LE FISC : quêtes quotidiennes, loterie. Vérifie la matrice avant de coder.
> 2. Journaux typés dans les commandes de LE FISC, puis régénère docs/V2_COMPLETUDE.md.
> 3. Après chaque tâche : `scripts/verify-all.sh` (7 × OK) ; si bot/ a changé : `python3 scripts/package-bot.py`.
> 4. Branche claude/v2-suite depuis main ; quand tout est vert, `git push origin HEAD:main` en avance rapide seulement (jamais de force).
> Ne touche ni au VPS, ni aux jetons, ni à MZ. Court rapport final.

## Agent 2 — vérification et correction des bugs (chaque jour)

> Dépôt herolfriendss/fwu-bot, branche main. Réponds en français, en autonomie, en économisant les jetons. Lance
> `npm ci --no-audit --no-fund` (racine et bot/), puis `scripts/verify-all.sh`. Si tout est OK : rien à faire, arrête-toi.
> Sinon, pour chaque échec : cherche la cause racine, écris d'abord un test qui reproduit, corrige au plus juste (jamais en
> désactivant ou en sautant un test), relance `scripts/verify-all.sh`. Si bot/ a changé : `python3 scripts/package-bot.py`.
> Commit en français sur la branche claude/auto-fix (créée depuis main), puis `git push origin HEAD:main` en avance rapide
> seulement, jamais de force. Ne touche ni au VPS, ni aux jetons, ni à MZ. Court rapport : échecs trouvés, corrections, résultats.

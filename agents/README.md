# her-agents

Programme des agents autonomes du serveur, séparé des 5 bots. Il tourne sur sa propre machine, voir [INSTALLATION.md](INSTALLATION.md).

## Agents de cette version

| Agent | Rôle | IA utilisée |
|---|---|---|
| **Superviseur** (`src/supervisor.js`) | Seul à poster dans `#agents`. Gère la pause, le budget, les doublons, le journal, les boutons (propriétaire uniquement) et le résumé quotidien. | aucune |
| **Observateur** (`src/collector.js`, `src/observer.js`) | Compte l'activité des salons autorisés, garde des extraits anonymisés (bugs, idées, questions, erreurs des bots), puis propose chaque jour 0 à 5 améliorations. | Claude Haiku 5.5, 1 appel par jour |
| **Avocat du diable** (`src/devil.js`) | Relit chaque proposition avant qu'elle n'arrive dans `#agents` : objections, risques, question à se poser, verdict. | Claude Sonnet 5.5, 1 appel par jour s'il y a des propositions |

Prévu ensuite (non inclus) : Mainteneur et Déployeur (sonde sur le VPS, mise à jour en un clic avec retour automatique), puis Pilote (réglages des bots depuis PostgreSQL).

## Déroulé d'une journée

1. En continu, sans IA : comptage des messages et commandes par salon, arrivées et départs, extraits anonymisés. Écriture en base toutes les 10 minutes.
2. Chaque jour à `AGENTS_DIGEST_HOUR` (heure de Paris) : effacement des extraits de plus de 7 jours, vérification de la pause et du budget, analyse de l'Observateur, relecture par l'Avocat du diable, puis résumé et cartes dans `#agents`.
3. Clic sur **Valider**, **Refuser** ou **Plus tard** par le propriétaire. Si `AGENTS_GITHUB_TOKEN` est rempli, une proposition validée devient un ticket GitHub.

## Vie privée

Voir `src/privacy.js` : empreinte HMAC à la place des identifiants, masquage des mentions, liens, e-mails, numéros et secrets, extraits limités à 300 caractères et 200 par jour, conservés 7 jours. L'IA ne voit ni identifiants de membres ni identifiants de salons.

## Tests

```bash
npm install
npm test
```

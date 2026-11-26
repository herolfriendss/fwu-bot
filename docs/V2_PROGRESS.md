# FWU V2 — avancement

Branche : `claude/festive-ramanujan-rn1dzs` (partie de `claude/epic-curie-dg0bud` @ `048d53b`, avance rapide sans réécriture).
Vérification complète : `scripts/verify-all.sh` (les 7 commandes de la section 4).

## Base de référence (avant toute modification, 26/11/2026)

| Commande | Résultat |
|---|---|
| `npm --prefix bot test` | 1 039 tests, 1 013 réussis, 0 échec, 26 ignorés |
| `npm --prefix bot run smoke` | 2 712 exécutions, 0 anomalie |
| `npm --prefix bot run audit:commands` | valide, 129 définitions |
| `npm --prefix bot run audit:replies` | valide, 0 réponse dangereuse |
| `npx vitest run` | 41 fichiers, 277 tests réussis |
| `npx tsc --noEmit` | 0 erreur |
| `npx eslint .` | 0 erreur, 6 avertissements (préexistants, `src/components/ui`) |

Environnement : Node 22.23 (le dépôt annonce Node ≥ 24 ; tout passe néanmoins).

## Tâches

| Tâche | État | Résultat de la vérification |
|---|---|---|
| 0 — Carte, base verte, failles | fait | 1 043 tests (1 017 réussis, 26 ignorés), smoke 2 712/0, vitest 277, tsc/eslint OK |
| 1 — Couche de réponses centrale | fait | 1 057 tests (1 031 réussis, 26 ignorés), smoke 2 712/0, vitest 277, tsc/eslint OK |

### Tâche 1 — couche de réponses (`bot/reply-layer.js`)

- Installée une fois pour toutes dans `index.js` : `installReplyLayer` sur chaque interaction (reply, editReply,
  followUp, update, deferReply) et `installMessageReplyLayer` sur chaque commande à préfixe du bot propriétaire.
  Les ≈480 réponses des 57 fichiers passent donc par elle sans retouche individuelle (le comportement métier ne change pas).
- `shapeReply` décide : **normal** (public, embed couleur/icône du bot, titre ✅/⛔/⚠️/ℹ️), **sensible**
  (`SENSITIVE_ACTIONS` : ban, kick, tempmute, warn, blacklist add, quarantaine ajouter, sanction, blr poser/lever →
  « 🚫 @membre est blacklisté » + bouton « 📁 Voir le dossier », réponse privée au staff, dossier en base `reply_dossiers`, 90 j),
  **erreur** (public, supprimé après 10 s : `deleteReply` / suppression du message du bot), **privé** (`PRIVATE_COMMANDS`,
  secrets détectés, marqueur `visibility: "private"`).
- Une édition texte n'écrase jamais un panneau déjà affiché ; les boutons et menus gardent la visibilité demandée.
- Bouton « En savoir plus » prêt (`enableLearnMore`), masqué jusqu'au guide (tâche 5).
- Tests : `reply-layer.test.js` (12), `interaction-reply-audit.test.js` (échoue si une commande sensible montre ses détails ou si une réponse reste en texte brut).
| 2 — Refonte des logs | partiel (voir ci-dessous) | 1 069 tests (1 043 réussis, 26 ignorés), smoke 2 734/0, vitest 277, tsc/eslint OK |

### Tâche 2 — logs typés

Fait :
- `bot/log-events.js` : événements typés (`category`, `action`, `severity`, acteur, cible, dossier), format unique
  (acteur, action, cible, dossier, lien ; couleur par bot et par gravité), dossiers numérotés par serveur (`log_cases`),
  déduplication 60 s, copie en base de **tous** les logs (`log_archive`, y compris les anciens appels non typés),
  recherche, chronologie, purge selon la conservation, résumé quotidien/hebdomadaire (`startLogMaintenance`).
- Alertes : `critical` ou actions graves (raid, tentative de rang sur un BLR, anti-nuke, dérive de permissions, bot ajouté,
  webhook, token…) → salon `logs-alertes` (facultatif : repli sur `logs-securite`) + mention du rôle de garde. L'anti-nuke émet déjà son alerte typée.
- Routage par catégorie : `sendCentralLog`/`sendToLogsHub` lisent la catégorie (option ou `systemLogEmbed({ category })`),
  transportée par le relais. Tous les appels des modules déclarent leur catégorie (test `logs-coverage.test.js`).
- File durable : un log du bot principal que le hub n'a pas pu recevoir est remis en file (3 essais, puis compté perdu) ;
  compteur des logs perdus dans `/status` et `/logs statut`.
- Configuration en base (`bot/logs-config.js`, `/logs hub|source-ajouter|source-activer|source-retirer|alertes|conservation|resume`, OWNER) :
  hub et sources lus en base → variables d'environnement → valeurs historiques (migration sans perte). Un jeu de salons
  généré par source (fin du jeu « MZ » recopié) ; MZ ne peut pas être activé depuis `/logs`.
- `/logs statut|rechercher|chronologie`, `/dossier <numéro>` (staff), préfixes `=logs`, `=dossier` (SUCK ME ; réponse en MP).
- Correction : chaque sanction apparaissait deux fois dans le hub (`moderation-actions.js` envoyait au hub en plus de `sendCentralLog`).

Reste (partiel) :
- Le journal d'audit générique d'`index.js` (`auditLog`, titres variables) utilise encore le routage par titre : il ne pourra
  être supprimé qu'après typage de ses ≈40 appelants.
- Les modules émettent encore des embeds libres via `systemLogEmbed` (catégorie typée, mais pas encore action/gravité/dossier) ;
  les nouvelles fonctions (BLR, piège, mode raid…) utilisent `logEvent`.
| Demande de l'owner : thème noir et blanc | fait | 1 072 tests (1 046 réussis, 26 ignorés), smoke 2 734/0, vitest 277, tsc/eslint OK |

### Thème noir et blanc (`bot/monochrome-theme.js`)

Crochet unique sur `MessagePayload.resolveBody` (discord.js), installé au démarrage dans `index.js` : **tout** message
sortant des 6 bots (réponses, panneaux, logs, éditions, webhooks) a ses couleurs d'embed converties en gris de même
luminance (un embed sans couleur prend le blanc cassé du thème) et ses boutons bleus/verts/rouges passés en gris.
La couche de réponses et les journaux typés utilisent directement une palette de gris (succès blanc → refus noir).
Non modifié : images (bannières GIF, cartes, avatars), emojis colorés, site/tableau de bord.

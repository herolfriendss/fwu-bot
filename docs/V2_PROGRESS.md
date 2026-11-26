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

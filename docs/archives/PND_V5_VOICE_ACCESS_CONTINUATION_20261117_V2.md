# PND Assist V5 — Voice Access hardening (17/11/2026, V2)

## Changements complémentaires

- Le bouton `vreq:start:<channelId>` est maintenant accepté uniquement si le custom ID correspond à la vocale courante, si le message est bien dans cette vocale et si l'auteur du message est le bot lui-même. Les composants copiés, repostés ou forgés sont refusés.
- Ajout de `/voc demander-id <id>` pour les vocaux totalement cachés ou absents du sélecteur Discord. Le gestionnaire réutilise le flux Voice Access existant et valide l'ID, le type de salon, l'inscription active du vocal privé, les blocages, le cooldown, les demandes en attente et le salon central.
- Ajout d'un test de catalogue vérifiant la nouvelle sous-commande et ses bornes d'ID.
- La commande `/voc demander <salon>` reste disponible pour les salons visibles.

## Fichiers modifiés depuis le checkpoint Voice Access précédent

- `bot/voice-access-requests.js`
- `bot/voice-v2.js`
- `src/lib/slash-commands.ts`
- `src/test/slash-commands.test.ts`

## Vérifications

- `node --check` : 194 fichiers JavaScript du bot contrôlés, 0 erreur.
- Tests ciblés politiques et permissions vocales : 9/9 réussis.
- Transpilation TypeScript des deux fichiers modifiés : 0 erreur de syntaxe.
- Chargement de la définition slash transpilée : 100 commandes racine, 10 sous-commandes `/voc`; `/voc demander-id` est bien sérialisée en sous-commande Discord avec une option texte obligatoire de 5 à 25 caractères.
- Suite officielle `npm --prefix bot test` : 308 tests détectés, 285 réussis et 23 échecs de chargement. Les 23 ne démarrent pas, car `discord.js` est absent de cette copie (`ERR_MODULE_NOT_FOUND`).
- `tsc --noEmit` non exécutable : dépendances de types absentes (`vite/client`, `vitest/globals`).
- Environnement disponible : Node v22.16.0 ; le projet demande Node >=24.

## Limites restantes

- La publication dans le chat natif vocal dépend de la disponibilité de la fonctionnalité côté Discord et des permissions effectives. Le salon central configuré reste le fallback.
- Aucun test sur un serveur Discord réel/staging n'a été exécuté.
- Aucun déploiement, aucune migration de base et aucune modification des serveurs Discord n'ont été effectués.

Aucun secret, fichier `.env`, base SQLite, dossier `data`, `node_modules` ou build n'est inclus dans la livraison.

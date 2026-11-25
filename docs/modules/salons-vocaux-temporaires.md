# Salons vocaux temporaires (Vocal V2)

Bot : **FDP DLA VOC** (domaine `fdpdlavoc`). Code : `bot/voice-v2.js`, règles pures dans `bot/voice-v2-policy.js`, stockage dans `bot/temp-voice-store.js`.

## Fonctionnement

- Un membre rejoint le **vocal de création** (hub) : le bot crée son salon dans la catégorie choisie (à défaut, celle du hub) et l'y déplace.
- S'il a déjà un salon, il y est renvoyé au lieu d'en créer un deuxième. Deux événements rapprochés ne créent qu'un seul salon.
- S'il quitte le hub avant d'être déplacé, le salon créé est supprimé tout de suite (pas de salon fantôme).
- Le bot publie un **panneau de contrôle** dans le chat du salon.
- Quand le **propriétaire part** et qu'il reste du monde, la propriété passe au membre suivant (message dans le chat du salon). `/voc claim` reste possible.
- Quand il ne reste **plus aucun humain** (les bots ne comptent pas), le salon est supprimé, tout de suite ou après le délai de grâce réglé. Quelqu'un qui revient pendant le délai annule la suppression.
- Au redémarrage : lignes orphelines supprimées, salons vidés pendant l'arrêt supprimés, propriétaire absent remplacé, membres restés dans le hub servis.

## Panneau et `/voc`

| Action | Bouton | Commande | Qui |
| --- | --- | --- | --- |
| Verrouiller / déverrouiller | 🔒 🔓 | `/voc lock`, `/voc unlock` | propriétaire ou staff (Gérer les salons) |
| Limite | 👥 | `/voc limit` | propriétaire ou staff |
| Renommer (2 fois / 10 min, limite Discord) | ✏️ | `/voc name` | propriétaire ou staff |
| Inviter / expulser | ✅ 👢 | `/voc inviter`, `/voc expulser` | propriétaire ou staff, rang vérifié |
| Transférer / revendiquer | 👑 🙋 | `/voc transferer`, `/voc claim` | propriétaire ou staff / membre présent si le propriétaire est parti |
| Supprimer | 🗑️ | `/voc delete` | propriétaire ou staff |
| Liste de confiance | ⭐ | `/voc confiance` | propriétaire |
| Liste des bloqués | ⛔ | `/voc bloquer` | propriétaire, rang vérifié |
| Retirer d'une liste | ↩️ | `/voc retirer` | propriétaire |
| Voir ses listes | | `/voc listes` | propriétaire |

Chaque clic relit le membre et la propriété du salon : un ancien propriétaire ne peut plus agir après un transfert.

- **Confiance** : le membre entre toujours dans les salons du propriétaire, même verrouillés.
- **Bloqués** : le membre ne peut plus entrer. On ne peut pas bloquer un membre mieux placé que soi, ni un membre intouchable (palier 0).
- Les listes (25 membres maximum chacune) et les préférences (dernier nom, dernière limite) sont gardées **par serveur** et reprises à chaque nouveau salon.
- Le propriétaire n'a plus « Rendre muet » ni « Mettre en sourdine » : un mute serveur suivait le membre dans tous les salons.

## Réglages (`/setup` et site, onglet Modules)

| Champ | Clé | Valeurs |
| --- | --- | --- |
| Module activé | `enabled` | oui / non (bouton) |
| Vocal de création | `hubChannelId` | salon vocal |
| Catégorie | `categoryId` | catégorie |
| Limite par défaut | `defaultLimit` | 0 à 99 |
| Modèle de nom | `nameTemplate` | `{user}` = pseudo |
| Délai avant suppression | `emptyDeleteSeconds` | 0 à 300 secondes |

Les deux écrans enregistrent seulement les champs modifiés (`changes` / `expected` côté bot, `writeSettingsSections` côté site) : un changement fait ailleurs entre-temps n'est jamais écrasé.

## Tests

- Automatiques : `cd bot && npm test` (`temp-voice-v2.test.js`, `temp-voice-reconcile.test.js`, `systems/setup/policy.test.js`), `npx vitest run` (`src/test/voice-v2.test.ts`, `src/test/bot-settings.test.ts`).
- À faire sur le serveur de test (bot de test, jamais le jeton de production) :
  1. Rejoindre le hub : salon créé, déplacement, panneau publié.
  2. Rejoindre et quitter le hub très vite : aucun salon ne reste.
  3. Propriétaire qui part avec un ami dans le salon : l'ami devient propriétaire, l'ancien ne peut plus cliquer.
  4. Régler 30 s de délai, vider le salon, revenir avant 30 s : le salon reste ; partir : supprimé après 30 s.
  5. Verrouiller : un membre de confiance entre, un autre doit demander l'accès ; déverrouiller : le membre bloqué reste bloqué.
  6. Renommer 3 fois de suite : le 3e est refusé avec l'heure de la prochaine tentative.
  7. Redémarrer le bot avec un salon vide et un membre dans le hub : salon vide supprimé, membre servi.

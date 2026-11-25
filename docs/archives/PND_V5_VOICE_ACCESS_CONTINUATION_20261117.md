# PND Assist V5 — reprise Voice Access (17/11/2026)

## Modifications

- Le verrouillage `/voc lock` utilise maintenant le même service que `=pv` et le panneau vocal : instantané des overwrites, application du plan privé complet et enregistrement dans `voice_private_channels`.
- Le déverrouillage `/voc unlock` utilise le même service que `=unpv`/les panneaux : restauration des overwrites et annulation des demandes en attente.
- Compatibilité conservée pour les vocaux verrouillés par l'ancien `/voc lock`, qui ne disposaient pas d'instantané : le déverrouillage retire le refus `Connect` de `@everyone` et désactive Voice Access.
- Lorsqu'une vocale est verrouillée, PND Assist tente de publier dans le chat natif de la vocale un panneau avec le bouton **Demander l'accès**. Cette publication exige `ViewChannel`, `SendMessages` et `ReadMessageHistory` pour le bot. Si le chat vocal n'est pas disponible ou si Discord refuse l'envoi, le flux central `#demandes-vocales` reste le recours.
- Le bouton réutilise le flux de demande existant : vérification de l'accès, blocage, anti-doublon, cooldown, expiration de 10 minutes et décision propriétaire/staff dans le salon central.
- Les paramètres du serveur sont maintenant transmis au gestionnaire du bouton, pour respecter le salon de demandes configuré.

## Fichiers modifiés

- `bot/voice-access-requests.js`
- `bot/voice-commands.js`
- `bot/voice-v2.js`

## Vérifications

- `node --check` : 192 fichiers JavaScript du bot contrôlés, 0 erreur.
- Tests ciblés politiques vocales : 8/8 réussis.
- Suite officielle du bot : 305 tests détectés, 282 réussis et 23 échecs de chargement dus à `discord.js` absent de cette archive (`ERR_MODULE_NOT_FOUND`). Les 23 ne sont pas des échecs fonctionnels de tests exécutés.
- Environnement disponible : Node v22.16.0 ; le projet demande Node >=24.
- Aucun test Discord réel, aucune migration ni aucun déploiement effectués.

## Limites restantes

- Le chat natif des vocaux dépend de la disponibilité de cette fonctionnalité côté Discord et des permissions réelles du serveur. La publication est non bloquante et le salon central reste le fallback.
- Pour une vocale totalement cachée (aucun accès `ViewChannel`), le membre doit utiliser `=demandevocal <ID_DU_SALON>` depuis un salon visible. Le bot vérifie ensuite que la vocale est bien enregistrée comme privée.
- Les tests réels des interactions Discord doivent être faits sur un serveur de staging avant activation en production.

Aucun secret, fichier `.env`, base SQLite, dossier `data`, `node_modules` ou build n'est inclus dans la livraison.

# PND Assist plus her — serveur central de logs

Identifiants configurés pour la prochaine mise en service :

- Serveur principal actif : `1562643485981544559`
- Serveur central PND Assist plus her (LOGS ONLY) : `1570484435239833701`
- Second serveur principal réservé mais volontairement inactif : `1505904703563894814`

Le second serveur principal n'est PAS inclus dans l'allowlist et ne reçoit aucune configuration.

## Allowlist VPS

Dans `bot/.env`, configurer exactement :

```env
V4_ALLOWED_GUILD_IDS=1562643485981544559,1570484435239833701
```

Le serveur de logs est accepté uniquement pour recevoir les journaux. Les messages et interactions de commandes dans ce serveur sont ignorés.

## Provisionnement

Au prochain démarrage, lorsque le bot est présent sur le serveur central, il crée les catégories, salons et rôles définis dans `bot/logs-hub.js`. Il faut que son rôle dispose de `Manage Channels` et `Manage Roles`, et que son rôle soit assez haut pour gérer les rôles `Logs ...`.

Les rôles créés sont : `Logs Owner`, `Logs Admin`, `Logs Modération`, `Logs Économie`, `Logs Viewer`. Ils reçoivent uniquement l'accès de lecture. L'attribution des rôles aux humains reste manuelle pour éviter d'accorder accidentellement des droits.

## Important

- Aucun déploiement ou changement VPS n'a été effectué.
- Le serveur central ne doit pas être utilisé pour les commandes Her? ordinaires.
- Les journaux sont envoyés vers les salons du serveur central, avec le nom et l'identifiant du serveur source dans le pied de page.
- La base de données/audit applicatif demeure la source de conservation structurée ; Discord sert d'interface de consultation.
- Les anciens envois locaux configurés par `logs.channelId` restent en compatibilité et peuvent provoquer des doublons tant que la migration des anciens réglages n'est pas terminée.

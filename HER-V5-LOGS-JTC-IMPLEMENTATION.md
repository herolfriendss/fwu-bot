# Her? V5 — Logs centralisés & Join-to-Create

## Implémenté dans cette passe
- Ajout de `logs.channelId` aux paramètres de serveur et à leur normalisation.
- Ajout de `bot/logs.js`, utilitaire commun pour publier des embeds dans le salon central.
- Modération, tickets et GuildGuard utilisent le salon central lorsqu'il est configuré, avec leurs anciens salons comme fallback de compatibilité.
- Join-to-Create conserve le hub, la création automatique, le déplacement du membre, la persistance SQLite et le nettoyage des salons vides.
- Les événements Join-to-Create (création, suppression, erreur) sont envoyés au salon central lorsque `logs.channelId` est configuré.

## À terminer avant le déploiement global
- Ajouter le sélecteur `logs.channelId` au dashboard et son endpoint de sauvegarde.
- Migrer les autres modules (DOG, MENOTTE, rôles, SYS+, CAPTCHA, IA, musique/radio, automatisations) vers `sendCentralLog`.
- Ajouter les tests d'intégration avec un client Discord simulé et vérifier les permissions `ViewChannel`/`SendMessages`/`EmbedLinks`.
- Vérifier la restauration Join-to-Create au démarrage et les salons orphelins sur un serveur de test.

Aucun identifiant de salon n'est inventé : le salon doit être configuré par serveur. Les anciens champs de logs restent acceptés pour compatibilité.

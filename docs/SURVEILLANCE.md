# FWU SENTINEL — surveillance extérieure

Le script `scripts/installation/fwu-surveillance.mjs` est un superviseur indépendant des processus PM2. Il tourne hors des bots, ce qui lui permet de continuer à signaler les pannes même si FWU CORE ou SENTINEL s'arrête.

Il surveille :
- Les processus PM2 de FWU CORE, du dashboard et des bots spécialisés.
- Le marqueur `.connected` de chaque bot, en vérifiant que son PID correspond au processus PM2 actuel. Un processus affiché « online » mais qui n'a pas rejoint Discord est donc signalé.
- Les bots futurs (SOCIAL, EVENT, DISPATCH, ARCADE, AUTHORITY) comme facultatifs jusqu'à leur première apparition dans PM2.
- Les redémarrages en boucle, les logs en attente, l'espace disque, la mémoire vive, la charge système et l'état/âge de la dernière sauvegarde.

Le script envoie uniquement les changements d'état au webhook staff. Les seuils mémoire (90 %, retour sous 85 %) et charge CPU (load supérieur à 2 fois le nombre de cœurs) doivent persister cinq minutes avant alerte ; les seuils de récupération évitent les notifications répétitives. Il reste en lecture seule : PM2 et le watchdog de connexion gèrent les redémarrages. Il ne tente jamais de contourner un arrêt définitif lié à un token invalide ou à une limite de sessions Discord.

Installation initiale sur le VPS : créer le webhook staff dans `~/fwu-data/.alerte-webhook`, puis installer le cron minute par minute avec la commande indiquée en tête du script. La recette doit vérifier qu'un bot en ligne possède bien un marqueur dont le PID correspond à celui de PM2.

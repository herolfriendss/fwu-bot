# Feuille de route (notée le 27/11/2026)

Une tâche à la fois, dans l'ordre. Cocher au fur et à mesure.

## État au 27/11

- Console `/console/` déployée par Render (commit `main`). Lecture réelle des bots, journal, activité, analyse, redémarrage individuel.
- Migrations `bot_control_commands` et `bot_activity_snapshots` appliquées sur Supabase.
- VPS à jour (archive du dépôt, script de déploiement, PM2). Invest + tourne : connecté, 4 commandes slash.
- **Bloqué : connexion Discord du site.** L'application Discord « fwu » est en quarantaine (anti-spam). Contestation envoyée via dis.gd/app-quarantine. Solution de repli : une application Discord neuve pour la connexion seulement (`DISCORD_CLIENT_ID` et `DISCORD_CLIENT_SECRET` sur Render).
- **Guard et Fisc arrêtés** : limite de connexions Discord du jour épuisée (reprise à 22:36 UTC, soit 23:36 à Paris). Ensuite : `pm2 restart fwu-guard fwu-fisc`, une seule fois.

## A. Fiabilité (d'abord)

- [ ] 1. Comprendre pourquoi les bots retombent en boucle (`fwu-suckme` : 31 redémarrages) et allonger le délai entre deux essais de connexion Discord, pour ne plus épuiser la limite ni risquer une quarantaine.
- [ ] 2. Alerte immédiate dans un salon réservé au staff quand un bot tombe ou s'arrête définitivement.
- [ ] 3. Démarrage automatique après un redémarrage du VPS (`pm2 startup` puis `pm2 save`) : vérifier que c'est fait.

## B. Console

- [ ] 4. Brancher modération, quotas, rôles et vocal : les bots envoient un instantané au site (comme pour l'activité), puis actions depuis le site (lever une sanction, couper une commande).
- [ ] 5. Bouton « Tout redémarrer » et historique des redémarrages et des pannes par bot.
- [ ] 6. Alerte quand les arrivées ou les départs dépassent la normale (à partir de la page Analyse).

## C. Serveur Discord et bots

- [ ] 7. Invest + : étoffer ses commandes (4 aujourd'hui).
- [ ] 8. Résumé quotidien ou hebdomadaire posté automatiquement : messages, arrivées, départs, sanctions.
- [ ] 9. Sauvegarde de la configuration de tous les bots, pour restaurer si le VPS est recréé.

## D. Sécurité (à ajouter)

- [ ] 10. **Régénérer les secrets passés par le chat** : `DISCORD_CLIENT_SECRET` (portail Discord), `SESSION_SECRET` (Render et VPS). Faire de même pour tout autre secret affiché ailleurs.
- [ ] 11. Retirer de Render les variables devenues inutiles (par exemple `DASHBOARD_PASSWORD` si l'ancien accès par mot de passe n'existe plus) : moins de secrets, moins de risques.
- [ ] 12. Journal d'audit des actions de la console (qui a redémarré quel bot, quand) et limite de fréquence sur l'API console.
- [ ] 13. Vérifier que les clés et tokens ne sont qu'à un seul endroit chacun, avec les droits minimum (clé Supabase `service_role` uniquement côté serveur, jamais dans le navigateur).
- [ ] 14. Passer les conseillers de sécurité de Supabase (RLS, droits) et `npm audit` sur le site et les bots, corriger ce qui est signalé.
- [ ] 15. En-têtes de sécurité du site (CSP, anti-framing) et cookies de session stricts. Vérifier la page `/console/`.
- [ ] 16. Surveillance externe : une sonde qui prévient (Discord ou e-mail) si le site ou un bot ne répond plus, même quand le VPS est tombé.
- [ ] 17. Rotation des journaux PM2 et surveillance disque et mémoire du VPS (un bot peut tomber à cause d'un disque plein ou d'une limite mémoire).
- [ ] 18. Environnement de test : un bot et un serveur Discord séparés pour essayer une mise à jour avant la production (déjà demandé par les règles du projet).
- [ ] 19. Sauvegardes automatiques chiffrées des données du VPS (base partagée, SQLite) hors du VPS, avec un test de restauration.
- [ ] 20. Quarantaine Discord : comprendre la cause (connexions répétées, trop d'appels API) pour ne pas la reproduire. Garder un compte de secours propriétaire.

## E. Fonctionnalités possibles (à valider d'abord)

- [ ] 21. Page « Santé » dans la console : état des services (site, base, bots) en un coup d'œil, avec l'historique des pannes.
- [ ] 22. Notifications poussées vers le téléphone en cas d'incident.
- [ ] 23. Tableau de modération dans la console (sanctions en cours, historique par membre) une fois l'étape 4 faite.
- [ ] 24. Rapports d'activité exportables (CSV) depuis la page Analyse.
- [ ] 25. Tâches planifiées (annonces, nettoyages, rappels) gérées depuis la console.

# Feuille de route (notée le 27/11/2026)

Une tâche à la fois, dans l'ordre. Cocher au fur et à mesure.

## État au 27/11

- Console `/console/` déployée par Render (commit `main`). Lecture réelle des bots, journal, activité, analyse, redémarrage individuel.
- Migrations `bot_control_commands` et `bot_activity_snapshots` appliquées sur Supabase.
- VPS à jour (archive du dépôt, script de déploiement, PM2). Invest + tourne : connecté, 4 commandes slash.
- **Bloqué : connexion Discord du site.** L'application Discord « fwu » est en quarantaine (anti-spam). Contestation envoyée via dis.gd/app-quarantine. Solution de repli : une application Discord neuve pour la connexion seulement (`DISCORD_CLIENT_ID` et `DISCORD_CLIENT_SECRET` sur Render).
- **Guard et Fisc arrêtés** : limite de connexions Discord du jour épuisée (reprise à 22:36 UTC, soit 23:36 à Paris). Ensuite : `pm2 restart fwu-guard fwu-fisc`, une seule fois.

## A. Fiabilité (d'abord)

- [x] 1. Comprendre pourquoi les bots retombent en boucle (`fwu-suckme` : 31 redémarrages) et allonger le délai entre deux essais de connexion Discord, pour ne plus épuiser la limite ni risquer une quarantaine. _(Fait le 27/11 : si Discord répond « limite de connexions atteinte », le bot attend l'heure de reset au lieu de redémarrer, et cet échec ne compte pas vers l'arrêt définitif ; `bot/gateway-watchdog.js` `parseSessionLimit`)_
- [ ] 2. Alerte immédiate dans un salon réservé au staff quand un bot tombe ou s'arrête définitivement.
- [ ] 3. Démarrage automatique après un redémarrage du VPS (`pm2 startup` puis `pm2 save`) : vérifier que c'est fait.

## B. Console

- [ ] 4. Brancher modération, quotas, rôles et vocal : les bots envoient un instantané au site (comme pour l'activité), puis actions depuis le site (lever une sanction, couper une commande).
- [ ] 5. Bouton « Tout redémarrer » et historique des redémarrages et des pannes par bot. _(« Tout redémarrer » fait le 27/11 dans Réglages ; reste l'historique)_
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
- [x] 15. En-têtes de sécurité du site (CSP, anti-framing) et cookies de session stricts. Vérifier la page `/console/`. _(Fait le 27/11 : `nitro.config.ts` ajoute anti-framing, nosniff, Referrer-Policy, Permissions-Policy et HSTS à toutes les pages, `/console/` comprise)_
- [ ] 16. Surveillance externe : une sonde qui prévient (Discord ou e-mail) si le site ou un bot ne répond plus, même quand le VPS est tombé.
- [ ] 17. Rotation des journaux PM2 et surveillance disque et mémoire du VPS (un bot peut tomber à cause d'un disque plein ou d'une limite mémoire).
- [ ] 18. Environnement de test : un bot et un serveur Discord séparés pour essayer une mise à jour avant la production (déjà demandé par les règles du projet).
- [ ] 19. Sauvegardes automatiques chiffrées des données du VPS (base partagée, SQLite) hors du VPS, avec un test de restauration.
- [ ] 20. Quarantaine Discord : comprendre la cause (connexions répétées, trop d'appels API) pour ne pas la reproduire. Garder un compte de secours propriétaire.

## E. Fonctionnalités possibles (à valider d'abord)

- [ ] 21. Page « Santé » dans la console : état des services (site, base, bots) en un coup d'œil, avec l'historique des pannes.
- [ ] 22. Notifications poussées vers le téléphone en cas d'incident.
- [ ] 23. Tableau de modération dans la console (sanctions en cours, historique par membre) une fois l'étape 4 faite.
- [x] 24. Rapports d'activité exportables (CSV) depuis la page Analyse. _(Fait le 27/11 : bouton « Copier le journal en CSV » sur la page Analyse)_
- [ ] 25. Tâches planifiées (annonces, nettoyages, rappels) gérées depuis la console.

## F. Confort et gain de temps (ajouté le 27/11)

- [ ] 26. **Une seule commande pour déployer** sur le VPS (mise à jour du code, déploiement, redémarrage, vérification), au lieu de la longue ligne actuelle. _(Existe déjà côté Discord : `/maj lancer`, et la mise à jour automatique de 5 h installe `main` chaque nuit une fois amorcée ; voir `docs/VERSIONS_ET_MAJ.md`)_
- [ ] 27. **Installer `git` sur le VPS** : les mises à jour se feraient par `git pull` et non plus par archive téléchargée.
- [ ] 28. **Raccourci SSH** (`ssh fwu` au lieu de l'adresse et de la clé à chaque fois), côté ordinateur.
- [ ] 29. **Déploiement automatique du VPS** à chaque mise à jour validée de `main`, par une clé SSH dédiée aux droits limités. Plus besoin de taper quoi que ce soit.
- [x] 30. **Console installable sur le téléphone** (icône sur l'écran d'accueil, plein écran), pour redémarrer un bot en deux appuis. _(Fait le 27/11 : manifeste et icône : sur le téléphone, ouvrir /console/ puis « Ajouter à l'écran d'accueil »)_
- [ ] 31. **Mode maintenance global** : un bouton qui annonce l'arrêt aux membres, coupe les commandes sensibles, puis remet tout en route.
- [x] 32. **Aide-mémoire dans la console** : les commandes utiles (PM2, logs, redémarrage) à copier en un clic, par bot. _(Fait le 27/11 : bloc « Aide-mémoire du serveur » dans Réglages, chaque commande se copie en un clic)_
- [x] 33. **Journal des changements** (`CHANGELOG`) tenu automatiquement, pour savoir ce qui a été mis en ligne et quand. _(Fait le 27/11 : `CHANGELOG.md` à la racine)_
- [x] 34. **Mode d'emploi pour reprendre sans aide** : où est quoi (Render, VPS, Supabase, Discord), comment déployer, comment restaurer. _(Fait le 27/11 : `docs/MODE_EMPLOI.md`)_
- [ ] 35. **Gestion du staff depuis la console** : voir qui a quel palier et quels quotas, sans passer par les commandes.
- [ ] 36. **Modèles prêts à l'emploi** : embeds (règlement, annonces), messages de sanction, réponses fréquentes.
- [ ] 37. **Tests automatiques avant chaque mise en ligne** (la CI existe déjà : la rendre obligatoire avant de fusionner).
- [ ] 38. **Rapport hebdomadaire par e-mail ou Discord** : état des bots, pannes, activité, sanctions de la semaine.
- [ ] 39. **Vue « tout va bien ? »** : un seul voyant vert ou rouge en haut de la console, avec la raison quand il est rouge.
- [x] 40. **Recherche globale dans la console** (membre, commande, événement) depuis la palette `Ctrl K`. _(Fait le 27/11 : la palette `Ctrl K` cherche aussi dans les commandes et le journal)_

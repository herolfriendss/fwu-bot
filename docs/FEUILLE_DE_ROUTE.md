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

## G. Nouvelles commandes proposées (27/11, à valider)

Déjà présentes, donc retirées de la liste : `/dossier`, `/casier`, `/staffhistory`, `/rapportstaff`, `/anniversaire`, `/quete`, `/impots`, `/slowmode`, `/raid`, `/quarantaine`, `/status`, `/stabilite`.

### Pour SYS+
- [ ] 41. **`/sysp moi`** : mon quota restant aujourd'hui, mes dernières sanctions, les alertes ouvertes, en une réponse privée.
- [ ] 42. **`/releve`** : résumé des 12 dernières heures (sanctions, alertes, tickets ouverts, membres surveillés) pour le SYS+ qui prend la suite.
- [ ] 43. **Astreinte** : un SYS+ se déclare disponible ; les alertes de Guard le mentionnent lui seul au lieu de tout le staff.
- [ ] 44. **Demande de quota** : un bouton pour demander à l'owner quelques sanctions de plus ; l'owner accepte ou refuse en un clic (rien n'est accordé sans lui).
- [ ] 45. **Double validation des actions de masse** (`/muteall`, `/mvall`, `/dmall`, purge de raid) : un deuxième SYS+ confirme avant l'exécution.
- [ ] 46. **`/appel`** : vote rapide entre SYS+ (pour / contre) avant une sanction lourde, résultat archivé dans le dossier.
- [ ] 47. **Contestation** : un membre sanctionné peut faire appel par bouton ; l'appel est examiné par un autre SYS+ que l'auteur de la sanction.
- [ ] 48. **Bilan personnel du dimanche** en message privé : mes sanctions, mes annulations, mon temps de présence.
- [ ] 49. **`/note @membre`** : notes privées partagées entre SYS+ (vérifier d'abord ce que fait le module de notes existant).
- [ ] 50. **`/geler #salon`** : écriture coupée et mode lent pendant une dispute, retour automatique à la normale après le délai choisi.
- [ ] 51. **`/purge-raid`** : quarantaine ou expulsion en une fois des comptes arrivés pendant un raid (fenêtre et ancienneté de compte réglables).

### Guard
- [ ] 52. Alerte quand un compte récent arrive avec le même pseudo ou le même avatar qu'un banni.
- [ ] 53. Liens d'invitation vers d'autres serveurs bloqués, sauf liste autorisée.
- [ ] 54. Sauvegarde des salons et des rôles, `/restaurer` après une suppression massive.

### Le Fisc et Invest+
- [ ] 55. Impôt hebdomadaire sur les grosses fortunes reversé dans une cagnotte du serveur (à articuler avec `/impots`).
- [ ] 56. Bourse virtuelle : des actions dont le cours suit l'activité du serveur.
- [ ] 57. Classement mensuel des fortunes avec un rôle pour le premier (rôle non privilégié, via `role-grant-guard`).

### SUCK ME et bot principal
- [ ] 58. Résumé de la semaine posté le dimanche : arrivées, membres les plus actifs, temps en vocal.

### Tous les bots
- [ ] 59. **`/sante`** : état des 6 bots dans Discord, réservé à SYS+.
- [ ] 60. **`/maintenance on|off`** : prévient les membres et coupe les commandes sensibles (à rapprocher de `/stabilite`).

## H. Autres propositions (27/11, mises de côté, à valider)

### SYS+ et modération
- [ ] 61. **`/signaler`** (membres) : le signalement arrive dans une file staff avec un bouton « Je prends » ; un seul SYS+ s'en charge, les autres le voient.
- [ ] 62. **Barème de sanctions** : selon le casier, le bot propose la sanction suivante (avertissement → mute 1 h → mute 24 h → ban) ; le SYS+ garde la décision.
- [ ] 63. **Preuve obligatoire** pour un ban : capture ou lien de message joint, gardé dans le dossier.
- [ ] 64. **Rappel avant la fin d'une sanction temporaire** au SYS+ qui l'a posée, pour la prolonger ou la laisser expirer.
- [ ] 65. **`/enquete @membre`** (SYS+) : en un écran, ses arrivées et départs, l'invitation utilisée, ses passages en vocal et son casier.
- [ ] 66. **Dossier partagé par membre** visible dans la console une fois l'étape 4 faite.

### Sécurité
- [ ] 67. Liens de phishing et faux « Nitro gratuit » supprimés d'office, l'auteur mis en quarantaine.
- [ ] 68. Alerte à chaque création de webhook ou d'intégration sur le serveur.
- [ ] 69. Alerte quand un bot perd une permission Discord dont il a besoin (rôle déplacé, permission retirée).
- [ ] 70. Message privé à l'owner à chaque connexion à la console du site (heure, appareil).

### Communauté
- [ ] 71. **Starboard** : un message qui reçoit assez de réactions est recopié dans un salon « meilleurs messages ».
- [ ] 72. **Parrainage** : un ancien accueille un nouveau, les deux gagnent une récompense si le nouveau reste un mois.
- [ ] 73. **Succès et badges** affichés sur `/profil` (100 h de vocal, 1 an d'ancienneté, premier giveaway gagné…).
- [ ] 74. **Série quotidienne** : bonus qui grandit chaque jour d'activité d'affilée.
- [ ] 75. **`/resume #salon`** : résumé par l'IA de ce qu'on a raté dans un salon (sans jamais lire les salons privés du staff).
- [ ] 76. **Traduire** : clic droit sur un message, traduction en privé.
- [ ] 77. **`/heure @membre`** : son heure locale, pour savoir s'il dort.

### Vocal
- [ ] 78. Classement vocal de la semaine avec une récompense.
- [ ] 79. Salon d'écoute commune : la radio ou la playlist du bot, chacun peut voter pour le morceau suivant.

### Économie
- [ ] 80. **Enchères** d'objets rares avec compte à rebours.
- [ ] 81. **Assurance** contre `/rob` et `/braquage`, payée chaque semaine.
- [ ] 82. Événements économiques aléatoires (krach, prime double) annoncés par Le Fisc.

### Owner
- [ ] 83. Rapport mensuel de l'usage de l'IA (nombre de réponses, coût estimé).
- [ ] 84. Export de toute la configuration en un fichier, envoyé en privé à l'owner, pour la restaurer si besoin.

## I. Sécurité quand un bot tombe (27/11, validé par l'owner)

Constat dans le code : si Guard ne renouvelle plus son bail pendant 60 s, le bot principal reprend seul ses protections automatiques
(automod, anti-raid, pièges, double compte), et de même pour le bouclier tier 0 de SUCK ME (`bot/bot-runtime.js`, `serves`).
Les commandes propres à Guard (`/ban`, `+ban`…) ne marchent plus, et si le bot principal tombe aussi, plus rien ne protège.

- [ ] 85. **Prévenir quand le relais s'active** : message dans le salon staff (« Guard hors ligne, le bot principal assure ses protections ») et voyant dans la console.
- [ ] 86. **Relais en chaîne** : si le bot principal tombe aussi, un deuxième bot (par exemple SUCK ME) reprend les protections de Guard.
- [ ] 87. **Mode dégradé automatique** : tant que Guard est absent, le relais durcit la vérification des arrivées, jusqu'à son retour.
- [ ] 88. **Alerte sans bot** : le site détecte qu'aucun bot de protection n'envoie de signal depuis 2 min et prévient par webhook Discord, même si tous les bots sont tombés.
- [ ] 89. **AutoMod natif de Discord** (tourne chez Discord, sans bot) : spam de mentions, mots interdits, liens, alertes de raid et de spam en MP.
- [ ] 90. **Réglages du serveur** : 2FA obligatoire pour les actions de modération, niveau de vérification élevé, filtre de contenu, permission Administrateur réservée au compte owner.
- [ ] 91. **Rôles des bots au-dessus des rôles staff**, vérifié par `/scan` qui signale un rôle mal placé.

## J. Encore d'autres commandes (27/11, mises de côté)

- [ ] 92. **`/archive #salon`** : transcription d'un salon ou d'un ticket en fichier, gardée dans les logs.
- [ ] 93. **Défi collectif de la semaine** : un objectif commun (10 000 messages, 200 h de vocal) qui récompense tout le serveur.
- [ ] 94. **`/citation`** : transforme un message en image citation à partager.
- [ ] 95. **Remerciement des boosters** : message automatique, rôle et avantages tant que le boost dure.
- [ ] 96. **`/calendrier`** : les événements à venir, avec rappel en privé aux inscrits.
- [ ] 97. **Salon texte temporaire** pour un événement, supprimé tout seul après.

## K. Validé par l'owner le 27/11 (à faire, dans cet ordre)

- [x] 98. **Anti-largage vocal** : quand plusieurs membres sont déconnectés d'un même salon en quelques secondes (attaque réseau qui fait « sauter » la vocale), le bot change aussitôt la région du salon pour forcer un autre serveur vocal Discord, prévient le staff et liste les membres arrivés juste avant. Limite à dire clairement : un bot ne peut pas bloquer une attaque réseau, il ne peut que faire changer de serveur vocal et repérer le suspect. _(Fait le 27/11 : `bot/voice-drop-guard.js`, assuré par Guard (ou le bot principal en relais) ; `PND_VOICE_DROP_GUARD=off` pour le couper)_
- [x] 99. **`/dogall`** (SYS+) : met en laisse tous les membres de son salon vocal, seulement si leur nombre ne dépasse pas sa limite de laisses restantes ; mêmes protections que `/dog` (tier 0, owner, hiérarchie, quotas, WHITELIST sans contournement), et `/undogall` pour tout retirer. _(Fait le 27/11 : `/dogall` et `=dogall`, `bot/dog-commands.js`)_
- [x] 100. **WOUAF retravaillé** : à chaque message du membre, une réponse différente tirée au hasard (aboiements générés, jamais deux fois la même d'affilée), en plus des phrases configurées. _(Fait le 27/11 : `bot/systems/waouf/policy.js` ; délai par défaut ramené à 3 s, réglable dès 2 s avec `/wouaf cooldown`)_

## L. Commandes « diaboliques » pour SYS+ (27/11, validé par l'owner)

Garde-fous communs : SYS+ seulement, durée limitée, quotas partagés, tier 0 et owner intouchables, jamais sur un staff de rang égal ou supérieur, journalisé, levée possible à tout moment, aucune mention @everyone/@here.

- [ ] 101. **`/perroquet @membre`** : chaque message est remplacé par sa version moqueuse (mOqUeUsE), à l'envers ou en majuscules, signée de son nom.
- [ ] 102. **`/fantome @membre`** : ses messages disparaissent au bout de 5 s, il parle dans le vide.
- [ ] 103. **`/mime @membre`** : il ne peut plus écrire qu'en émojis, le reste est effacé.
- [ ] 104. **`/clown @membre`** : chacun de ses messages reçoit une réaction 🤡.
- [ ] 105. **`/roulette` vocale** : dans le salon du SYS+, un membre tiré au sort (non protégé) est rendu muet 1 min.
- [ ] 106. **`/patate-chaude`** : un membre reçoit la patate, il doit la passer en mentionnant quelqu'un en 30 s ; celui qui la garde à la fin est rendu muet en vocal 1 min.
- [ ] 107. **`/taxe @membre`** (Le Fisc) : une part de ses gains va au SYS+ pendant 1 h.

## M. Encore des commandes « diaboliques » (27/11, proposées, mêmes garde-fous que L)

- [ ] 108. **`/robot @membre`** : ses messages deviennent « BIP BOUP » et du langage de robot.
- [ ] 109. **`/bebe @membre`** : ses messages réécrits en langage bébé.
- [ ] 110. **`/yoda @membre`** : l'ordre de ses mots est inversé.
- [ ] 111. **`/chuchote @membre`** : ses messages en tout petits caractères (ᵗᵉˣᵗᵉ).
- [ ] 112. **`/bouffon @membre`** : rôle coloré « Bouffon du serveur » affiché à part pendant 30 min (rôle sans aucune permission).
- [ ] 113. **`/sablier @membre`** : un seul message par minute, le reste est effacé.
- [ ] 114. **`/sourdine-folle @membre`** : en vocal, son micro est coupé puis rendu au hasard pendant 2 min.
- [ ] 115. **`/exil @membre`** : chaque fois qu'il rejoint une vocale, il est renvoyé dans le salon AFK, pendant la durée choisie.
- [ ] 116. **`/interrogatoire @membre`** : le bot lui pose 3 questions au hasard ; pas de réponse à temps, muet 1 min.
- [ ] 117. **`/tribunal @membre`** : vote public de 60 s, coupable ou innocent ; coupable, muet 2 min.
- [ ] 118. **`/rancon @membre`** : muet jusqu'à ce que quelqu'un paie la rançon en monnaie du serveur (plafond de durée).
- [ ] 119. **`/malediction @membre`** : 1 message sur 5 est remplacé par une phrase gênante choisie au hasard.
- [ ] 120. **`/cible @membre`** : pendant 10 min, chaque membre qui le mentionne gagne un peu de monnaie.

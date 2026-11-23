# PND Assist V5 — démarrage de la recette locale

Cette archive est une **copie de travail**. Elle ne déploie rien sur le VPS et ne modifie aucun secret.

## Sur le PC / Chromebook Linux

1. Extraire entièrement `PND_Assist_V5_PRET_POUR_TESTS.zip`.
2. Ouvrir un terminal dans le dossier `PND_Assist_V5_FINAL_UPDATED`.
3. Vérifier que Node.js 24 ou supérieur est installé :
   ```bash
   node -v
   npm -v
   ```
4. Lancer :
   ```bash
   ./PREPARER_TESTS_PND.sh
   ```
5. Attendre la fin. Le rapport sera créé dans `PND_V5_LOCAL_TEST_REPORT.txt`.

Le script installe les dépendances avec les fichiers lock, lance les tests du bot, vérifie la syntaxe JS, lance les tests dashboard, ESLint, TypeScript si configuré et le build. Il s'arrête au premier échec. Il exige Node 24 et **ne lance jamais de déploiement**.

## Avant les tests Discord réels

- Préparer un serveur Discord de test et un bot de test.
- Configurer `bot/.env` localement sans partager le fichier.
- Vérifier `DISCORD_TOKEN`, `SITE_URL`, `BOT_SYNC_SECRET`, `PND_OWNER_DISCORD_ID` et `PND_COFOUNDER_DISCORD_IDS`.
- Ne pas coller de token dans le chat et ne pas mettre de secrets dans l'archive.
- Vérifier les permissions du bot et sa hiérarchie de rôles dans le serveur de test.
- Enregistrer les commandes dans le serveur de test avant de tester les slash commands.
- Tester les modules à risque : SYS+/ADMIN+, `/rank`, `/rankall`, `/wakeup`, `/wouaf`, tickets, CAPTCHA, logs et webhooks.
- Ne pas déployer en production tant que le rapport n'est pas entièrement vert et que les scénarios Discord ne sont pas validés.

## Important — état vérifié au 19 novembre 2026

Dans l'environnement de préparation de cette archive, Node 22.16.0 est disponible, alors que le projet exige Node >=24. Le dernier lancement des tests bot a donné 294 tests réussis et 32 échecs de chargement, principalement car `discord.js` n'était pas installé dans cet environnement. Une tentative d'installation des dépendances a expiré. Cela ne permet pas de déclarer la suite complète validée.

Le script fourni réinstalle les dépendances sur la machine locale avec Node 24 et permet de produire un résultat fiable sur le PC. Il ne remplace pas les tests interactifs sur Discord.

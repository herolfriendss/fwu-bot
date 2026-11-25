# Her? V5 — état de l'implémentation

Dernière passe de travail : 12 novembre 2026.

## Intégré dans cette copie de travail

- Conservation des modules V4 et de leur registre partagé de commandes slash.
- Journal central par serveur et raccordements d'événements existants.
- Join-to-Create et persistance SQLite.
- DOG / MENOTTE / rôles / permissions vocales selon les modules présents.
- CAPTCHA par défi de calcul et persistance du défi.
- Alertes LIVE basées sur flux RSS/Atom HTTPS fournis par l'administrateur ; ce n'est pas une intégration API native universelle TikTok/YouTube/Twitch.
- Gestionnaire Webhooks `/webhook` : create, list, delete, publish, edit (dernier message).
- Chiffrement AES-256-GCM des tokens webhook ; clé obligatoire `WEBHOOK_ENCRYPTION_KEY`.

## Vérifications réellement exécutées dans cette passe

- `node --check bot/webhooks.js` : OK.
- `node --check bot/index.js` : OK.
- `node --check bot/webhooks-crypto.js` : OK.
- Chargement TypeScript natif du registre slash : 78 commandes, dont `webhook` : OK.
- 15 tests Node disponibles (DOG, rôles, permissions vocales, chiffrement Webhooks) : 15/15 réussis.

## À valider avant production

- Exécuter les tests complets du dépôt et le build dashboard avec Node 24.
- Vérifier l'enregistrement effectif des commandes Discord dans les deux serveurs autorisés.
- Test Discord réel du gestionnaire Webhooks avec permissions et hiérarchie réelles.
- Définir et sauvegarder `WEBHOOK_ENCRYPTION_KEY` sur le VPS avant d'utiliser `/webhook`.
- Valider les flux LIVE par créateur et plateforme : un flux RSS classique ne garantit pas l'événement LIVE de toutes les plateformes.
- Effectuer la recette de chaque module sur serveur de test avant déploiement.

Aucun déploiement de production n'a été effectué.

## Identité visuelle / Webhooks — passe complémentaire

- Thème noir et violet appliqué au dashboard avec cartes glass / glow et fond cityscape animé.
- Bannière GIF commune ajoutée dans `public/media/her-v5-city-loop.gif` (12 images, boucle lente, 960×320).
- Panneaux Discord SYS+, rôles, tickets, GuildGuard, voice et Webhooks utilisent l'accent violet et l'image de marque.
- `/webhook animation etat:on|off` gère l'animation de tous les webhooks du serveur ; l'option `id` permet de cibler un webhook.
- Nouveaux webhooks animés par défaut ; migration SQLite additive `animation_enabled`, conservant les lignes existantes.
- Publication et modification webhook affichent un embed brandé ; `/webhook list` indique l'état de l'animation.
- Tests isolés du thème : 4/4 réussis ; migration SQLite fraîche : vérifiée ; syntaxe des fichiers JS modifiés : vérifiée.
- Limite de validation : les dépendances `discord.js` et les dépendances racine sont incomplètes dans l'environnement courant, ce qui empêche le test complet du bot et le build dashboard ici.

## Passe complémentaire — mémoire IA, logs et identité LIVE (12 novembre 2026)

- Mémoire IA soumise à deux accords : activation serveur par l'équipe et consentement individuel du membre.
- Commandes `/ia memoire`, `/ia oublier`, `=ia memoire on|off`, `=ia oublier` ; contexte isolé par serveur/membre, 12 messages maximum, rétention de 30 jours.
- Révocation du consentement et suppression de la mémoire via le bot ; désactivation du réglage serveur purge les lignes de mémoire du serveur.
- Journaux centralisés enrichis pour les commandes de modules, les événements de rôles, salons, bannissements, voix et suppressions de messages, sans enregistrer le contenu des messages ni les arguments privés.
- Le dashboard ne propose plus de sélecteurs de logs séparés pour tickets/modération/GuildGuard : le canal central `logs.channelId` est la configuration destinée à l'utilisateur. Les anciens champs sont conservés pour compatibilité historique.
- Panneaux/résultats PND, social, cartes, jeux et musique reprennent l'accent et le pied de page Her?.
- Les deux illustrations LIVE fournies ont été intégrées sous forme de GIF animés authentiques (`her-v5-live-alert-main.gif`, `her-v5-live-alert-grid.gif`). TikTok utilise la variante grille ; YouTube/Twitch/autres utilisent la bannière principale.
- Les alertes LIVE sont maintenant des embeds brandés avec lien direct, bannière animée par défaut, et option `liveAlerts.animated` dans le dashboard pour désactiver l'animation.
- Un événement LIVE n'est marqué comme traité qu'après publication Discord réussie afin de permettre une nouvelle tentative après une erreur temporaire.
- Tests bot exécutés : 40/40 réussis sous Node 22.16.0 ; tous les fichiers JavaScript du bot passent `node --check`.

## Limites de validation restantes

- Cette sandbox n'a pas accès au réseau DNS nécessaire pour télécharger Node 24.22.2 ; elle est donc restée sous Node 22.16.0 pendant les tests locaux.
- Dépendances racine absentes (`vitest`, `vite`, `vite/client`) : tests Vitest, type-check et build dashboard non exécutables dans cette sandbox.
- Les tests bot ne remplacent pas une recette sur Discord réel : enregistrement des interactions, permissions réelles, images publiques HTTPS, clés d'encryption et flux LIVE de chaque créateur doivent être vérifiés sur un serveur de test.
- Aucun déploiement de production n'a été effectué.


## Reprise depuis l’archive utilisateur — 18 novembre 2026

- `/rankall role` et `=rankall @rôle` ajoutés au catalogue partagé et au routeur bot. Réservés aux propriétaires configurés dans `PND_OWNER_DISCORD_ID`; aperçu préalable, confirmation auteur-only de 60 secondes, contrôles de hiérarchie/permissions avant chaque attribution et audit central.
- Tests ciblés de politique : 8/8 réussis sous Node 22.16.0 dans l’environnement d’édition.
- À faire avant validation : suite complète avec Node 24, lint, typecheck, build dashboard, recette Gateway sur bot/guild dédiés.
- L’archive ZIP est source-only et ne contient pas `.git`; ne pas recréer ni revendiquer un historique Git antérieur.

# Her? V4 — état du travail

## Intégré dans Her? V4

- [x] Évolution en place de Her? V3, sans second projet ni service parallèle ; le dossier V2 reste intact.
- [x] Node.js 24 requis par le dashboard et le bot ; sortie Nitro Node prévue pour Oracle.
- [x] Commandes slash partagées entre le dashboard et le bot via `src/lib/slash-commands.ts`.
- [x] Enregistrement Discord fusionné commande par commande (jamais de `PUT` global qui effacerait les commandes personnalisées).
- [x] Conversion des commandes économie, DOG, vocal, musique et radio en slash commands, avec réutilisation exacte des gestionnaires préfixés.
- [x] Anciennes commandes `=` conservées pendant la transition.
- [x] Commandes personnalisées créées depuis le dashboard résolues par le bot via `bot-sync`.
- [x] Instantané PND borné envoyé au dashboard toutes les 5 minutes ; SQLite reste la source de vérité.
- [x] Page `/economie` protégée par l’accès propriétaire : totaux, classement et boutique.
- [x] Script d’export JSON en lecture seule : `npm --prefix bot run export:economy`.
- [x] DOG : rôle serveur marqueur sans permission, restauration du rôle et du surnom, retour vocal du membre connecté au vocal de son propriétaire.
- [x] Vocal : `/access`, `/unaccess`, panneau author-bound et verrouillage/restauration Connect.
- [x] Anti-rejeu persistant des interactions Discord via Supabase.
- [x] Comparaison constante du secret `BOT_SYNC_SECRET` ; cache Discord borné ; erreurs Discord sans corps brut.
- [x] Anti-spam appliqué avant les commandes intégrées et nettoyage périodique de son état mémoire.
- [x] Musique : file plafonnée à 100 titres, cooldown et playlist limitée par requête.
- [x] Radio PartyNextDoor 24/7 configurable avec `/radio set`, reprise au démarrage et reconnexion.
- [x] Économie PND persistante en SQLite : soldes, journal, bonus quotidien, transferts, boutique de rôles, commandes admin et classement.
- [x] Roulette et blackjack interactif ; mises remboursées après expiration/redémarrage de partie.
- [x] Tests automatiques de l’économie, du statut, des commandes et des règles vocales.

## À terminer avant une mise en service réelle

- [ ] Appliquer la migration `202611040001_bot_economy_snapshots.sql` au projet Supabase, après sauvegarde.
- [ ] Valider les commandes sur un serveur Discord privé : permissions/hiérarchie DOG, achat de rôles, lecture radio, reprise après redémarrage.
- [ ] Renseigner les vrais secrets (`.env`, `bot/.env`), le domaine HTTPS, la playlist YouTube et les identifiants du salon vocal.
- [ ] Vérifier la consommation mémoire et ajuster les seuils PM2 sur l’instance Oracle.
- [ ] Vérifier l’affichage `/economie` après la première synchronisation du bot.

## Données et sauvegardes

`bot/data/economy.sqlite` reste la base de référence. L’instantané Supabase sert uniquement à l’affichage et peut être recréé par le bot. Ne supprime jamais la base SQLite avant d’avoir validé un export JSON et une sauvegarde de l’hôte.

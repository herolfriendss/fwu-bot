# Her? V3 — état du travail

## Intégré dans la copie V3

- [x] Copie de travail distincte; le dossier V2 reste intact.
- [x] Node.js 24 requis par le dashboard et le bot; sortie Nitro Node prévue pour Oracle.
- [x] DOG : rôle serveur marqueur sans permission, restauration du rôle et du surnom sur événements, retour vocal du membre connecté au vocal de son propriétaire.
- [x] Vocal : `=access`, `=unaccess`, panneau author-bound et verrouillage/restauration Connect.
- [x] Modération, commandes préfixées, synchronisation web et interactions slash signées conservées depuis V2.
- [x] Anti-rejeu persistant des interactions Discord via Supabase; migration dédiée.
- [x] Comparaison constante du secret BOT_SYNC_SECRET; cache Discord borné; erreurs Discord sans corps brut dans les journaux.
- [x] Anti-spam appliqué avant les commandes intégrées et nettoyage périodique de son état mémoire.
- [x] Musique : file plafonnée à 100 titres, cooldown et playlist limitée par requête.
- [x] Radio PartyNextDoor 24/7 configurable par un admin avec `=radio set #salon URL_PLAYLIST_YOUTUBE`; reprise au démarrage, boucle de playlist, contrôles protégés et reconnexion.
- [x] Économie PND persistante en SQLite : soldes, journal des transactions, bonus quotidien, transferts, boutique de rôles, commandes admin et classement.
- [x] Roulette et blackjack interactif; mises remboursées après expiration/redémarrage de partie.
- [x] Guide Oracle Linux 9, PM2, Nginx, exemples `.env` et configuration systemd générée par PM2.

## À terminer avant une mise en service réelle

- [ ] Installer les dépendances avec accès à npm; la résolution est bloquée ici par DNS (`EAI_AGAIN registry.npmjs.org`). Aucun `package-lock.json` n’a donc pu être généré.
- [ ] Compiler le dashboard avec le preset `node_server` et corriger toute incompatibilité de build/type éventuelle.
- [ ] Valider les commandes sur un serveur Discord privé, notamment les permissions/hierarchie du rôle DOG, l’achat de rôles, la lecture radio et la reprise après redémarrage.
- [ ] Appliquer les migrations Supabase V3 au bon projet, en sauvegardant d’abord la base et en vérifiant les privilèges service_role.
- [ ] Renseigner les vrais secrets (`.env`, `bot/.env`), le domaine HTTPS, la playlist YouTube et les identifiants du salon vocal.
- [ ] Vérifier la consommation mémoire et ajuster les seuils PM2 sur l’instance Oracle avant le déploiement.

## Non exécuté

Aucun test automatique n’a été lancé. Aucune dépendance n’a été installée. Le serveur Oracle, Discord et Supabase n’ont pas été contactés ni modifiés. La compilation n’a pas été produite ici.

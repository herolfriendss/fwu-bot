# PND Assist V5 — reprise globale (20 novembre 2026)

## Ce qui est présent dans cette copie

- Base du projet issue de `PND_Assist_V5_MUSIC_YOUTUBE_PATCH.zip`.
- Politique Owner unique : `PND_OWNER_DISCORD_ID` est la seule identité propriétaire ; les anciens paramètres Cofondateur sont ignorés par `pnd-owner-policy.js`.
- SYS+ et administration restent deux contrôles séparés dans les politiques existantes. SYS+ ne donne pas de droit de configuration SYS+ ; seul l'Owner configuré peut configurer SYS+.
- Résolveur musical YouTube/SoundCloud et recherche par titre via `yt-dlp`, flux HTTPS validé puis transcodage FFmpeg en Opus/Ogg pour Discord.
- Correctif tickets : verrou en mémoire par membre/serveur pendant la création pour réduire les doubles tickets déclenchés par des clics simultanés ; correction de l'acquittement des boutons claim/close pour éviter une seconde réponse Discord après un premier reply/defer.

## Validation exécutée ici

Runtime utilisé pour les tests : Node `v24.11.1` (binaire Playwright embarqué). Le `node` global de l'environnement reste en v22 ; le binaire Node 24 doit donc être ajouté au PATH explicitement.

Tests ciblés : **25/25 réussis** (musique, politique de source audio, résolveur, tickets-policy, politique Owner et permissions SYS+).

Suite étendue : **338 tests détectés, 311 réussis, 27 échecs**. Une partie importante des échecs est due à `discord.js` absent ; d'autres tests révèlent des attentes historiques incompatibles avec la politique Owner unique et devront être réconciliés sans réintroduire plusieurs Owners. Un test anti-move et un test de workflow recrutement échouent aussi indépendamment de l'absence du paquet. Ne pas annoncer la suite globale comme verte.

L'installation `npm install` a été tentée sous Node 24 mais a expiré ; `discord.js` n'est donc pas installé dans cet environnement. Aucun test réel de gateway Discord, d'interaction Discord ou de lecture vocale réelle n'a été exécuté.

## Préparation musique sur le VPS

Prérequis : Node 24+, `discord.js` du lockfile, `@discordjs/voice`, FFmpeg avec `libopus`, `yt-dlp` récent. Le bot ne lit pas le flux Spotify protégé ; il reconnaît uniquement les sources implémentées et autorisées (YouTube/SoundCloud, recherches, flux audio HTTPS configurés). Les vidéos privées, restreintes, géobloquées ou nécessitant une session ne sont pas garanties et ne doivent pas être contournées.

Sur Oracle Linux, vérifier les paquets disponibles avant installation :

```bash
node --version
npm --version
ffmpeg -version
python3 --version
python3 -m pip install --user --upgrade yt-dlp
~/.local/bin/yt-dlp --version
```

Dans `bot/.env`, si nécessaire :

```dotenv
PND_YTDLP_PATH=/home/USER/.local/bin/yt-dlp
PND_FFMPEG_PATH=/usr/bin/ffmpeg
```

Puis dans le dossier `bot` :

```bash
npm ci
npm test
```

Ne redémarrer PM2 qu'après validation et sauvegarde de la base/configuration.

## À terminer avant d'appeler V5 prête pour production

1. Installer les dépendances depuis le poste/VPS avec accès npm et exécuter la suite complète.
2. Tester `/play` et `=play` sur un serveur Discord réel : YouTube URL, recherche, SoundCloud, skip, pause, reprise, reconnexion vocale, file par serveur et radios.
3. Tester le cycle ticket réel : publication du panneau, ouverture, permissions privées, claim, add/remove, close, logs et suppression manuelle du salon.
4. Terminer et tester le centre `/setup` : activation/désactivation de tous les modules, configuration par serveur, prévisualisation et rollback.
5. Implémenter le système PND Knowledge/Guide pour publier et maintenir les embeds Permissions, Recrutement, Tickets, Règlement, Guide serveur et Guide SYS+.
6. Implémenter le panel SYS+ de création de rôles personnalisés avec quotas, validation de nom/couleur, hiérarchie, refus des permissions dangereuses et suppression/édition contrôlées.
7. Appliquer explicitement la hiérarchie PND : Owner unique ; Administrateurs délégués ; SYS+ ; SYS ; Modération ; OG/Cercle privé ; Membre. Ces niveaux doivent être vérifiés indépendamment, sans faire de SYS+ un rôle administrateur.
8. Nettoyer les commandes réellement dupliquées sans retirer les actions distinctes ni leurs équivalents préfixés.

## Sécurité / production

- Aucun déploiement n'a été effectué sur le VPS.
- Ne pas partager `.env`, tokens Discord, clés API ou secrets de synchronisation.
- Les droits Discord du bot doivent rester minimaux mais suffisants (gestion des salons/rôles uniquement pour les modules qui en ont besoin).
- Les permissions internes du bot ne peuvent pas dépasser les permissions Discord réellement accordées au bot.


## Correctifs de reprise supplémentaires — 20 novembre 2026 (session suivante)

- Séparation effective SYS+ / ADMIN+ : un rôle SYS+ n'est plus ajouté implicitement au tier ADMIN+ et ne peut plus utiliser les scopes administratifs via `canUseAdminPlusScope`.
- ADMIN+ reste un rôle distinct, limité aux scopes explicitement activés par le Owner PND.
- Le Owner PND configuré dans `PND_OWNER_DISCORD_ID` conserve le bypass des scopes ADMIN+, même si un scope est désactivé.
- La gestion des membres SYS+ (`/sysp add` et `/sysp remove`) vérifie désormais le Owner PND configuré au lieu du propriétaire Discord de chaque serveur. Les permissions et la hiérarchie natives de Discord restent obligatoires pour que le bot attribue le rôle.
- La configuration des rôles SYS+, ADMIN+, WHITELIST, PND Intelligence et des scopes ADMIN+ affiche désormais clairement que le contrôle appartient au Owner PND unique.
- Les tests historiques qui supposaient que SYS+ impliquait ADMIN+ ont été réécrits selon la séparation confirmée par l'utilisateur.

Vérifications ciblées après ces changements : voir `PND_V5_SESSION_PROGRESS_2026-11-20.md`. Ces vérifications n'incluent pas une connexion Gateway Discord ni un déploiement.

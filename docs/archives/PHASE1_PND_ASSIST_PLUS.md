# Phase 1 — workspace sécurisé et validation de référence

Rapport des vérifications menées le 14 novembre 2026. Aucun code n’a été modifié. Tests exécutés avec les scripts existants et dépendances présentes ; aucune installation, migration ou déploiement. Aucun secret n’est affiché.

## Résumé exécutif

- **Node/npm** : Node v24.22.2 et npm 11.19.1 installés via NVM. Le PATH fourni aux shells de l’agent ne contenait pas Node ; NVM ne sélectionne pas automatiquement une version dans un shell non interactif.
- **Tests** : bot 11/11 ; racine 165/165 dans 28 fichiers avec un worker Vitest. La suite racine par défaut a stagné ; l’exécution séquentielle a produit le résultat complet.
- **Sauvegarde** : archive source-only vérifiée, 308 éléments, 2 024 072 octets, zéro violation. SHA256 en section 3.
- **Git** : .git du workspace vide. Les dépôts voisins sont V3/V4 et ne sont pas une base sûre pour V5. Au contrôle final, her-v3 présentait 244 entrées de statut ; sa différence avec le statut propre observé en Phase 0 n’est pas expliquée.
- **Audio** : dépendances centrales présentes ; le rapport @discordjs/voice ne détecte pas de bibliothèque Opus, de bibliothèque de chiffrement ou FFmpeg empaqueté. FFmpeg système existe. Recette vocale staging nécessaire.
- **Mission recommandée** : fiabiliser musique/radio en staging après confirmation de l’historique Git V5 et préparation d’une application Discord de test.

## 1. Node et npm

package.json, package-lock.json, bot/package.json et bot/package-lock.json exigent Node >=24 (lockfiles version 3). HER-V5-VALIDATION-BLOCKERS.md précise Node 24.22.2 et npm 11.19.1 ; ces versions ont été vérifiées.

- Node : /home/randoinryan/.config/nvm/versions/node/v24.22.2/bin/node
- npm : /home/randoinryan/.config/nvm/versions/node/v24.22.2/bin/npm
- NVM : /home/randoinryan/.config/nvm/nvm.sh

Le PATH de la session omet le répertoire Node. Le .bashrc retourne avant les lignes de chargement NVM pour les shells non interactifs ; charger NVM ne sélectionne pas non plus automatiquement la version. Le lanceur npm exige node dans le PATH.

Commande validée, limitée au shell courant :

    export NVM_DIR=/home/randoinryan/.config/nvm
    . "$NVM_DIR/nvm.sh"
    nvm use 24.22.2
    node --version
    npm --version

Résultats : v24.22.2 et 11.19.1. Aucune installation nécessaire. node_modules racine et bot étaient déjà présents.

## 2. Tests de référence

Scripts examinés avant exécution :

- Racine, package.json : test = vitest run.
- Bot, bot/package.json : test = node --test systems/sysplus/*.test.js *.test.js.

**Bot — commande exacte :**

    npm --prefix bot test

Résultat : 11 réussis, 0 échec, code 0. Tests Node couvrant notamment politiques DOG, permissions, rôles, logs, thème, mémoire IA et chiffrement webhook. Le test de préférences IA utilise une base et un répertoire temporaires.

**Racine — commande exacte ayant terminé :**

    npm test -- --maxWorkers=1 --reporter=verbose

Résultat : 28 fichiers réussis, 165 tests réussis, aucun échec, code 0. database-flows.test.ts définit HER_DB_PATH vers une base temporaire et ne cible pas bot/data/economy.sqlite. Les tests d’interaction simulent les échanges pertinents ; ils ne testent pas Discord réel. Aucun test ne valide le lecteur audio en direct.

Tentatives et limites :

- npm test sans limite de workers n’a pas terminé : Vitest a affiché database-flows avec 12 tests ignorés, puis n’a fourni aucun résumé final. L’exécution a été interrompue ; elle n’est pas comptée comme réussite.
- npm test -- --maxWorkers=1 --minWorkers=1 --reporter=verbose a échoué avant la suite : Vitest 4.1.12 ne reconnaît pas --minWorkers.
- La commande séquentielle valide a ensuite passé l’ensemble des tests.
- Aucun lint, build, typecheck, test Discord réel ou test audio live exécuté.

## 3. Sauvegarde source-only

Archive créée dans le dossier approuvé hors workspace :

/home/randoinryan/pnd-assist-backups/her-v5-build-source-20261114.tar.gz

- Taille : **2 024 072 octets**
- Membres : **308**
- SHA256 : **6a759fbc9dadd99d73a9d3b3afb11c5d5dd48157d6a40ed4a03fdf6fb1f8ba24**
- Racine d’archivage : tar -C /home/randoinryan her-v5-build

Une première vérification a détecté .output et .tanstack à la racine ; l’archive a été recréée avec exclusions explicites. Vérification finale : **0 violation**.

Le contrôle vérifiait l’absence de .git, tous les .env*, noms contenant secret/credential, node_modules, bot/data, bases SQLite/DB, caches (.output, .tanstack, .cache, .vite, .nitro), builds (dist, build, coverage), temporaires, téléchargements et archives ZIP/TAR/GZ/TGZ/7z/RAR. Aucun original déplacé ou supprimé. L’archive est un instantané source, sans historique Git ni données locales.

## 4. Diagnostic musique et radio

Emplacements principaux :

- Moteur : bot/music/music.js ; politique : bot/music/music-policy.js.
- Test unitaire : src/test/music-policy.test.ts.
- Définitions slash : src/lib/slash-commands.ts:847-907.
- Adaptation slash : bot/v4-commands.js:205-255.
- Dispatch : bot/index.js:729-732 ; autostart radio : bot/index.js:528-530.

Dépendances déclarées dans bot/package.json : discord.js ^14.16.3, @discordjs/voice ^0.18.0, play-dl ^1.9.7. Versions installées : discord.js 14.28.0, @discordjs/voice 0.18.0, play-dl 1.9.7, prism-media 1.3.5. discord.js respecte la plage déclarée.

**Chaîne observée :**

1. Recherche YouTube par play.search(), résolution d’URL/playlist dans bot/music/music.js:81-116.
2. play.stream(track.url, { quality: 2 }) puis createAudioResource() avec le flux et son type (207-217).
3. Vérification Connect/Speak, connexion au vocal et attente de Ready (148-197).
4. File et reprise dans advance() ; radio persistée dans bot/data/radio-config.json, autostart et reconnexion (54-71, 220-301).

Les sources repérées sont recherche, URL vidéo et playlist YouTube. Aucune intégration Spotify/SoundCloud repérée. play-dl déclare les types arbitrary, raw, ogg/opus, webm/opus et opus ; le type réel retourné dans le contexte de lecture n’a pas été mesuré.

**Dépendances audio vérifiées :**

- @discordjs/opus, opusscript et node-opus absents de bot/node_modules.
- Le rapport de @discordjs/voice ne détecte aucune bibliothèque de chiffrement reconnue.
- Le rapport n’identifie pas FFmpeg ; pourtant /usr/bin/ffmpeg et /usr/bin/ffprobe existent au niveau système.
- Le code transmet le type fourni par play-dl et n’invoque pas directement FFmpeg. L’encodeur/FFmpeg nécessaire dépend du flux précis ; le chiffrement doit être validé avec une connexion staging réelle. Ne rien installer avant mesure.

**Risques et protocole :**

- playlist.all_videos() charge les vidéos avant slice() (bot/music/music.js:97-105), donc la limite actuelle ne borne pas le téléchargement de métadonnées. Passer à une pagination ou une limite appliquée pendant la récupération.
- YouTube peut changer son extraction ou refuser une source ; ajouter des diagnostics par étape (résolution, flux, lecture), sans contenu privé ni secret.
- connectMember() accepte GuildStageVoice (199-204), mais connectChannel() refuse tout type autre que GuildVoice (148-155) : clarifier ce comportement.
- Une radio active bloque les commandes musicales standard (ligne 402). Autostart et reconnexion existent mais n’ont pas été vérifiés sur Discord réel.
- src/test/music-policy.test.ts teste uniquement l’obligation d’être dans le même vocal. Aucun test repéré ne couvre extraction, Opus, chiffrement, player, reconnexion ou radio.

Recette recommandée : application bot et serveur de test distincts ; valider connexion seule, titre unique, playlist bornée, skip/stop, erreur de flux, perte/reprise vocale, radio et autostart après redémarrage. Consigner types de flux et dépendances détectées.

## 5. Git et récupération de l’historique

Le .git de her-v5-build est vide ; git status, git rev-parse et git log échouent avec fatal: not a git repository. Aucun git init, copie d’historique ou réécriture effectués.

her-v3 et her-v3-sauvegarde ont des historiques V3/V4 (derniers commits observés le 4 novembre et le 1er novembre) et le même remote. Ils ne contiennent pas l’historique complet V5 et ne doivent pas être attachés à ce workspace comme source de vérité.

Évolution de statut observée : her-v3 était initialement propre, main en avance de deux commits. Lors d’une vérification ultérieure, son statut affichait 244 entrées, dont de nombreux fichiers suivis supprimés et node_modules/.output non suivis. her-v3-sauvegarde était propre. L’origine de ce changement n’est pas déterminée ; aucune commande de cette phase n’a intentionnellement modifié ces dépôts. Ne pas tenter de réparer her-v3 dans cette phase.

Options sûres : récupérer le checkout Lovable correspondant à la version V5 actuelle ; demander un bundle/clone de la branche V5 confirmée ; comparer les fichiers et hashes avant rétablissement du versionnement. Ne pas utiliser l’historique V3/V4 par simple similitude de nom.

## 6. Serveur de recette et validations restantes

Conditions de recette :

- application bot de test distincte, invitée uniquement dans un serveur dédié ;
- allowlist limitée à ce serveur, configuration et endpoint/secret de staging distincts, aucun accès production ;
- intents de bot définis dans bot/index.js:134-136 : Guilds, GuildVoiceStates, GuildMessages, MessageContent, GuildMembers ; Message Content et Server Members sont privilégiés et doivent être activés pour le bot de test ;
- Connect/Speak pour la musique, rôle bot bien positionné, droits DOG/MENOTTE uniquement si ces tests sont activés ;
- salon vocal standard pour la première recette ; tester Stage après décision produit ;
- MZ reste inactif.

Validations humaines restantes :

1. Confirmer/fournir la source Git de la version V5 pour revue et retour arrière.
2. Confirmer l’application Discord de test, son serveur et un administrateur pouvant configurer intents/permissions.
3. Valider le comportement Stage et la priorité entre radio et musique.
4. L’administrateur configure directement les secrets de test hors du rapport.
5. Garder PND/MZ isolés, MZ désactivé jusqu’à validation, administration cible Discord First sans dashboard obligatoire, et aucun système de factions.
6. N’ajouter une dépendance audio qu’après constat mesuré et vérification Node 24/lockfiles.

## 7. Première mission de développement recommandée

**Fiabiliser musique/radio en staging, sans connexion à la production :**

1. Confirmer le checkout/historique Git V5.
2. Préparer l’application bot et le serveur de recette distincts.
3. Mesurer le type de flux play-dl, la disponibilité du chiffrement, d’Opus et de FFmpeg depuis le processus Node.
4. Rendre la récupération des playlists réellement bornée.
5. Ajouter une instrumentation par étape et des tests ciblés.
6. Valider titre, playlist, contrôles, erreurs, reconnexion, radio et autostart après redémarrage.
7. N’ajouter un paquet qu’après avoir établi le besoin.

**Recommandation finale :** lancer cette mission dès que le checkout V5 et le serveur de recette sont confirmés. La priorité est la musique/radio ; préserver la séparation PND/MZ et laisser MZ désactivé pendant les tests.

## Synthèse des vérifications

- Node/npm conformes aux versions attendues via NVM.
- Bot : 11/11 tests ; racine : 165/165 dans 28 fichiers avec un worker.
- Sauvegarde : 308 éléments, 0 violation, SHA256 indiqué ci-dessus.
- Git : métadonnées absentes du workspace ; dépôts voisins V3/V4 impropres à restaurer V5.
- Audio : paquets principaux présents ; Opus/chiffrement non détectés ; FFmpeg système présent mais non détecté par le rapport du package.
- Aucun code modifié, aucune dépendance installée, aucune migration ni aucun déploiement Oracle.

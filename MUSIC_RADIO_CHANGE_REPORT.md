# PND Assist + — rapport musique et radio

Date : 14 novembre 2026  
Branche locale : `feat/music-radio-stabilization`  
Commit examiné : `e3e5429` (`fix: bound music playlists and add voice cipher`)

## Résumé exécutif

Le commit étudié touche six fichiers. Il borne le chargement des playlists YouTube à la première page chargée par `play-dl` et ajoute `@noble/ciphers` comme fournisseur de chiffrement vocal compatible avec `@discordjs/voice`. Cette dépendance rend disponible un fournisseur ; elle ne prouve pas qu’une négociation vocale Discord fonctionne en conditions réelles.

J’ai complété le lot avec des politiques pures pour les transitions de file/radio et pause/reprise, puis extrait le cycle d’avance dans un moteur injectable pour tester les échecs de lecture et les reprises sans Gateway Discord. Les 8 tests ciblés, les 11 tests bot, les 172 tests globaux, le build et le lint ciblé passent. TypeScript reste en échec sur le schéma Supabase et un ancien test, sans erreur dans les changements musicaux actuels. Le lint global reste en échec sur des milliers d’écarts de formatage existants.

Aucun `.env` local ni bot Discord de recette n’est configuré. Aucun token de production n’a été utilisé et aucune connexion Discord n’a été lancée. Une validation vocale réelle reste bloquée jusqu’à la création ou la fourniture d’une application Discord et d’un serveur de recette isolés, avec un backend de recette séparé.

## 1. Inspection de `e3e5429`

Diff complet inspecté avec `git show --no-ext-diff --unified=80 e3e5429`. Les six fichiers concernés étaient :

| Fichier                         | Modification du commit                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `bot/music/music-policy.js`     | Ajout de `initialPlaylistVideos`, qui valide la limite et découpe `playlist.page(1)`.                      |
| `bot/music/music-engine.js`     | Pas présent dans `e3e5429` ; moteur ajouté après inspection pour exercer le cycle de lecture sans Discord. |
| `bot/music/music-policy.d.ts`   | Au commit, ne déclarait pas encore `initialPlaylistVideos`. Correction ajoutée ensuite dans le workspace.  |
| `bot/music/music.js`            | Remplace `await playlist.all_videos()` par la lecture bornée de la première page.                          |
| `bot/package.json`              | Ajoute `@noble/ciphers: ^1.3.0`.                                                                           |
| `bot/package-lock.json`         | Verrouille `@noble/ciphers` en version `1.3.0`.                                                            |
| `src/test/music-policy.test.ts` | Ajoute deux tests de borne et de non-appel de `all_videos()`.                                              |

Le fichier `bot/music/music-policy.d.ts` de l’état initial du commit ne déclarait pas le nouvel export : cela causait une erreur TypeScript introduite par le commit (`TS2305`). Sa déclaration est maintenant présente, avec celles des nouvelles politiques de transition.

## 2. Changements réalisés dans le workspace

- `bot/music/music-policy.js:7-40` : borne de playlist, sélection pure du prochain morceau (lecture, répétition titre/file, file vide, rechargement radio) et décision pause/reprise.
- `bot/music/music-engine.js:1-61` : orchestration injectable de l’avance, échec du flux, notification, répétition, rechargement radio et scheduling de reprise ; erreurs journalisées sous codes fixes, sans message brut.
- `bot/music/music-policy.d.ts:6-23` : types des helpers et transitions.
- `bot/music/music.js:12-17,225-275,530-533` : branchement de ces politiques dans le lecteur, conservation du traitement d’erreur et de l’annonce de lecture ; si la répétition d’un titre échoue, elle est désactivée et la file peut avancer.
- `src/test/music-policy.test.ts:16-85` : tests de borne playlist, limite invalide, avance après échec, répétition titre/file, rechargement radio et pause/reprise.

La documentation `play-dl` dans `bot/node_modules/play-dl/dist/index.d.ts:816-860` décrit `page(number)` comme l’accès à une page déjà récupérée et `all_videos()` comme le chargement de toutes les vidéos. `playlist_info(..., { incomplete: true })` est utilisé avant le prélèvement de la page. La requête peut donc encore traiter jusqu’à la première page initiale ; elle ne parcourt plus toutes les pages de la playlist.

L’installation de `@noble/ciphers` ne transforme pas les sources média et n’installe ni FFmpeg ni Opus. Elle fournit une option de chiffrement à `@discordjs/voice`. La négociation, le codec effectivement renvoyé par `play-dl` et la lecture jusqu’au salon doivent encore être observés sur Discord de recette.

**Précision sur le chiffrement après inspection de `@discordjs/voice 0.18.0` :** `e3e5429` ne modifie aucun code de chiffrement du bot; il ajoute `@noble/ciphers` dans le manifeste et le lockfile. Le paquet vocal charge dynamiquement des implémentations de chiffrement pour le mode `aead_xchacha20_poly1305_rtpsize`. Sous Node `24.22.2`, `node:crypto` annonce `aes-256-gcm` disponible, et `@discordjs/voice` place donc le mode natif `aead_aes256_gcm_rtpsize` en priorité lors de la négociation. `@noble/ciphers` reste le fournisseur de secours XChaCha si ce mode est choisi et n’est pas une preuve d’un handshake réussi. Vérification exécutée : `node -e "console.log(require('node:crypto').getCiphers().includes('aes-256-gcm'))"` depuis `bot/` — résultat `true`. La ligne de code visible dans `bot/music/music.js` concerne uniquement la borne de playlist; aucune primitive de chiffrement personnalisée n’y a été ajoutée.

## 3. Diagnostic TypeScript et séparation des erreurs

Commande exécutée : `./node_modules/.bin/tsc --noEmit --pretty false` (Node `v24.22.2`). Résultat : code 2.

- **Erreur introduite par `e3e5429`, corrigée dans le workspace :** export `initialPlaylistVideos` absent de `bot/music/music-policy.d.ts`, qui faisait échouer l’import du test TypeScript. Le contrôle courant ne signale plus `music-policy` ni `music.js`.
- **Erreurs préexistantes et hors des fichiers musicaux modifiés :** `src/lib/bot-settings.server.ts:27` et `src/routes/api/public/bot-sync.ts:78,119-146` utilisent la table `bot_ai_memory`, absente des types Supabase générés ; types de colonnes `guild_id`, `user_id`, `role`, `content` incompatibles ou inconnus. `src/test/bot-settings.test.ts:45` a une valeur possiblement `undefined` (`TS2532`). Ces fichiers ne figurent pas dans le commit ni dans les changements musicaux du workspace.

Le lint ciblé des politiques et tests passe. `bot/music/music.js` garde des erreurs Prettier préexistantes ; le lint global précédemment exécuté signalait 3 048 erreurs, essentiellement du formatage dans le dépôt. Le nouveau code n’a pas reçu de reformatage global.

## 4. Audio, dépendances et limites observées

Rapport exécuté depuis `bot/` avec `generateDependencyReport()` : `@discordjs/voice 0.18.0`, `prism-media 1.3.5`, `@noble/ciphers 1.3.0` reconnus. `@discordjs/opus`, `opusscript`, sodium et `@stablelib/xchacha20poly1305` absents. `ffmpeg` et `ffprobe` sont présents sur la machine sous `/usr/bin`, alors que le rapport de `@discordjs/voice` affiche FFmpeg « not found » ; il ne confirme donc pas leur découverte par résolution de paquet. Aucun Opus n’a été ajouté : les tests locaux ne déterminent pas encore si le flux `play-dl` de chaque source sera transmis en Opus sans transcodage.

Points à surveiller en recette : dépendance de `play-dl` envers les formats et l’accès réseau YouTube ; erreur de création de flux ou flux interrompu ; disponibilité d’un chemin Opus ou transcodage FFmpeg ; versions de Node/OS compatibles avec les modules natifs éventuels ; délais `Ready` et reconnection après perte du vocal. La radio recharge la playlist à file vide et programme une nouvelle tentative après erreur (30 s, `bot/music/music.js:241-250`) ; sa temporisation et la reconnexion réelle ne sont pas couvertes par une session Discord.

**Mise à jour du chantier — voie audio directe en cours :** le workspace retire `play-dl` et n’effectue plus de recherche/extraction YouTube ou Spotify. `/play` et la radio acceptent désormais des URL de flux audio HTTPS directes dont l’hôte a été explicitement autorisé pour le serveur (`=radio host-add`, `host-remove`, `host-list`). Les sources nécessitent toujours une vérification des droits et de la stabilité avant recette.

Fichiers modifiés dans ce lot : `bot/music/music.js`, nouveaux `bot/music/audio-source.js`, `bot/music/audio-source-policy.js` et leurs tests, `bot/package.json`, `bot/package-lock.json`, `bot/v4-commands.js`, `src/lib/slash-commands.ts`, `scripts/package-bot.py`. Le résolveur refuse HTTP, URL avec identifiants, paramètres de requête, fragments, hôte non listé, port personnalisé, IP littérale et redirections HTTP ; il résout l’hôte puis épingle une IPv4 publique pour empêcher une substitution DNS au moment de la connexion. FFmpeg reçoit l’entrée via stdin avec sa liste de protocoles limitée à `pipe`, encode en Ogg/Opus et le flux est transmis à `@discordjs/voice`. Les types MIME HLS/DASH sont refusés.

Les URL avec paramètres sont refusées volontairement pour empêcher le stockage courant de URL signées contenant des jetons. Les URL de flux à chemin signé restent dépendantes de la confiance accordée à l’administrateur qui autorise l’hôte. Aucun flux réel n’a été téléchargé et aucune connexion Discord n’a eu lieu.

## 5. Configuration de recette et scénarios

Contrôle de présence effectué sans lire de valeurs : `.env` et `bot/.env` sont absents. Les modèles `.env.example` et `bot/.env.example` listent les noms de paramètres usuels ; aucun paramètre ne démontre l’existence d’une application Discord de recette ou d’un token dédié. Les noms visibles incluent `DISCORD_TOKEN`, `SITE_URL`, `BOT_SYNC_SECRET` et `V4_ALLOWED_GUILD_IDS` ; aucune valeur secrète n’est reproduite dans ce rapport.

**Isolation impérative avant lancement :** créer/utiliser une application et un bot Discord de recette distincts, un serveur de test vide et un endpoint/backend de recette (ou mock isolé) avec un `BOT_SYNC_SECRET` différent. Stocker le token uniquement dans un `.env.staging` local ignoré par Git. Lancer explicitement `node --env-file=.env.staging index.js` depuis `bot/` ; le script standard `npm start` lit `.env`. Renseigner une allowlist non vide limitée au serveur de test : `bot/index.js:44-47` retombe autrement sur les identifiants de serveurs source et de logs codés dans `bot/logs-hub.js:2-5`. Ne pas utiliser l’URL ou les identifiants du backend de production.

Permissions de test minimales : voir le salon, se connecter et parler dans le vocal, envoyer des messages et intégrer des liens dans le salon texte de retour ; l’action de configuration radio exige `Gérer le serveur` ou `Administrateur` selon `bot/music/music.js:318`. Scénarios à consigner sans messages ou secrets bruts :

1. Connexion à un vocal classique et attente de l’état prêt ; vérifier permissions refusées puis accordées.
2. Lire une vidéo courte autorisée, vérifier titre, volume, audio réellement audible ; pause puis reprise.
3. Ajouter deux titres, skip vers le suivant ; tester file vide et répétition titre/file.
4. Provoquer une erreur de source et une interruption de flux ; vérifier message d’erreur, avance de file et absence de boucle de rejet.
5. Couper puis rétablir le vocal ; vérifier reconnexion et reprise de radio.
6. Configurer une playlist de recette, vérifier lecture initiale, épuisement/rechargement de la file, erreur réseau/reprise temporisée, puis arrêt et conservation/suppression de config.

Les scénarios Discord restent non exécutés : le serveur/app et le backend isolé ne sont pas configurés. Leur création/activation et la remise sécurisée d’un token de test sont les seules entrées humaines nécessaires à la recette live ; ne jamais les transmettre dans le chat.

## 6. Résultats des vérifications

| Commande                                                                                                                                     | Résultat                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test -- --maxWorkers=1 src/test/music-policy.test.ts`                                                                                   | 8 tests ciblés passés.                                                                                                                           |
| `npm test -- --maxWorkers=2 --reporter=dot`                                                                                                  | 28 fichiers, 172 tests passés après extraction du moteur.                                                                                        |
| `npm --prefix bot test`                                                                                                                      | 13 tests passés, dont politique de flux et résolution DNS épinglée.                                                                              |
| `npm run build`                                                                                                                              | Build client, SSR et Nitro réussi ; avertissements existants (API TanStack dépréciée, chunks client > 500 kB).                                   |
| `./node_modules/.bin/eslint bot/music/music-policy.js bot/music/music-policy.d.ts src/test/music-policy.test.ts`                             | Réussi.                                                                                                                                          |
| `node --check bot/music/music-policy.js` et `node --check bot/music/music.js`                                                                | Réussis.                                                                                                                                         |
| `./node_modules/.bin/tsc --noEmit --pretty false`                                                                                            | Échec sur les erreurs préexistantes listées en section 3 ; aucune erreur musicale courante.                                                      |
| `npx eslint bot/music/audio-source.js bot/music/audio-source-policy.js bot/music/audio-source.test.js bot/music/audio-source-policy.test.js` | Réussi après formatage des nouveaux modules.                                                                                                     |
| `python3 scripts/package-bot.py` + inspection ZIP                                                                                            | Archive inspectée : 66 entrées, fermeture des imports locaux, aucune entrée `.env`, `data/`, `node_modules/`, `.git/` ou nom contenant `secret`. |
| `npm run build`                                                                                                                              | Réussi après le changement de commandes et d’interface radio. Avertissements existants TanStack, taille de chunks et durée plugins.              |
| `generateDependencyReport()` ; `command -v ffmpeg`, `command -v ffprobe`                                                                     | Fournisseurs listés en section 4 ; FFmpeg et ffprobe système sous `/usr/bin`.                                                                    |

La suite bot a été étendue de 11 à 13 tests et passe. Les 8 tests ciblés des transitions musicales passent. La suite globale relancée avec `npx vitest run --maxWorkers=2 --reporter=dot` passe : 28 fichiers, 172 tests. Une commande intermédiaire a échoué avant tests à cause de l’option `--minWorkers` non prise en charge ; elle a été remplacée par la commande fonctionnelle ci-dessus. Aucun test n’a simulé une connexion réelle à Discord.

## 7. Archive, Git et suite proposée

Conformément à `AGENTS.md`, `python3 scripts/package-bot.py` a régénéré `public/downloads/bot-oracle.zip`. L’allowlist inclut le moteur musical, le fournisseur audio direct et ses politiques ; le script échoue si un import relatif manque au ZIP. Inspection : 66 entrées, ZIP intègre, aucune entrée `.env`, `data/`, `node_modules/`, `.git/` ou nom contenant `secret`. L’archive est ignorée par Git (`git check-ignore`). Aucune donnée de production n’a été lue ou changée.

Le commit local `e3e5429` a été inspecté ; les politiques/tests, le moteur injectable et la vérification de distribution sont dans `e1f86e5`, `0b691d3` et `0c62be1`. Le commit `fd4b445` remplace l’extraction YouTube par des flux HTTPS directs et retire `play-dl`. Aucun push ni déploiement n’a été réalisé. Étapes suivantes : (1) obtenir l’application/guilde/backend de recette isolés ; (2) sélectionner des hôtes audio fiables dont les droits d’utilisation sont établis ; (3) valider la connexion, le codec et l’audio audible sur recette. Aucun accès Oracle/VPS ni migration n’a eu lieu.

### Suite de la mission globale

#### Mise à jour musique/radio — 14 novembre 2026

Depuis les résultats ci-dessus, le chantier audio a reçu des corrections de readiness et reprise persistante. `bot/music/music-engine.js` ajoute `awaitVoiceReady`: une connexion qui expire avant `Ready` est détruite et retirée de l’état, sans effacer une connexion concurrente plus récente. `bot/music/music.js` attend maintenant `Ready` même lorsqu’elle réutilise une connexion existante. Les radios persistantes retentent après échec initial toutes les 30 secondes, avec une seule minuterie par guild, annulable par `=radio stop` et `=radio clear`. `src/test/music-policy.test.ts` couvre le timeout, la réussite, le remplacement concurrent et le retry uniquement si la configuration demeure actuelle.

Vérifications récentes :

| Commande/action                                                    | Résultat                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run src/test/music-policy.test.ts --maxWorkers=1`      | 12/12 réussis.                                                                                                                                                                                                                                                                        |
| `npm --prefix bot test`                                            | 28 fichiers de tests réussis.                                                                                                                                                                                                                                                         |
| `npx vitest run --maxWorkers=1`                                    | 28 fichiers, 183/183 réussis.                                                                                                                                                                                                                                                         |
| `npm run build`                                                    | Build client, SSR et Nitro réussi ; avertissements TanStack et chunks volumineux préexistants.                                                                                                                                                                                        |
| ESLint ciblé, `node --check` du lecteur/moteur, `git diff --check` | Réussis.                                                                                                                                                                                                                                                                              |
| FFmpeg/Opus système                                                | `/usr/bin/ffmpeg` contient `libopus`; le flux synthétique Ogg produit `opus,audio` avec `ffprobe`.                                                                                                                                                                                    |
| Pipeline audio local                                               | HTTPS mocké (aucune requête réseau) → `openAuthorizedAudioStream` → FFmpeg réel : 7 739 octets de sortie Ogg/Opus validés par `ffprobe`.                                                                                                                                              |
| Chiffrement                                                        | Round-trip local XChaCha20-Poly1305 via `@noble/ciphers` réussi ; aucun handshake Discord.                                                                                                                                                                                            |
| Dépendances                                                        | `@discordjs/voice 0.18.0` et `@noble/ciphers 1.3.0` détectés. Pas de `@discordjs/opus`/`opusscript`, non requis pour le flux Ogg/Opus entrant. `generateDependencyReport()` indique FFmpeg absent parce qu’il vérifie Prism, alors que le binaire système utilisé directement existe. |
| Archive source-only                                                | 96 entrées uniques, CRC et imports valides ; aucun `.env` réel, `data/`, `node_modules/` ou `.git/`. SHA256 `acecee0aadd759a5d6d5e56d7460eaed35e9553346857fb906cf1d9fef0813d6`.                                                                                                       |
| `npx tsc --noEmit --pretty false`                                  | Échec restant sur `bot_ai_memory` absent des types Supabase générés et la nullabilité préexistante de `src/test/bot-settings.test.ts:52`. Après correction du test ajouté, aucun diagnostic sur `bot/music/music-engine.d.ts` ou `src/test/music-policy.test.ts`.                     |

Checkpoints locaux : `2aa3606` missions PND, `3de66cf` reprise vocale/radio, `dc6a7aa` documentation codec, `f1af7ba` pipeline local et `79f5e51` typage du test. Aucun push, déploiement, token de production, accès Oracle ou Gateway Discord. La lecture audible et la négociation voice nécessitent toujours une application, une guild et un backend de recette séparés.

Après le commit local `fd4b445` (source audio directe), l’inspection des journaux a montré que le routage du hub n’avait pas de destinations distinctes PND/MZ. Le commit `ba0a198` sépare les catégories/canaux et rôles d’accès ; MZ reste désactivé dans l’allowlist runtime. Les catégories PND réutilisées ne sont pas réécrites ni leurs permissions modifiées automatiquement. Les tests de routage et d’identité des rôles sont dans `bot/logs-hub.test.js`. L’archive a depuis été étendue pour WHITELIST et inspectée : 70 entrées, aucun `.env`, `data/`, `node_modules/`, `.git/` ou nom contenant `secret`. Cette évolution ne touche aucun serveur ; l’ACL effective des catégories existantes reste à vérifier avant déploiement.

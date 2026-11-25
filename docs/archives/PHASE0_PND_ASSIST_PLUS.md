# Phase 0 — préparation sécurisée du développement

État relevé le 14 novembre 2026. Cette phase a consisté en des vérifications en lecture seule. Aucun code, donnée ou fichier de configuration n’a été modifié ; aucune dépendance installée, sauvegarde créée, migration lancée ou opération Oracle réalisée. Les secrets n’ont pas été affichés.

## 1. Environnement Node et npm

Les deux manifestes, `package.json` et `bot/package.json`, ainsi que leurs lockfiles (`package-lock.json`, `bot/package-lock.json`, lockfile v3), demandent Node `>=24`. `HER-V5-VALIDATION-BLOCKERS.md` précise Node 24.22.2 et npm 11.19.1.

Ces versions sont déjà installées sous :

- Node : `/home/randoinryan/.config/nvm/versions/node/v24.22.2/bin/node`
- npm : `/home/randoinryan/.config/nvm/versions/node/v24.22.2/bin/npm`
- NVM : `/home/randoinryan/.config/nvm/nvm.sh`

Versions vérifiées directement : Node `v24.22.2`, npm `11.19.1`. Les dossiers `node_modules/` racine et `bot/node_modules/` sont présents. Aucune installation n’est actuellement justifiée.

**Cause de l’absence dans le PATH :** le PATH fourni aux commandes ne comprend pas le répertoire de la version Node. NVM est placé dans `.config/nvm`, et le `.bashrc` contient une garde qui retourne pour les shells non interactifs avant ses lignes de chargement NVM. En outre, charger NVM ne sélectionne pas automatiquement Node sans `nvm use`. Le lanceur npm utilise `#!/usr/bin/env node`, donc échoue lui aussi lorsque Node n’est pas dans le PATH.

Commande à utiliser dans un sous-shell de développement, sans modifier la configuration globale :

\`\`\`bash
export NVM_DIR=/home/randoinryan/.config/nvm
. "$NVM_DIR/nvm.sh"
nvm use 24.22.2
node --version
npm --version
\`\`\`

Les modules réellement installés peuvent ensuite être comparés aux lockfiles. Les tests et le build n’ont pas été exécutés pendant la Phase 0.

## 2. Diagnostic Git et dépôt vide

Le répertoire `/home/randoinryan/her-v5-build/.git/` existe mais est vide. `git status`, `git rev-parse --show-toplevel` et `git log` y échouent avec `fatal: not a git repository (or any of the parent directories): .git`. Aucun `git init`, suppression ou réparation n’a été tenté.

Deux dépôts voisins possèdent un historique Git :

- `/home/randoinryan/her-v3` : branche `main`, deux commits d’avance sur `origin/main`, dernier commit le 4 novembre 2026.
- `/home/randoinryan/her-v3-sauvegarde` : branche `main`, historique plus ancien, dernier commit le 1er novembre 2026.

Leurs remotes pointent vers le même projet GitHub. L’URL a été vérifiée sans afficher d’identifiants. L’historique de `her-v3` correspond à Her? V3/V4 et ne contient pas les éléments V5 récents comme `bot/logs-hub.js`. Quelques fichiers centraux sont identiques au `HEAD` de ce dépôt voisin, mais cela ne restitue pas l’historique complet de `her-v5-build`.

**Origine possible, non confirmée :** le dossier courant a été fourni sans métadonnées Git, ou celles-ci ont été retirées par l’environnement/outil de checkout. Ne pas copier le `.git` V4, relier cette copie à un historique supposé, initialiser un dépôt ou réécrire l’historique. Solution recommandée : obtenir le checkout/métadonnées de la branche Lovable correspondant exactement à cette version V5, puis confirmer son état avant les changements.

Commandes de diagnostic en lecture seule :

\`\`\`bash
git -C /home/randoinryan/her-v5-build status --short --branch
git -C /home/randoinryan/her-v5-build rev-parse --show-toplevel
git -C /home/randoinryan/her-v3 log -5 --format='%h %cs %s'
\`\`\`

Les deux premières échouent actuellement dans le workspace ; la troisième documente seulement l’historique ancien.

## 3. Stratégie de sauvegarde

Aucune sauvegarde n’a été créée ni déplacée. Une sauvegarde de préparation doit être une archive source-only datée, stockée dans un emplacement sécurisé hors du workspace et hors Oracle. Elle ne remplace pas Git et ne sauvegarde pas l’état de production.

**À inclure :** sources, tests, documentation, scripts, fichiers de configuration non secrets, manifestes et lockfiles, assets publics utiles.

**À exclure explicitement :** `.git`, tous les fichiers `.env*`, `node_modules`, caches et sorties de build, `bot/data/`, bases SQLite/DB et autres données de production, archives de déploiement, clés et fichiers credentials. Le `.gitignore` exclut déjà les `.env`, `node_modules` et `**/data/`, mais une sauvegarde doit appliquer ses propres exclusions et vérifier son contenu.

Exemple de commande à adapter à un emplacement de sauvegarde approuvé ; **elle n’a pas été exécutée** :

\`\`\`bash
tar -czf /chemin-securise/her-v5-build-source-YYYYMMDD-HHMMSS.tar.gz \
  --exclude='her-v5-build/.git' \
  --exclude='her-v5-build/**/.git' \
  --exclude='her-v5-build/.env*' \
  --exclude='her-v5-build/**/.env*' \
  --exclude='her-v5-build/node_modules' \
  --exclude='her-v5-build/**/node_modules' \
  --exclude='her-v5-build/bot/data' \
  --exclude='her-v5-build/.output' \
  --exclude='her-v5-build/dist' \
  --exclude='her-v5-build/public/downloads' \
  -C /home/randoinryan her-v5-build
\`\`\`

Avant de considérer l’archive valide : lister son contenu, contrôler l’absence des chemins et extensions exclus, puis calculer une somme de contrôle. Des archives préexistantes sont visibles dans le répertoire parent, certaines portant des noms de sauvegarde ou de production ; leur contenu n’a pas été examiné et elles ne sont pas validées pour cette stratégie.

## 4. Préparation de l’environnement de test

Utiliser une application bot Discord de test distincte, invitée uniquement dans un serveur de recette. Ne pas utiliser le token du bot de production. Le bot de test doit recevoir une configuration de test et un secret de synchronisation de test, reliés à un dashboard de staging ou à un endpoint simulé. Aucune URL ni configuration ne doit viser la production.

Prévoir des tests isolés pour :

- commandes slash, préfixées et interactions ;
- synchronisation et isolation des réglages par serveur ;
- permissions/hiérarchie des rôles, DOG, MENOTTE, panneaux et salons temporaires ;
- lecture, erreurs de source, fin de piste, reconnexion et radio après redémarrage.

Intents présents dans `bot/index.js:134-136` : `Guilds`, `GuildVoiceStates`, `GuildMessages`, `MessageContent`, `GuildMembers`. `Message Content` et `Server Members` sont des intents privilégiés à activer pour l’application de test dans le portail Discord.

Permissions à attribuer selon les cas de test : `Connect` et `Speak` pour la musique ; `ManageRoles` pour DOG ; `MoveMembers` dans les salons source/destination pour MENOTTE ; droits adéquats de lecture/parole dans les salons de recette. Les opérations de gestion de rôles nécessitent aussi une hiérarchie correcte. L’installation du hub de logs demande notamment `ManageChannels` et `ManageRoles` (`bot/logs-hub.js:48-53`).

MZ demeure inactif jusqu’à validation. Tout test multi-serveur doit séparer ses réglages et données de ceux de PND. L’orientation produit validée est PND Assist +, Discord First, administration Discord sans dépendance obligatoire au dashboard, conservation du cahier des charges validé et absence de système de factions.

## 5. Dépendances audio et musique

Dépendances déclarées dans `bot/package.json` : `discord.js` `^14.16.3`, `@discordjs/voice` `^0.18.0`, `play-dl` `^1.9.7`. Versions trouvées dans les modules installés : `discord.js` 14.28.0, `@discordjs/voice` 0.18.0, `play-dl` 1.9.7, `prism-media` 1.3.5. Le `discord.js` installé respecte la plage déclarée.

Vérifications non destructives du rapport de dépendances `@discordjs/voice` :

- Opus : `@discordjs/opus`, `opusscript` et `node-opus` absents de `bot/node_modules`.
- Chiffrement vocal : aucune des bibliothèques reconnues par le rapport de dépendances n’est détectée. La connexion vocale réelle doit être validée en staging avec un mode de chiffrement accepté.
- FFmpeg : binaire système présent à `/usr/bin/ffmpeg` et `ffprobe` à `/usr/bin/ffprobe`, mais le rapport de `@discordjs/voice` indique FFmpeg non détecté par ses dépendances. Le code n’invoque pas FFmpeg explicitement.
- `bot/music/music.js:207-217` passe à `createAudioResource()` le flux et le type retournés par `play-dl`. La nécessité d’un encodeur Opus/FFmpeg dépend du format effectivement produit et du chemin de transformation : ne rien installer avant de l’avoir mesuré en recette.

Musique et radio sont dans `bot/music/music.js`, les règles pures dans `bot/music/music-policy.js`, les définitions slash dans `src/lib/slash-commands.ts:847-907`, le routage slash dans `bot/v4-commands.js:205-255` et `bot/index.js:729-732`. Les sources observées sont recherche/URL YouTube et playlists YouTube ; aucun support Spotify ou SoundCloud n’a été identifié.

Risques audio à traiter :

1. `resolveInput()` récupère `playlist.all_videos()` avant d’appliquer `slice()` (`bot/music/music.js:97-105`) : les playlists longues peuvent être chargées intégralement avant plafonnement.
2. Le test musique existant (`src/test/music-policy.test.ts`) couvre seulement la règle du même salon vocal, pas la résolution, le flux, Opus, le player, la reprise ou la radio.
3. L’utilisateur peut être détecté dans un salon Stage (`bot/music/music.js:199-204`), alors que `connectChannel()` ne permet que `GuildVoice` (`148-155`).
4. La radio active bloque les commandes musicales régulières (`bot/music/music.js:402`).
5. Les erreurs actuelles ne distinguent pas suffisamment les pannes de source, flux, chiffrement/encodage et connexion.

## 6. Risques et blocages

- **Historique V5 absent** : impossible de suivre précisément les changements ou de restaurer une révision avec le workspace actuel. Récupérer la bonne source Git avant des modifications autonomes importantes ou tout commit.
- **Audio non prêt à être déclaré opérationnel** : dépendances de chiffrement non détectées, aucun Opus module détecté, pas de recette réelle. Ne pas conclure que l’absence d’Opus seul bloque la lecture tant que le format du flux `play-dl` n’est pas établi.
- **Dépendance au dashboard à réduire** : `bot/index.js` exige `SITE_URL` et `BOT_SYNC_SECRET`, récupère les réglages et proxifie l’IA via `/api/public/bot-sync`. Cela constitue une dépendance d’exécution actuelle, à réconcilier avec l’objectif Discord First sans exposer les clés IA.
- **Isolation PND/MZ non achevée** : le second serveur est réservé/inactif dans `bot/logs-hub.js:2-5` et l’allowlist par défaut est construite dans `bot/index.js:44-47`.
- **Sauvegardes disponibles non qualifiées** : les archives du répertoire parent peuvent inclure des données ou artefacts de production ; ne pas les restaurer sans inspection.
- **Aucune installation requise pour rendre Node/npm disponibles** : utiliser NVM dans le shell de travail. N’installer que si une vérification ultérieure identifie une dépendance manquante, après en avoir expliqué le besoin.

## 7. Première mission de développement recommandée

**Mission : fiabiliser le système musique/radio dans un environnement de recette uniquement.**

Étapes proposées :

1. Récupérer ou faire confirmer la source Git correspondant à V5 pour obtenir revue et retour arrière fiables.
2. Créer/valider une application bot et un serveur Discord de test, avec configuration séparée de la production.
3. Mesurer le type de flux fourni par `play-dl` et tester la disponibilité du chiffrement vocal et des formats audio réellement nécessaires.
4. Ajouter une récupération réellement bornée des playlists.
5. Instrumenter les étapes résolution → flux → connexion → player avec des codes d’erreur sûrs.
6. Couvrir lecture, playlist longue, erreurs, reconnexion, radio et redémarrage dans les tests et la recette Discord.
7. N’ajouter une dépendance audio qu’après avoir identifié le besoin précis et confirmé sa compatibilité avec Node 24 et les lockfiles.

**Critères d’acceptation :** aucun accès à la production ; lecture vérifiée en staging ; playlists bornées ; reprise radio testée ; erreurs permettant d’identifier l’étape fautive ; documentation des permissions et dépendances requises.

## Vérifications de la Phase 0

- Node/npm : présents sous NVM ; versions conformes aux prérequis documentés.
- Dépôts voisins : historiques lisibles mais anciens (V3/V4), donc non substituables à l’historique V5.
- `.git` du workspace : vide ; aucune réparation effectuée.
- Dépendances bot : installées localement ; aucune installation ni commande de test lancée.
- Audio : Opus/chiffrement absents selon les rapports de dépendances ; FFmpeg système présent, mais non détecté par le rapport de `@discordjs/voice`.
- Sauvegarde : stratégie préparée, aucune archive créée.
- Oracle : aucun accès ni déploiement.
- Produit : nom officiel PND Assist + ; Discord First ; PND/MZ isolés ; MZ inactif ; aucun système de factions.

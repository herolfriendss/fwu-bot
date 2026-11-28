# Musique et radio

## Sources et résolution

Le lecteur prend en charge les pages HTTPS YouTube et SoundCloud via `yt-dlp`, ainsi que les flux audio HTTPS directs explicitement autorisés pour la radio. Les liens Spotify ne donnent pas accès au flux Spotify et ne sont pas lus directement. Les vidéos privées, géobloquées ou nécessitant une authentification ne sont pas contournées.

Le résolveur vérifie les domaines de page, puis contrôle l'hôte CDN retourné. Les URL audio signées sont ouvertes avec une résolution DNS IPv4 publique épinglée. Les en-têtes transmis par l'extracteur sont filtrés : seuls User-Agent, Accept et Accept-Language sont conservés ; cookies, autorisations et autres en-têtes sensibles sont ignorés. Les redirections HTTP ne sont pas suivies. Les playlists HLS/DASH et M3U restent refusées pour les flux directs.

## Dépendances de production

Node.js 24+, FFmpeg avec encodeur `libopus` et yt-dlp récent sont requis sur l'hôte du bot. Le script `bot/install-runtime-tools.sh` vérifie FFmpeg, installe/actualise yt-dlp dans l'espace utilisateur et affiche les chemins à configurer. Si PM2 n'hérite pas du PATH utilisateur, définir `PND_FFMPEG_PATH` et `PND_YTDLP_PATH` dans l'environnement du bot. Le diagnostic d'installation doit confirmer ces exécutables dans le même environnement que le processus PM2.

## Lecture, file et playlists

`@discordjs/voice` transporte le flux Ogg/Opus. Les files sont isolées par serveur et limitées. Les contrôles DJ, votes skip, effets, playlists et radios restent conservés. Les playlists de titres YouTube/SoundCloud mémorisent désormais la page source, pas l'URL CDN signée qui expire ; un nouveau flux est résolu au moment où le morceau est lu. Les anciennes playlists gardent leur comportement historique et peuvent nécessiter d'être réenregistrées si leur URL signée a expiré.

Les connexions vocales non prêtes sont détruites avant de signaler l'échec. Les processus FFmpeg sont arrêtés avec escalade SIGTERM/SIGKILL afin d'éviter les processus orphelins. Les erreurs de dépendance indiquent si yt-dlp ou FFmpeg manque.

## Recette

Les tests unitaires couvrent les politiques de sources, l'assainissement des en-têtes, la résolution, les transitions, les playlists et les erreurs contrôlées. Ils ne prouvent pas à eux seuls qu'un son est audible sur Discord. Une recette staging reste nécessaire avec un bot dédié, une guild isolée, les permissions Connect/Speak, un flux autorisé et les mêmes dépendances que PM2. Ne pas reprendre les salons, rôles ou tokens de production.

Commandes locales : `npm --prefix bot test`, `npx vitest run src/test/music-policy.test.ts --maxWorkers=1`, puis `npm run build`.

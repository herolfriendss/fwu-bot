# Musique et radio

## Sources prises en charge

Le bot accepte uniquement une URL HTTPS directe dont l’hôte a été autorisé dans la configuration de cette guild (`=radio host-add`). La connexion DNS est vérifiée et épinglée sur une IPv4 publique ; les redirections ne sont pas suivies. Les playlists HLS/DASH et les sources de type M3U sont refusées. Aucun extracteur YouTube/Spotify n’est utilisé.

FFmpeg reçoit le flux via stdin et produit Ogg/Opus sur stdout. `@discordjs/voice` assure le transport et le chiffrement vocal. Le chemin d’entrée ne nécessite pas le paquet `@discordjs/opus`, car FFmpeg encode en Opus. FFmpeg système est donc obligatoire sur l’hôte du bot.

Vérification locale : `/usr/bin/ffmpeg` contient l’encodeur `libopus`; un signal synthétique a été encodé puis identifié par `ffprobe` comme `opus,audio`. Le pipeline `openAuthorizedAudioStream` a également reçu ce flux via une requête HTTPS mockée, l’a réencodé par le FFmpeg système et produit 7 739 octets valides Opus/Ogg, confirmés par `ffprobe`. Le test de chiffrement XChaCha20-Poly1305 de `@noble/ciphers` a réussi. Le rapport `generateDependencyReport()` détecte `@noble/ciphers` et l’absence des paquets Opus natifs, mais signale FFmpeg comme absent : son détecteur cherche l’intégration de `prism-media`, tandis que le bot appelle le binaire système directement. Ce rapport seul ne confirme donc pas la présence du binaire système.

## Résilience

La file, les erreurs de lecture, les boucles et les tentatives radio sont pilotées par `bot/music/music-engine.js`. Les réglages radio sont conservés par guild dans `bot/data/radio-config.json`. Si une connexion vocale n’atteint pas `Ready`, elle est maintenant détruite et retirée de l’état du lecteur ; les connexions réutilisées attendent aussi `Ready` avant de lancer la lecture. Un démarrage persistant qui échoue retente toutes les 30 secondes, avec une seule minuterie par serveur. `stop` et `clear` annulent la minuterie.

## Recette

Les tests locaux couvrent les transitions, les sources, et le nettoyage d’un timeout vocal avec de fausses dépendances. Ils ne valident pas la négociation Gateway, l’accès au fournisseur audio ni le son audible. La recette requiert une application de bot dédiée, une guild de test isolée, un backend `bot-sync` de test, un dossier `bot/data` neuf, les permissions Connect/Speak et un flux direct autorisé ; aucune configuration de production ne doit être reprise. Le protocole complet et la matrice de scénarios sont dans [`docs/recettes/musique-radio-discord.md`](../recettes/musique-radio-discord.md).

Commandes locales : `npm --prefix bot test`, `npx vitest run src/test/music-policy.test.ts --maxWorkers=1`, puis `npm run build`.

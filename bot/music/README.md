# PND Music — sources YouTube et recherche

PND Music utilise `yt-dlp` pour résoudre les liens YouTube/SoundCloud et les recherches par titre en flux audio HTTPS, puis FFmpeg pour convertir le flux en Opus pour Discord.

## Dépendances système de production

Node.js 24+, FFmpeg avec encodeur `libopus`, et yt-dlp récent doivent être installés sur l'hôte du bot. Exemple Debian/Ubuntu :

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
python3 -m pip install --user --upgrade yt-dlp
```

Vérifier les exécutables :

```bash
ffmpeg -version
yt-dlp --version
```

Si les exécutables ne sont pas dans le PATH du processus PM2, définir `PND_FFMPEG_PATH` et `PND_YTDLP_PATH` dans l'environnement du bot. Mettre à jour yt-dlp régulièrement : les plateformes modifient parfois leurs mécanismes de lecture.

## Utilisation

- `/play recherche: lien YouTube ou titre`
- `=play lien YouTube ou titre`

Les liens YouTube et SoundCloud HTTPS sont pris en charge. Une recherche textuelle est effectuée sur YouTube. Les URL audio directes déjà autorisées restent disponibles pour les radios et les flux compatibles. Les liens Spotify ne donnent pas accès au flux audio Spotify : ils ne sont pas lus directement.

Les vidéos privées, géobloquées, soumises à restriction ou nécessitant une connexion ne sont pas garanties. Le bot ne contourne pas les protections d'accès. Respecter les conditions des plateformes et les droits sur les contenus.

## Sécurité

Le résolveur n'accepte que des pages YouTube/SoundCloud HTTPS et vérifie que le média retourné est servi depuis les domaines CDN attendus. L'ouverture du flux repasse par la politique HTTPS, la résolution DNS IPv4 publique épinglée et le contrôle du type de contenu. Les URL signées conservent leurs paramètres de requête, nécessaires aux CDN, mais ne peuvent pas changer d'hôte autorisé.

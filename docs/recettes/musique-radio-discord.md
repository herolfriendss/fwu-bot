# Recette Discord — musique et radio

## Périmètre et isolation

Cette recette utilise une application Discord de test, une guild réservée à la recette, un backend `bot-sync` de test et une copie de travail dédiée du dépôt. Ne réutilisez ni token, ni `BOT_SYNC_SECRET`, ni URL backend, ni dossier `bot/data` de production. Configurez `V4_ALLOWED_GUILD_IDS` avec l’identifiant de la seule guild de recette et laissez `PND_MZ_ENABLED=false`. Le fichier `bot/.env.example` décrit les noms de variables; les valeurs secrètes doivent être saisies localement dans le fichier ignoré `.env` de cette copie et ne doivent jamais être copiées dans un rapport.

Le processus exige `DISCORD_TOKEN`, `SITE_URL` et `BOT_SYNC_SECRET`. `SITE_URL` doit viser le backend de recette, qui fournit `/api/public/bot-sync` et `/api/public/bot-status`. La copie doit avoir un dossier `bot/data` neuf et indépendant; la configuration persistante radio ne doit pas provenir d’une base ou d’un fichier de production.

## Application et guild de recette

Créer une application/bot dédiée et l’inviter uniquement dans la guild isolée. Activer les intents nécessaires au runtime (Guilds, Guild Voice States, Guild Messages, Message Content et Guild Members selon les fonctions exercées). Accorder au bot Voir les salons, Se connecter et Parler dans le salon vocal de recette, ainsi que Voir le salon et Envoyer des messages dans le salon texte. Vérifier les permissions effectives et la hiérarchie du rôle du bot. Aucun accès administrateur global n’est nécessaire pour la lecture audio.

Préparer un flux HTTPS direct de test, publiquement accessible, stable pendant la recette et explicitement autorisé pour cet usage par son fournisseur. Ajouter uniquement son nom d’hôte à la liste autorisée de la guild (`=radio host-add <hôte>`). Les URL YouTube/Spotify, redirections et playlists HLS/DASH ne sont pas des sources prises en charge.

## Exécution

Depuis la copie de recette, installer uniquement les dépendances déclarées si l’environnement de recette en est dépourvu; vérifier `ffmpeg -version` et `ffmpeg -hide_banner -encoders` (l’encodeur `libopus` doit être disponible), puis lancer `npm --prefix bot test`. Démarrer ensuite avec `npm --prefix bot start` après création locale de `.env`. Le bot enregistre les commandes slash globalement pour l’application configurée; n’utiliser ici que l’application de test.

| Scénario | Action | Résultat attendu |
|---|---|---|
| Connexion vocale | Rejoindre un salon vocal, lancer `/join` ou `/play` | Bot connecté au salon, aucune erreur Gateway, lecture amorcée |
| Lecture | `/play` avec le flux HTTPS autorisé | Son audible en continu pendant au moins 60 secondes |
| Pause/reprise | `/pause`, puis `/resume` | Silence pendant la pause, reprise au bon point |
| File et skip | Ajouter deux flux, consulter `/queue`, lancer `/skip` | Ordre cohérent, passage au titre suivant une seule fois |
| Erreur de source | Tester une URL autorisée qui répond en erreur ou cesse d’émettre | Message contrôlé, ressources FFmpeg libérées, bot toujours utilisable |
| Reconnexion | Couper temporairement l’accès vocal ou déplacer le bot, puis rétablir | Connexion rétablie sans lecteur ni timer dupliqué |
| Radio persistante | Configurer `=radio set`, lancer, puis redémarrer le processus de recette | Radio relancée depuis sa configuration locale isolée |
| Retry radio | Rendre le flux indisponible puis le rétablir | Nouvelle tentative, une seule par guild, lecture après rétablissement |
| Arrêt/effacement | `=radio stop`, puis `=radio clear` | Lecture arrêtée; timer annulé; effacement réservé à la recette |

Pour chaque étape, noter heure, scénario, résultat audible/visuel et code d’erreur non sensible. Ne pas joindre de logs bruts contenant messages, identifiants privés ou secrets. Après la recette, arrêter le processus, révoquer le token de test si l’application n’est plus utilisée et supprimer les seules données créées dans le répertoire temporaire de recette.

## État et clôture

La recette n’est pas exécutée : aucun bot/app Discord, backend isolé ni flux autorisé de recette n’est actuellement configuré dans le workspace. Les tests unitaires, le pipeline FFmpeg local et le chiffrement ont été validés séparément; ils ne remplacent pas la preuve d’un son audible. Le lot musique/radio ne pourra être déclaré terminé qu’après réussite des scénarios connexion, lecture audible, pause/reprise, skip, erreur, reconnexion et radio persistante sur cette recette.

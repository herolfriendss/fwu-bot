# P1-A — Connexion propriétaire Discord OAuth2

## Ce qui est codé

- Connexion propriétaire uniquement via Discord OAuth2 `identify`.
- Authorization Code + PKCE S256.
- `state` aléatoire, lié à la session et expirant après 10 minutes.
- Échange du code côté serveur, puis lecture de `/users/@me` avec le jeton Bearer.
- Seul l’ID unique de `PND_OWNER_DISCORD_ID` est accepté pour le dashboard ; les cofondateurs ne reçoivent pas automatiquement l’accès Owner au dashboard.
- L'identité propriétaire est revalidée contre la configuration à chaque contrôle d'accès.
- La session pré-authentifiée est effacée avant l'établissement de la session propriétaire.
- Le mot de passe partagé `DASHBOARD_PASSWORD` ne peut plus ouvrir le dashboard.

## Configuration serveur

Définir les variables suivantes dans l'environnement du dashboard :

```dotenv
SESSION_SECRET=<secret aleatoire de 32 caracteres ou plus>
PND_OWNER_DISCORD_ID=<discord_id_proprietaire>
PND_COFOUNDER_DISCORD_IDS=<discord_id_btk>,<discord_id_mz>
DISCORD_CLIENT_ID=<application_client_id>
DISCORD_CLIENT_SECRET=<application_client_secret>
DISCORD_OAUTH_REDIRECT_URI=https://<domaine>/api/auth/discord/callback
```

Dans le portail développeur Discord, ajouter exactement la valeur de `DISCORD_OAUTH_REDIRECT_URI` dans les Redirects OAuth2 de l'application. Le scope demandé est uniquement `identify`.

`PND_OWNER_DISCORD_ID` doit être un seul snowflake Discord valide. `PND_COFOUNDER_DISCORD_IDS` doit contenir exactement deux snowflakes valides, distincts entre eux et différents de l’Owner. Une configuration invalide entraîne un refus fermé.

## Routes

- `GET /api/auth/discord/start` : crée `state` et le vérificateur PKCE, puis redirige vers Discord.
- `GET /api/auth/discord/callback` : vérifie `state`, échange le code, récupère l'identité et ouvre la session si l'ID est autorisé.
- `/connexion` : écran de connexion Discord.

## Limites de validation

Le flux OAuth réel n'a pas encore été exécuté : les valeurs de l'application Discord et l’ID Owner et les deux IDs Cofounders doivent être fournis/configurés dans l'environnement privé. Ne pas tester avec des secrets factices et ne pas ajouter de secrets aux archives. Il faut valider le callback sur l'URL HTTPS publique configurée avant la mise en production.

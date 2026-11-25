# Her? V5 — identité visuelle et Webhooks

## Direction visuelle
- Base noire / prune, accents violets et améthyste.
- Fond atmosphérique de ville nocturne, avec brume discrète et feuillages violets très légers.
- Le dashboard expose la bannière animée depuis `public/media/her-v5-city-loop.gif`.
- Les panneaux Discord de contrôle (SYS+, rôles, tickets, GuildGuard et vocal) réutilisent l'image et l'accent violet.

## Webhooks
Les nouveaux webhooks ont `animation_enabled = 1` par défaut. Les anciennes bases SQLite reçoivent cette colonne via une migration additive ; aucune donnée existante n'est supprimée.

- `/webhook animation etat:on` : active l'animation pour tous les webhooks du serveur.
- `/webhook animation etat:off` : désactive l'animation pour tous les webhooks du serveur.
- `/webhook animation etat:on id:<id>` : active uniquement ce webhook.
- `/webhook animation etat:off id:<id>` : désactive uniquement ce webhook.
- `/webhook list` affiche l'état actuel de chaque webhook.

Les publications et les modifications du dernier message utilisent un embed violet et la bannière GIF hébergée par le dashboard. Si `SITE_URL` pointe vers un domaine HTTPS public, l'URL est `/media/her-v5-city-loop.gif`. Une URL HTTPS alternative peut être fournie avec `HER_THEME_IMAGE_URL`.

Les contrôles SYS+/propriétaire/administrateur restent vérifiés dans le bot. Les webhooks conservent les tokens chiffrés en AES-256-GCM dans SQLite ; cette fonctionnalité ne change pas leur stockage secret.

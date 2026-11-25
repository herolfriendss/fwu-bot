# Her? V5 — validation et prérequis de recette

## Vérifications disponibles dans cette copie

- `npm --prefix bot test` : 40/40 tests réussis (Node 22.16.0 dans cette sandbox).
- `find bot -type f -name '*.js' -not -path '*/node_modules/*' -print0 | xargs -0 -n1 node --check` : syntaxe de tous les fichiers JS du bot validée.
- GIF de ville et deux GIF LIVE vérifiés comme fichiers GIF animés.
- Migration SQLite `managed_webhooks.animation_enabled` et table de consentement IA présentes dans `bot/database.js`.

## Bloqueurs de recette complète

1. Installer Node 24.22.2 et npm 11.19.1 dans l'environnement de build. L'environnement temporaire utilisé ici n'a pas pu résoudre `nodejs.org`, donc aucun binaire Node 24 n'a été installé ici.
2. Exécuter `npm ci` à la racine, puis `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
3. Exécuter `npm --prefix bot ci`, `npm --prefix bot test`, et démarrer le bot de test.
4. Configurer les clés/URL nécessaires sur un environnement de test : `SITE_URL`, `BOT_SYNC_SECRET`, `WEBHOOK_ENCRYPTION_KEY` (hexadécimal de 32 octets), tokens Discord de test et les secrets Supabase appropriés.
5. Vérifier l'hébergement public HTTPS de `/media/her-v5-city-loop.gif`, `/media/her-v5-live-alert-main.gif`, `/media/her-v5-live-alert-grid.gif`.
6. Enregistrer les commandes Discord dans les deux guildes autorisées et tester les permissions SYS+/ADMIN+, les menus, webhooks, alertes LIVE, CAPTCHA, Join-to-Create, DOG et MENOTTE.

Ne pas faire de déploiement en production avant que ces étapes soient vertes.

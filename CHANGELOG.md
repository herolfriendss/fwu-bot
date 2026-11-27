# Journal des changements

Ce qui est mis en ligne, du plus récent au plus ancien. Le site (Render) se déploie seul à chaque push sur `main` ;
les bots du VPS prennent la mise à jour avec `/maj lancer` ou la mise à jour automatique de 5 h.

## 27/11/2026 (nuit)

### Bots
- Limite de connexions Discord : quand Discord répond « Not enough sessions remaining … resets at … », le bot attend
  l'heure de reset (+1 min, 24 h au plus) avant le prochain essai, au lieu de redémarrer et de brûler encore des connexions.
  Cet échec ne compte pas dans les 6 échecs qui arrêtent un bot pour de bon. Fichiers : `bot/gateway-watchdog.js`, `bot/index.js`.

### Console (`/console/`)
- Réglages : bouton « Tout redémarrer » (bots joignables seulement, double clic de confirmation) et aide-mémoire des commandes PM2 à copier.
- Palette `Ctrl K` : cherche aussi dans les commandes des bots et dans le journal.
- Analyse : bouton « Copier le journal en CSV ».
- Installable sur le téléphone : manifeste et icône (`public/console/manifest.webmanifest`, `icon.svg`).

### Site
- En-têtes de sécurité sur toutes les pages (`nitro.config.ts`) : le site ne peut plus être affiché dans un cadre d'un autre site,
  plus HSTS, nosniff, Referrer-Policy et Permissions-Policy.

### Docs
- `docs/MODE_EMPLOI.md` : où est quoi et quoi faire en cas de panne.

## 27/11/2026 (journée)
- Console reliée aux vrais bots : statut, journal, activité, commandes ; redémarrage individuel depuis le site ; page Analyse.
- Migrations Supabase `bot_control_commands` et `bot_activity_snapshots`.
- Feuille de route : `docs/FEUILLE_DE_ROUTE.md`.

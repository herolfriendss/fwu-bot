# Mode d'emploi : reprendre sans aide

## Où est quoi

| Élément | Où | À quoi ça sert |
|---|---|---|
| Code | GitHub `herolfriendss/fwu-bot`, branche `main` | Tout : site, bots, migrations, docs |
| Site + console | Render, `https://her-v3-dashboard.onrender.com` (console : `/console/`) | Se déploie seul à chaque push sur `main` |
| Bots | VPS Oracle, dossier `/home/opc/her-v5-production`, gérés par PM2 | `her-v5-bot` (bot principal) et `fwu-<bot>` |
| Données partagées des bots | VPS, `/home/opc/fwu-data` | Base SQLite, version installée, journal `maj.log` |
| Base du site | Supabase | Statuts des bots, ordres de redémarrage, activité |
| Applications Discord | Portail développeur Discord | Tokens des bots, connexion OAuth du site |

## Mettre à jour

- **Site** : rien à faire, Render déploie `main`.
- **Bots** : sur Discord, `/maj lancer`. Sinon la mise à jour automatique de 5 h (heure de Paris) installe `main` chaque nuit.
  `/maj etat` affiche la version installée. Détails : `docs/VERSIONS_ET_MAJ.md`.

## Un bot ne répond plus

1. Console → Bots : s'il est joignable, bouton « Redémarrer ».
2. S'il ne transmet plus son statut, sur le VPS :

```
pm2 status
pm2 logs her-v5-bot --lines 50
pm2 restart her-v5-bot
```

(remplacer `her-v5-bot` par `fwu-guard`, `fwu-fisc`, etc. pour les autres bots ; la console Réglages donne ces commandes à copier.)

3. Si le journal dit « limite quotidienne de connexions Discord atteinte », ne rien faire : le bot attend seul l'heure de reset.
4. Si le journal dit « s'arrête définitivement après 6 échecs », corriger la cause (token, intents) puis `pm2 restart <bot>`.

## Après un redémarrage du VPS

Les bots repartent seuls si `pm2 startup` et `pm2 save` ont été faits une fois. Vérifier avec `pm2 status`.

## La console affiche « Démonstration »

Le site n'arrive pas à lire l'état réel : se connecter via `/connexion` (Discord). Si la connexion Discord est refusée,
vérifier sur Render `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_OAUTH_REDIRECT_URI`, `PND_OWNER_DISCORD_ID`, `SESSION_SECRET`.

## Secrets

Ne jamais coller un secret dans un chat ou un ticket. Un secret exposé se régénère dans le service qui l'a émis
(portail Discord, Supabase), puis se remplace sur Render et dans les `.env` du VPS.

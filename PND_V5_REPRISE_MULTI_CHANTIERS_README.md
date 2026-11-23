# PND Assist V5 — reprise multi-chantiers

Cette archive contient la copie complète du projet et les derniers correctifs de séparation Owner / SYS+ / ADMIN+.

## Correctifs de cette reprise

- SYS+ ne confère plus automatiquement le tier ADMIN+.
- SYS+ n'autorise plus l'accès aux scopes administratifs.
- Le Owner PND configuré dans `PND_OWNER_DISCORD_ID` garde le contrôle des scopes, même désactivés.
- Les rôles ADMIN+ n'accèdent qu'aux scopes activés explicitement.
- Les opérations de gestion des membres SYS+ sont réservées au Owner PND configuré, pas au propriétaire Discord de chaque serveur.
- Les contrôles natifs Discord (Manage Roles et hiérarchie du rôle du bot) restent obligatoires.

## Tests réalisés

- 43 tests ciblés passent avec Node 24.11.1.
- 211 fichiers JavaScript du bot passent `node --check` avec Node 24.11.1.
- Pas de test Gateway, de lecture vocale réelle, ni de déploiement VPS dans cet environnement.

## Installation / validation sur le Chromebook

Depuis le dossier `bot` :

```bash
node -v
npm ci
npm test
```

Il faut Node 24+. Ne remplace pas les `.env` ou la base SQLite de production. Sauvegarde les données avant toute mise à jour.

## À terminer

- recette Discord complète du cycle ticket ;
- recette réelle YouTube/SoundCloud et radio ;
- PND Knowledge et panneaux informatifs ;
- panel de rôles personnalisés SYS+ ;
- couverture exhaustive des modules dans `/setup` ;
- audit slash/préfixe et suite globale avec dépendances installées.

Les secrets, `.env`, `node_modules`, bases SQLite et répertoires Git ne sont pas inclus dans l'archive.

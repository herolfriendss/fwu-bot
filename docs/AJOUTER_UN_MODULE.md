# Ajouter un module : bot, /setup et dashboard

Le dashboard fabrique automatiquement l’écran d’un nouveau module à partir de sa définition dans `/setup`. Il n’y a rien à coder côté site.

1. **Définir le module dans `/setup`** : ajouter l’entrée dans `SETUP_MODULES` (`bot/systems/setup/policy.js`), avec son libellé, sa description et ses champs. Types de champ reconnus : `boolean`, `integer`, `enum`, `role`, `textChannel`, `category`, `voiceChannel`, `roleList`, `text`. Un champ `enabled` donne au module son interrupteur.
2. **Déclarer les réglages** dans `src/lib/bot-settings.ts` :
   - type et valeur par défaut dans `BotSettings` et `DEFAULT_SETTINGS` ;
   - nettoyage dans `sanitizeCoreSettings` ;
   - clé ajoutée à `BOT_MODULE_SETTINGS_KEYS` (écriture depuis Discord) et à `DASHBOARD_SECTION_KEYS` (écriture depuis le site) ;
   - libellé ajouté à `SECTION_LABELS`.
3. **Indiquer le bot qui exécute le module** dans `MODULE_OWNERS` (`src/lib/module-catalog.ts`).
4. **Lancer les tests** (`npx vitest run`) : `src/test/module-catalog.test.ts` signale ce qui manque.

Résultat :
- l’onglet Modules du site affiche l’interrupteur dans la carte du bot et un formulaire généré (`GenericModuleForm`) ;
- le diagnostic signale les salons ou rôles manquants, et applique la règle `setupRequirementError` si elle couvre le module ;
- les enregistrements du site et de Discord passent par la même règle : seuls les champs modifiés sont écrits, et un conflit est refusé (erreur 409 côté bot).

Pour un écran sur mesure, ajouter le composant dans `V4ModulesPanel.tsx`, puis ajouter la clé à `HANDCRAFTED_MODULES`.

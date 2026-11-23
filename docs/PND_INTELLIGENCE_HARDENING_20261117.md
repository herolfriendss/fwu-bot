# PND Intelligence — durcissement du planificateur IA

Date : 17 novembre 2026

## Changements

- La sortie du modèle est désormais traitée comme une donnée non fiable et passe par `parsePndIntelligenceModelPlan` avant d'être renvoyée au bot.
- Le parseur n'accepte que des objets JSON, une taille maximale de 10 000 caractères, des propriétés explicitement autorisées et quatre actions proposées par le modèle : catégorie, salon texte, salon vocal, annonce, ou `none`.
- Les noms, identifiants de salon, motifs de refus et contenus d'annonce sont contrôlés et bornés. Les noms neutralisent les mentions `@` et les noms de salons sont normalisés.
- Le bot continue de revalider l'action avec `validatePndIntelligenceAction`, puis vérifie à nouveau les permissions des membres et du bot ainsi que l'existence de la ressource sur le serveur avant exécution.
- La liste des huit actions autorisées par la commande PND Intelligence est centralisée dans `PND_INTELLIGENCE_ACTION_TYPES`.
- Le stockage des aperçus utilise maintenant la validation métier et enregistre uniquement les champs normalisés. Les actions de création de rôle sans permission, renommage, sujet et mode lent ne sont plus rejetées au stockage alors qu'elles sont prises en charge par le parseur.
- Le contenu inattendu d'une action n'est pas persisté.

## Tests exécutés

Commande :

```bash
node --test bot/pnd-intelligence*.test.js bot/pnd-intelligence-access.test.js bot/ai-memory-policy.test.js bot/ai-memory-preferences.test.js
```

Résultat : **22 tests réussis, 0 échec**.

Vérifications syntaxiques : `node --check` sur les modules JavaScript modifiés.

La résolution de déclaration TypeScript pour l'import du validateur JavaScript a été vérifiée avec un petit fichier temporaire et `tsc`.

La vérification TypeScript globale n'a pas pu s'exécuter : l'archive ne contient pas `node_modules`, et les définitions `vite/client` et `vitest/globals` sont donc absentes. Les interactions réelles avec Discord et l'appel au fournisseur IA n'ont pas été exécutés.

## Portée

Ce patch est construit sur l'archive locale `PND_Assist_V5_SYSPLUS_Ghost_Search_Composer.zip`. Il ne contient pas le checkpoint Claude le plus récent (Entitlements, Creator Studio et Marketplace), car cette archive n'a pas encore été fournie dans cette session. Avant fusion avec le checkpoint Claude, comparer les fichiers partagés, en particulier `bot/pnd-intelligence-policy.js`, `bot/pnd-intelligence-store.js` et `src/lib/bot-ai.server.ts`.

Aucun déploiement, aucune migration de production et aucun changement de secrets n'ont été effectués.

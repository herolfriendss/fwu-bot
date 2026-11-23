# PND V5 — Plan directeur

> Statut : spécification d'architecture, **non validée**. Aucun code écrit, rien déployé, V4 intacte. MZ est une contrainte d'architecture uniquement : aucune fonctionnalité MZ, aucune activation.

## 1. Mission

Faire de PND Assist une plateforme Discord modulaire multi-serveurs, en **faisant évoluer** l'existant (V4 conservée, V5 en cours) et non en le réécrivant. PND est le serveur principal ; MZ est prévu dans le modèle de données mais désactivé.

## 2. Légende des statuts

- ✅ **Lu** : contenu inspecté dans cette conversation (extraits fournis).
- 📄 **Documenté** : décrit dans les documents de référence (STATUS, CHANGELOG, MASTER_PLAN, AGENTS), code non vu.
- 🆕 **À créer**.
- ❓ **À auditer** : existence probable (import ou table vue), contenu inconnu.

## 3. Sources réellement vues

✅ Lus (en tout ou en extraits) : `bot/systems/sysplus/permissions.js`, `audit.js`, `whitelist-policy.js`, `whitelist-commands.js` ; `bot/dog-policy.js`, `dog-commands.js` ; `bot/systems/setup/policy.js`, `panel-setup.js` ; `bot/module-settings.js` ; `src/lib/bot-settings.ts`, `bot-settings.server.ts`, `src/routes/api/public/bot-sync.ts` ; extraits de `bot/database.js`, `bot/index.js`, `bot/v4-commands.js`, `bot/logs.js`, `src/lib/slash-commands.ts`.

❓ Importés mais **jamais vus** : `economy.js`, `music/music.js`, `social.js`, `cards.js`, `voice-commands.js`, `voice-v2.js`, `voice-v2-policy.js`, `guild-guard.js`, `automation.js`, modules tickets, composants et routes du dashboard (hors `bot-sync`), `src/lib/voice-access.ts`, `src/lib/discord-ids.ts`.

Toute affirmation sur ces zones vient des documents, pas du code. **La Phase 0 (audit) est un prérequis bloquant de tout développement.**

## 4. Principes non négociables

1. Une seule base de code, plusieurs serveurs autorisés, **isolation stricte par `guild_id`**.
2. Une logique métier unique, appelée par les adaptateurs slash, préfixe, interface et API.
3. Permissions vérifiées **côté serveur**, jamais déduites de l'interface.
4. **PND PRIME est un statut de serveur, jamais une permission ni un grade de membre.**
5. SYS+ = permission ; WHITELIST = exemption de limites internes uniquement.
6. Aucune suppression de fonctionnalité ; V4 retirée seulement après parité prouvée et validation humaine.
7. Pas de paiement activé. Licences = modèle de données et interfaces uniquement.
8. Pas de sanction automatique par l'IA. L'IA ne s'accorde jamais de permissions.
9. Pas de scraping de plateformes pour l'audio.
10. Aucun secret en clair, aucun test contre la production, aucun déploiement sans validation.
11. Une fonctionnalité n'est « terminée » qu'avec tests automatisés ; si Discord est impliqué, avec recette sur serveur de test.

## 5. Glossaire

| Terme | Définition |
|---|---|
| PND / MZ | Serveur principal / secondaire (désactivé) |
| PRIME | Statut interne d'un serveur (flag), accordé par configuration propriétaire |
| SYS+ | Permission (rôle) donnant accès aux fonctions exclusives |
| ADMIN+ | Tier intermédiaire, limité par scopes |
| WHITELIST | Exemption de limites internes, sans droit natif |
| CORE | Fonctionnalités classiques, sans entitlement |
| Entitlement | Droit d'un **serveur** à une fonctionnalité (via PRIME ou licence future) |
| Module | Unité fonctionnelle (Guardian, Economy…) avec manifeste |

## 6. Modules et phases

| Module | Tier | Phase |
|---|---|---|
| Plateforme (registre, catalogue, policy, db) | — | P1 |
| Guardian | CORE | P2 |
| Economy, Business, Investments | CORE / SYS+ avancé | P3 |
| Voice | CORE | P4 |
| Music | CORE | P5 |
| Social, Games, Events | CORE / SYS+ avancé | P6 |
| Tickets, Recruitment, Academy, Awards, Wrapped, Radar, Stories | CORE / SYS+ | P7 |
| Automation | SYS+ avancé | P8 |
| Intelligence | SYS+ | P9 |
| Dashboard | — | P10 (API dès P1) |

## 7. Phases et critères de sortie

- **P0 Audit des sources.** Entrée : archive complète. Sortie : inventaire réel, suite de tests de base exécutée, écarts documentés.
- **P1 Plateforme.** Registre de modules, catalogue de commandes, `policy/authorize`, migrations versionnées, dépôts à portée `guild_id`. Sortie : tests de politique verts, catalogue ≤ 100 commandes de premier niveau, aucune entrée orpheline, V4 inchangée.
- **P2 Guardian + permissions.** Branche SYS+/ADMIN+/WHITELIST/PND* sur `authorize`. Sortie : matrice de permissions complète verte.
- **P3 Économie.** Ledger append-only, escrow, antifraude. Sortie : invariants de solde prouvés par tests.
- **P4 Voice.** Audit puis consolidation JOIN 2 CREATE, MENOTTE, `voiceAccess`. Sortie : recette sur serveur de test.
- **P5 Music.** Recette staging selon `docs/recettes/musique-radio-discord.md`.
- **P6–P7.** Modules sociaux et d'organisation, un par un.
- **P8 Automation.** Moteur de règles avec confirmation et journalisation.
- **P9 Intelligence.** Spécification `PND_V5_AI_SPEC.md`, outils lecture seule d'abord, écriture ensuite.
- **P10 Dashboard.** Interface sur l'API existante.

Chaque phase : tests exacts, résultats, limites, mise à jour de STATUS et CHANGELOG, commit local réversible.

## 8. Risques

| Risque | Mitigation |
|---|---|
| Sources absentes → conception à l'aveugle | P0 bloquante ; labels ✅/📄/❓ |
| Limite de 100 commandes slash atteinte | Groupes de sous-commandes, migration par parité (doc 4) |
| Régression V4 | Pont « legacy », parité testée avant tout retrait |
| Fuite inter-serveurs | Dépôts qui exigent `guild_id`, tests d'isolation |
| Dérive de l'IA | Outils typés, aperçu, confirmation, audit, permissions intersectées |
| Périmètre trop large | V5.0 limitée à P1–P4, le reste en lots |

## 9. Décisions ouvertes

- **D1** Aligner le « SYS+ premium » sur le tier SYS+ existant (déjà vu dans `permissions.js`) : proposé = même permission, avec un entitlement serveur en plus.
- **D2** Périmètre de V5.0 (proposé : P0–P4).
- **D3** Fournisseurs IA acceptés (open source/local en priorité) et quotas.
- **D4** Migration des réglages dashboard (JSON Supabase) : conserver ou rapatrier.
- **D5** Retrait des anciens noms slash après regroupement (relocalisation, pas suppression de fonction).
- **D6** Rétention analytics et tickets.
- **D7** Destination des sauvegardes (tout accès Oracle/VPS exige votre approbation).

## 10. Critères de validation du plan

- Chaque module a un manifeste, une phase et des critères d'acceptation (doc 3).
- Chaque commande a une entrée de catalogue, un tier, un service (doc 4).
- Chaque action sensible a une règle de permission et un audit (docs 5 et 8).
- Chaque table a `guild_id` ou une justification d'exception (doc 7).
- Chaque phase a ses tests nommés (doc 9).

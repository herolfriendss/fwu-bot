# PND V5 — Plan de tests

> Dépend de tous les documents. Base ✅ observée dans cette conversation : `node:test` côté bot, Vitest côté racine ; suites existantes exécutées avec succès sur des extraits (jamais sur le projet complet). `tsc` et lint sont signalés rouges avant ce lot (📄).

## 1. Principes

- Aucun test ne touche la production ni un jeton de production.
- Bases SQLite et fichiers d'état **temporaires** ; nettoyés en fin de test.
- Chaque résultat indique : commande exacte, version de Node, suite, nombre de tests. Les tests **simulés** (stubs, faux Discord) sont étiquetés comme tels.
- Une fonctionnalité Discord n'est « terminée » qu'après recette sur serveur de test.
- Un test qui échoue n'est jamais masqué ; les erreurs préexistantes sont listées à part.

## 2. Pyramide

| Niveau | Outil | Cible |
|---|---|---|
| U — Unitaire pur | `node:test` | politiques, bornes, parsing, calculs |
| S — Service | `node:test` + SQLite temporaire + `DiscordPort` simulé | ledger, quotas, migrations, isolation |
| A — Adaptateur | `node:test` + faux discord.js | parité slash / préfixe / composant |
| C — Catalogue | `node:test` | cohérence, limite de 100, services résolus |
| M — Migration | `node:test` | montée de schéma, idempotence |
| D — Dashboard/API | Vitest | fonctions serveur, refus d'accès |
| X — Sécurité | `node:test` | refus, fuite, élévation, injection |
| R — Recette | manuelle, serveur de test | Discord réel |

## 3. Commandes

```bash
source /home/randoinryan/.config/nvm/nvm.sh && nvm use 24.22.2
npm --prefix bot test                    # bot : node:test
npx vitest run --maxWorkers=1            # racine (la suite parallèle stagnait en Phase 1)
npx tsc --noEmit                         # typecheck (erreurs préexistantes à isoler)
```

## 4. Suites par domaine

**Plateforme (P1)**
- U-PL-01 : le registre rejette un module sans dépendance, sans commande au catalogue, avec migration non additive.
- C-PL-02 : ≤ 100 commandes de premier niveau ; aucune entrée sans service ; noms uniques.
- C-PL-03 : documentation générée complète.
- S-PL-04 : service exécuté avec `DiscordPort` simulé, sans discord.js.
- S-PL-05 : isolation générique de tous les dépôts.

**Permissions (P2)**
- U-PE-01 : matrice tier × scope × action × état de guilde (générée).
- U-PE-02 : WHITELIST ne change que les limites.
- X-PE-03 : PRIME — usage restreint à `entitlements.js` (test statique) ; membre non SYS+ refusé en guilde PRIME.
- X-PE-04 : SYS+ de A refusé en B.
- U-PE-05 : hiérarchie acteur/cible/bot.
- U-PE-06 : `/pnd*` refusé à tout sauf `PND_OWNER_DISCORD_ID`.
- A-PE-07 : composant d'un autre auteur refusé.

**Parité V4 (chaque groupe migré)**
- A-PA-NN : même entrée → même décision et même effet que la commande V4 sur jeu de données identique. Bloque tout retrait d'un nom slash.

**Guardian (P2)**
- S-GU-01 : un dossier unique par sanction ; transaction warning + dossier.
- U-GU-02 : une rafale seule ne sanctionne pas un compte établi.
- U-GU-03 : un seul appel ouvert sous 7 jours.
- X-GU-04 : aucune sanction déclenchée par un résultat IA.

**Economy (P3)**
- S-EC-01 : `SUM(ledger) = solde` sur 10 000 opérations aléatoires reproductibles (graine).
- S-EC-02 : `UPDATE`/`DELETE` du ledger refusé.
- S-EC-03 : idempotence d'un transfert rejoué.
- S-EC-04 : coupure simulée entre débit et crédit → état réconcilié.
- S-EC-05 : escrow, surenchère, remboursement, échéance.

**Voice (P4)**
- S-VO-01 : réconciliation au démarrage (salon supprimé hors ligne, salon orphelin).
- S-VO-02 : restauration des permissions après redémarrage (instantanés persistants).
- U-VO-03 : `/setup` refuse `tempVoice` activé sans hub ni catégorie.
- A-VO-04 : `voiceAccess` préservé par une sauvegarde sans rapport.
- R-VO-05 : recette Discord (création, suppression, menotte, reconnexion).

**DOG (existant)** : U/S existants conservés ; S-DO-01 import JSON → SQLite idempotent ; S-DO-02 quota par guilde inchangé.

**Music (P5)** : suites existantes avec faux flux ; R-MU-01 recette (lecture audible, pause, reprise, skip, erreur de flux, reconnexion, radio persistante).

**Automation (P8)** : U-AU-01 règle invalide rejetée ; S-AU-02 aperçu sans effet ; S-AU-03 désactivation immédiate ; X-AU-04 action destructive sans confirmation refusée.

**Intelligence (P9)**
- U-AI-01 plan invalide rejeté ; outil hors allowlist refusé.
- X-AI-02 injection de prompt n'appelle aucun outil de permission.
- S-AI-03 aperçu sans appel d'écriture.
- S-AI-04 vérification : écart → `partial`.
- S-AI-05 annulation : création puis undo = état initial.
- U-AI-06 quotas par guilde et par membre.
- S-AI-07 isolation de la mémoire entre guildes.
- R-AI-08 recette sur serveur de test avec fournisseur local.

**Dashboard/API (P10)**
- D-DA-01 chaque route refuse sans cookie propriétaire/secret.
- D-DA-02 aucune valeur de secret dans les réponses.
- D-DA-03 validation de schéma (taille, types, identifiants).

**Migrations**
- M-MI-01 depuis un instantané de schéma V5 : réussite et idempotence.
- M-MI-02 comptage avant/après sans perte.
- M-MI-03 sauvegarde automatique créée avant migration.

## 5. Critères d'entrée et de sortie par phase

- **Entrée** : sources auditées ; suite de base exécutée (P0).
- **Sortie** : tous les tests nommés de la phase verts ; aucun test préexistant dégradé ; commandes et résultats consignés dans STATUS et CHANGELOG ; commit local réversible.
- **Recette** : protocole écrit, serveur de test dédié, jeton de test, résultats consignés ; échec = phase non terminée.

## 6. Environnement de test

- Application Discord de test distincte, serveur de recette dédié, endpoint et secret de synchronisation de test, intents privilégiés activés (Message Content, Server Members) pour l'application de test.
- Faux Discord (`DiscordPort`, `discord.js` simulé) pour l'automatisation ; documenté et jamais présenté comme preuve de comportement Discord réel.
- Fournisseur IA simulé pour les tests ; fournisseur local pour la recette.

## 7. Critères de validation du plan

Chaque règle de sécurité et de permission a au moins un test nommé ; chaque module a son test d'acceptation ; chaque phase a ses critères de sortie ; aucune phase ne repose sur une recette impossible à exécuter (jeton de test et serveur de test requis avant P4/P5/P9).

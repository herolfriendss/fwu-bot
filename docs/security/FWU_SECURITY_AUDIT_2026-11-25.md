# Audit de sécurité FWU — 25 novembre 2026

## Résumé exécutif

Cet audit porte sur le code source de l'écosystème FWU et des six applications Discord associées. Il cible en priorité les risques d'élévation de privilèges, les attributions de rôles, les contrôles de hiérarchie, les API internes et l'authentification du dashboard.

**État : corrections de sécurité appliquées sur une branche de travail ; revue et CI encore en cours.** Cette revue statique n'est pas un test d'intrusion du serveur Discord ou du VPS en production et ne permet pas de certifier l'absence de toute vulnérabilité.

## Périmètre examiné

- Contrôles d'accès communs aux commandes slash, commandes préfixées et composants interactifs.
- Règles OWNER PND, propriétaire Discord du serveur, SYS+, ADMIN+ et WHITELIST.
- Garde centrale des attributions de rôles et permissions sensibles.
- Hiérarchie des membres, actions de modération et bouclier OWNER.
- Flux de configuration du dashboard vers l'API interne `/api/public/bot-sync`.
- Authentification OAuth Discord, session propriétaire et opérations dashboard.
- Principaux chemins d'attribution de rôles : gestion des rôles, rôles temporaires, promotion staff, rôles personnalisés, quarantaine, économie et rankall.
- Catalogue de permissions propre à chaque application.

## Vulnérabilités et corrections

### SEC-001 — Contrôle de hiérarchie ouvert en cas d'erreur Discord
**Sévérité : élevée (P1) — corrigé dans cette branche**

Le bouclier central pouvait traiter une erreur de récupération d'un membre comme si Discord avait confirmé que ce membre n'était pas présent sur le serveur. Cette distinction est importante : l'absence confirmée peut être normale pour un bannissement par identifiant, mais une panne réseau, une erreur API ou un résultat de hiérarchie illisible ne doit jamais faire disparaître le contrôle de rang.

**Correction :**
- récupération forcée du membre avant la décision ;
- seul le code Discord `10007` (« Unknown Member ») représente un membre réellement absent ;
- les autres erreurs de lecture bloquent l'action ;
- un membre dont la position de rôle n'est pas vérifiable ne peut plus être traité comme une cible de rang inférieur ;
- exception explicite pour le bannissement par ID d'un utilisateur confirmé absent.

**Tests ajoutés :** erreur API simulée, membre absent, bannissement par ID, propriétaire Discord du serveur et égalité de hiérarchie.

### SEC-002 — API bot-sync faisait confiance à l'identifiant d'acteur fourni
**Sévérité : élevée (P1) — corrigé dans cette branche**

Le secret `BOT_SYNC_SECRET` authentifiait le processus bot, mais certains changements de configuration acceptaient un `actorId` simplement fourni dans le JSON :
- configuration du rôle SYS+ ;
- configuration de PND Intelligence ;
- configuration du rôle WHITELIST ;
- écriture des réglages de modules depuis Discord.

L'identifiant d'acteur n'était pas, à la frontière de l'API, une preuve d'autorisation humaine.

**Correction :**
- les actions de configuration SYS+, PND Intelligence et WHITELIST exigent désormais une égalité exacte avec `PND_OWNER_DISCORD_ID` ;
- les modifications de modules revalident l'acteur auprès de l'API Discord : propriétaire réel du serveur ou membre dont les rôles détenus confèrent réellement `ManageGuild` ou `Administrator` ;
- si Discord ne permet pas de vérifier l'acteur, l'API répond par une erreur temporaire et n'écrit rien ;
- l'autorisation ne se base pas sur un nom de rôle, un rôle non détenu ou une permission déclarée par le client.

**Tests ajoutés :** propriétaire configuré, propriétaire du serveur, rôle ManageGuild, rôle Administrator et tentatives d'usurpation par rôle non détenu.

### SEC-003 — Le bouclier OWNER ne couvrait pas les refus hérités des rôles
**Sévérité : élevée (P1) — corrigé dans cette branche**

Le bouclier bloquait les refus de permissions explicitement adressés à l'identifiant OWNER. En revanche, un refus ciblant un rôle détenu par l'OWNER, ou le rôle `@everyone`, pouvait retirer indirectement son accès à un salon.

**Correction :**
- le bouclier prend en compte les identifiants des rôles réellement détenus par l'OWNER ainsi que `@everyone` ;
- les opérations d'overwrite sur un salon, sa création et sa modification sont examinées ;
- si les rôles de l'OWNER ne peuvent pas être vérifiés, l'opération est refusée par sécurité.

**Tests ajoutés :** refus direct, refus via un rôle détenu, refus via `@everyone`, permissions autorisées et rôle tiers.

Cette protection est volontairement conservatrice : certains refus sur un rôle de l'OWNER peuvent être rejetés même lorsqu'une autre permission ou un autre rôle compense cet accès. Il faudra vérifier les cas particuliers de configuration des salons sur le serveur avant mise en production.

### SEC-004 — Modification du rôle pendant une opération rankall
**Sévérité : moyenne (P2) — corrigé dans cette branche**

L'aperçu et la confirmation de `/rankall` vérifiaient que le rôle ne portait pas de permissions sensibles. Mais une attribution globale peut durer plusieurs minutes. Une modification du rôle pendant l'exécution pouvait rendre le rôle dangereux après le contrôle initial.

**Correction :**
- à chaque itération, le traitement relit le rôle depuis le cache Discord courant ;
- il s'arrête si le rôle a disparu, est géré, devient `@everyone`, reçoit une permission sensible ou passe au-dessus du rôle du bot ;
- le rôle revérifié est celui utilisé pour l'attribution.

**Test ajouté :** le rôle reçoit la permission Administrator au milieu d'une opération ; les membres suivants ne doivent pas le recevoir.

### SEC-005 — Droits SQL trop larges sur la table de configuration
**Sévérité : moyenne (P2) — migration corrective ajoutée, non appliquée à distance**

La migration historique de création de `bot_settings` accordait `ALL` à `service_role`. L'application utilise cette table pour lire et faire des `upsert` ; elle n'a pas besoin d'y exécuter `DELETE`, `TRUNCATE`, `REFERENCES` ou `TRIGGER`.

**Correction proposée dans le dépôt :**
- nouvelle migration additive `202611250002_bot_settings_least_privilege.sql` ;
- activation/maintien de RLS ;
- révocation explicite des droits `PUBLIC`, `anon` et `authenticated` ;
- remplacement du `GRANT ALL` par `SELECT`, `INSERT` et `UPDATE` pour `service_role`.

La migration est ajoutée au dépôt mais n'a pas été appliquée au projet Supabase distant. Il faudra l'exécuter et vérifier son état dans Supabase avant de considérer ce point comme corrigé en production.

### SEC-006 — Corps de requête interne non borné
**Sévérité : faible à moyenne (P2) — corrigé dans cette branche**

L'API interne `bot-sync` analysait directement le corps JSON sans limite explicite de taille. Un processus possédant le secret interne pouvait donc provoquer une consommation mémoire excessive avec un payload inutilement volumineux.

**Correction :** le POST est maintenant limité à 256 Ko avant parsing ; les JSON invalides, tableaux et valeurs primitives sont refusés avant le traitement des actions.

## Contrôles existants positifs observés

- Le propriétaire PND est identifié par ID Discord configuré, pas par nom ou surnom.
- SYS+, ADMIN+ et WHITELIST reposent sur des identifiants de rôle dédiés ; leur configuration est limitée au propriétaire PND.
- La garde de rôles sensibles détecte les permissions à partir des bitfields Discord et des IDs de rôles protégés.
- Les automatismes vérifiés (boutique, rôles temporaires, promotions, quarantaine et attribution générale) appellent des contrôles de rôles ou limitent les permissions des rôles créés.
- Les rôles personnels sont créés sans permissions Discord.
- L'OAuth du dashboard utilise un état à usage unique, PKCE, session HTTP-only et vérification du propriétaire configuré.
- Le catalogue de permissions des applications est spécifique à chaque profil et ne demande pas la permission globale Administrator.

## Points restant à vérifier avant toute mise en production

Ces points ne sont pas présentés comme des vulnérabilités confirmées : ils nécessitent des accès/configurations ou des essais en environnement réel.

1. **Discord — installation réelle :** vérifier les permissions accordées à chacune des six applications et la position de chaque rôle de bot sur chaque serveur. Une permission configurée dans le code n'est pas la preuve que le rôle Discord en production est correctement positionné.
2. **VPS / PM2 / Linux :** contrôler les propriétaires et permissions des fichiers `.env`, les utilisateurs Unix par processus, l'exposition des ports, SSH, les règles réseau, les journaux et les droits de redémarrage.
3. **Secrets :** vérifier le stockage, la rotation et la séparation des tokens Discord, `BOT_SYNC_SECRET`, `SESSION_SECRET`, clés Supabase et clés fournisseurs IA. Le partage du secret bot entre plusieurs processus doit être évalué selon le niveau d'isolation réel.
4. **Supabase :** examiner les politiques RLS de toutes les tables sensibles, les droits de la clé service-role, les migrations appliquées et les sauvegardes/restaurations réelles.
5. **Interactions et commandes :** compléter la revue des gestionnaires de boutons, modales, événements et flux différés par des tests d'intégration couvrant chaque commande destructive.
6. **Restauration :** tester les cas où un rôle sauvegardé reçoit des permissions sensibles après la mise en quarantaine, avant de le restaurer à son titulaire.
7. **Dépendances et chaîne CI/CD :** exécuter l'audit des dépendances, vérifier les permissions minimales du workflow GitHub et activer les contrôles de sécurité du dépôt.

## Validation

Les tests unitaires ajoutés doivent réussir avec les tests existants et les contrôles TypeScript, lint, audit des commandes et packaging. Le résultat CI sera reporté séparément lorsqu'il sera terminé.

## Limites

L'audit est une analyse statique du dépôt et des chemins de code consultés. Il n'a pas utilisé de tokens de production, n'a pas exécuté de commandes destructives sur un serveur Discord réel, n'a pas inspecté la configuration effective de l'Oracle VPS et n'a pas vérifié les paramètres RLS Supabase sur le projet distant.

**Ne pas interpréter cet audit comme une garantie « zéro faille ».** La prochaine étape avant une mise en production doit être une validation dynamique contrôlée sur un serveur de test, avec des comptes aux niveaux Owner, SYS+, ADMIN+, staff et membre simple.

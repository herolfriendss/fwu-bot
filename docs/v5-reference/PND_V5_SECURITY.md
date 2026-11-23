# PND V5 — Sécurité

> Dépend de : PERMISSIONS, DATABASE, AI_SPEC. Règles ✅ reprises d'`AGENTS.md` et du code lu (`bot-sync.ts`, `bot-settings.server.ts`, `module-settings.js`).

## 1. Modèle de menaces

| Menace | Vecteur | Contrôle principal |
|---|---|---|
| Élévation de privilèges | commande, composant, IA | `authorize` unique, permissions re-résolues, intersection IA |
| Fuite inter-serveurs | requête sans `guild_id` | dépôts bornés, tests d'isolation |
| Vol de secret | journaux, dashboard, exports | secrets serveur seulement, masquage, aucun secret dans les archives |
| Abus d'API | route publique | signature Ed25519 / secret, limites de débit |
| Injection de prompt | contenu Discord → IA | contenu = donnée, outils typés, validation indépendante |
| Fraude économique | transferts rejoués, boucles | ledger append-only, idempotence, plafonds |
| Raid / spam | rafales, mentions | GuildGuard, seuils bornés, exemption WHITELIST limitée |
| Régression V4 | refonte | pont legacy, parité testée |
| Perte de données | migration, bug | sauvegarde avant migration, restauration testée |

## 2. Secrets

- Jetons Discord, `BOT_SYNC_SECRET`, clés IA, clés de chiffrement : **variables d'environnement serveur** uniquement.
- Jamais dans le dépôt, les archives de distribution (liste blanche explicite, existant ✅), les journaux, les réponses d'API (présence seulement, jamais la valeur — règle existante).
- Jeton de production **interdit** dans les tests ; application et serveur de test dédiés.
- Rotation documentée ; une fuite supposée = rotation immédiate.
- Masquage automatique des motifs de jeton dans le logger.

## 3. Isolation multi-serveurs

- Dépôts à portée de guilde (doc 7 §5).
- Journaux et statistiques identifient la guilde source ; **aucune republication croisée de données privées** (règle existante).
- Hub de logs : destination isolée, ACL vérifiées (rôles de logs sans Administrator, refus de `@everyone`, salon synchronisé) — existant 📄.
- MZ : `PND_MZ_ENABLED` absent/faux → toute action refusée au point 1 de `authorize`.
- Test : un jeton de session ou un identifiant de guilde A ne lit jamais la guilde B.

## 4. Authentification et API

- Dashboard : session propriétaire par cookie (existant) ; **chaque fonction serveur appelle `requireOwner()` en premier** (règle existante).
- Modules `*.server.ts` jamais exportés vers le client.
- Interactions Discord : signature Ed25519 vérifiée sur le corps brut.
- Bot ↔ dashboard : `Authorization: Bearer BOT_SYNC_SECRET`, comparaison en temps constant.
- Entrées : schéma strict, taille limitée (existant : refus au-delà de 100 000 caractères sur `module-settings`), identifiants validés.
- Aucun accès SQLite depuis le navigateur.

## 5. Actions sensibles

Confirmation obligatoire (bouton lié à l'auteur, expiration) pour : bannissement, suppression de salon/rôle, modification de permissions, opérations de masse, restauration, activation d'une automatisation destructive, exécution de plan IA à risque élevé. Journal avant et après.

## 6. Limites d'utilisation et anti-abus

- Cooldowns par commande et par acteur ; quotas par guilde.
- WHITELIST ne lève que les **limites internes** listées au catalogue ; jamais les contrôles Discord, la hiérarchie ou l'autorisation.
- Limites IA : requêtes, jetons, écritures, concurrence (doc 6 §10).
- Débit API : par IP et par route ; réponse 429 homogène.
- Anti-spam/mentions : seuils bornés, suppression, timeout avec vérifications natives (existant 📄).

## 7. Audit

`audit_log` append-only : acteur, type d'acteur (humain/IA/système), action, cible, décision, code, `request_id`. Les refus sont journalisés. Pas de contenu de message ni de secret. Consultation réservée SYS+/GUILD_OWNER ; export limité à la guilde.

## 8. Gestion des erreurs

- Erreurs de domaine → message clair à l'utilisateur ; erreurs techniques → message générique + `request_id`.
- Aucune trace de pile ni détail interne côté Discord.
- Un module en échec est isolé et mis en état `degraded` ; il ne bloque pas le bot.
- Reprise : les `jobs` et `escrows` en état `pending` sont réconciliés au démarrage.

## 9. Sauvegardes

Voir DATABASE §7. Fichier de sauvegarde = donnée sensible : stockage hors dépôt, accès restreint, somme de contrôle. Restauration d'abord sur copie. Aucun accès Oracle/VPS sans votre approbation.

## 10. Chaîne d'approvisionnement

- Dépendances : minimales, open source, compatibles Node 24 et lockfiles ; justification écrite avant ajout.
- Archive de distribution : liste blanche, jamais `.env`, données, métadonnées de dépôt ou dépendances (existant ✅).
- Versions épinglées ; audit des vulnérabilités avant chaque lot.

## 11. Critères de validation

- Tests de refus : sans signature, sans secret, sans cookie propriétaire, mauvaise guilde, mauvais auteur de composant.
- Test de fuite : aucun secret ne figure dans les journaux, les réponses d'API et l'archive de distribution (recherche de motifs).
- Test d'élévation : l'IA et un ADMIN+ sans scope sont refusés sur les actions SYS+.
- Test de reprise : coupure simulée pendant un transfert → état cohérent au redémarrage.
- Revue humaine obligatoire avant toute activation (Discord réel, Oracle, MZ, paiement).

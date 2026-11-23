# PND V5 — Fonctionnalités par module

> Dépend de : MASTER_PLAN, ARCHITECTURE. Les états « existant » proviennent des documents (📄) sauf mention ✅ : le code des modules n'a pas été vu. Les phases sont celles du plan directeur.

Convention de chaque fiche : **Tier** · **Existant** · **À créer** · **Services** · **Données** · **Acceptation**.

## Guardian — CORE (analytics avancés : SYS+) — P2
- Existant 📄 : GuildGuard (anti-raid fail-safe, confinement), anti-spam et anti-mentions réglables via `/setup`, dossiers de modération, appels de sanction (7 jours), WHITELIST exemptée des quotas. ✅ GuildGuard n'annonce plus de quarantaine non appliquée.
- À créer 🆕 : détection transverse d'abus (rafales de joins, mentions, liens), score de risque **informatif**, file de revue staff.
- Services : `guardian.warn/mute/kick/ban`, `guardian.caseOpen`, `guardian.appeal`, `guardian.raidAssess`.
- Données : `moderation_cases`, `warnings`, `appeals`.
- Acceptation : aucune sanction automatique par IA ; un compte établi n'est jamais sanctionné par une simple rafale ; chaque sanction crée un dossier unique.

## Intelligence — SYS+ — P9
Spécifié dans `PND_V5_AI_SPEC.md`. Dépend de tous les services (outils). Acceptation : voir doc 6.

## Economy — CORE (avancée : SYS+) — P3
- Existant 📄 : métiers, missions quotidiennes, contrats communautaires (escrow), marché de rôles, enchères (escrow, worker), boutique, transferts.
- À créer 🆕 : ledger append-only, antifraude (plafonds, vélocité, détection de boucles), réconciliation des états `pending` après coupure.
- Services : `economy.transfer/credit/debit/escrowOpen/escrowRelease`.
- Données : `economy_accounts`, `economy_ledger`, `escrows`.
- Acceptation : somme du ledger = solde ; aucun solde négatif ; une opération rejouée est idempotente.

## Business — CORE (avancé : SYS+) — P3
- À créer 🆕 : entreprises de joueurs (création, employés, revenus, impôts), reliées au ledger. Réutilise métiers et contrats.
- Données : `businesses`, `business_members`.
- Acceptation : un revenu d'entreprise passe toujours par le ledger.

## Investments — SYS+ — P3
- À créer 🆕 : placements à rendement simulé borné, risque configurable par guilde, aucune monnaie réelle.
- Données : `investments`, `investment_ticks`.
- Acceptation : plafonds par membre, tirages reproductibles (graine journalisée).

## Social — CORE (avancé : SYS+) — P6
- Existant 📄 : profils, bio, réputation (`rep`, `toprep`), cartes, `salut`.
- À créer 🆕 : relations, badges, profil personnalisable (« studio personnel », SYS+).
- Données : `social_profiles`, `reputation_events`, `badges`.
- Acceptation : réputation limitée par cooldown ; isolation par guilde.

## Events — CORE — P6
- Existant 📄 : `event`, `giveaway`, `sondage`.
- À créer 🆕 : planification, rappels, inscriptions, récompenses via Economy.
- Données : `events`, `event_signups`.
- Acceptation : un tirage est vérifiable (graine et participants journalisés).

## Academy — CORE — P7
- À créer 🆕 : parcours d'accueil et formation (étapes, quiz, récompenses de rôle).
- Données : `academy_tracks`, `academy_progress`.
- Acceptation : attribution de rôle soumise à la hiérarchie Discord.

## Games — CORE (premium : SYS+) — P6
- Existant 📄 : blackjack, roulette, dés, pile ou face, loterie, trivia, cartes/packs.
- À créer 🆕 : sessions de jeu persistantes, mises via ledger, anti-abus.
- Données : `game_sessions`.
- Acceptation : toute mise est débitée avant résolution, jamais après.

## Awards — CORE — P7
- À créer 🆕 : élections et récompenses périodiques (votes uniques, clôture, annonce).
- Données : `award_campaigns`, `award_votes`.
- Acceptation : un vote par membre et par campagne.

## Wrapped — SYS+ — P7
- À créer 🆕 : bilan périodique par membre et par serveur, calculé depuis agrégats (pas de contenu de messages).
- Données : lit `analytics_daily`, `economy_ledger`, `social_profiles`.
- Acceptation : aucun contenu privé ; calculé par guilde.

## Radar — SYS+ — P7
- À créer 🆕 : analytics d'activité et alertes de tendance, agrégats quotidiens.
- Données : `analytics_daily`.
- Acceptation : métriques manquantes = `null`, jamais zéro (règle existante AGENTS) ; échantillons bornés étiquetés.

## Stories — CORE — P7
- À créer 🆕 : publications éphémères (annonces, récits de communauté) planifiées, avec modération préalable.
- Données : `stories`.
- Acceptation : expiration respectée, suppression propre.

## Recruitment — CORE — P7
- À créer 🆕 : candidatures staff (formulaire modal, revue, décision journalisée).
- Réutilise : Tickets pour les échanges.
- Données : `applications`.
- Acceptation : décision traçable ; données supprimées selon rétention.

## Tickets — CORE — P7
- Existant 📄 : `/ticket`, module `tickets` dans `bot-settings`.
- À créer 🆕 : catégories, transcriptions à rétention bornée, assignation staff.
- Données : `tickets`, `ticket_events` (métadonnées).
- Acceptation : accès au ticket limité auteur + staff ; fermeture journalisée.

## Voice — CORE — P4
- Existant ✅ partiel : tables `temp_voice`, `voice_panels`, `voice_menottes` (+ `expires_at`), module `tempVoice` dans `/setup` (hub + catégorie obligatoires), `voiceAccess` préservé aux sauvegardes. 📄 DOG, MENOTTE, LOCKNAME. ❓ `voice-v2.js`, `voice-commands.js` non vus.
- À créer 🆕 : audit complet, restauration persistante des permissions, nettoyage fiable après redémarrage.
- Acceptation : réconciliation au démarrage testée ; aucun salon orphelin.

## Music — CORE — P5
- Existant 📄 : moteur extrait, file, radio persistante avec retry, politique de sources HTTPS directes, `play-dl` retiré.
- À créer 🆕 : recette réelle sur serveur de test (non validée). Aucun scraping.
- Acceptation : protocole `docs/recettes/musique-radio-discord.md`.

## Automation — SYS+ (basique : CORE) — P8
- Existant ❓ : `automation.js`, module `automation` dans `bot-settings`.
- À créer 🆕 : règles « événement → conditions → actions » avec aperçu, confirmation et journal.
- Données : `automations`, `automation_runs`.
- Acceptation : toute règle est désactivable ; aucune action destructive sans confirmation.

## Dashboard — P10
- Existant ✅ : `bot-sync` (réglages, module-settings), statut ; ❓ le reste.
- À créer 🆕 : gestion serveurs/modules, SYS+, statistiques, automatisations, supervision IA, licences (lecture seule).
- Acceptation : refus d'accès prouvé pour chaque route ; aucune clé exposée.

## Packs premium SYS+ (clés d'entitlement)
`ai.advanced`, `automation.advanced`, `analytics.advanced`, `commands.exclusive`, `creator.studio`, `server.tools`, `social.advanced`, `economy.advanced`, `games.premium`, `studio.personal`, `cloud`, `marketplace`, `extensions`, `lab`.

| Pack | Contenu proposé 🆕 |
|---|---|
| Creator Studio | outils de contenu (Stories, Events, annonces) |
| Server Tools | gabarits de serveur, instantané de structure |
| Cloud | export/sauvegarde par guilde |
| Marketplace / Extensions | catalogue et API d'extensions (désactivé tant que l'API de plugins n'est pas spécifiée) |
| Laboratory | fonctionnalités expérimentales, **PRIME d'abord** |

Aucun pack n'implique de paiement.

## Critères de validation du document
Chaque module a un manifeste conforme à l'ARCHITECTURE §4, au moins une table nommée au doc 7, un groupe de commandes au doc 4 et un test d'acceptation au doc 9.

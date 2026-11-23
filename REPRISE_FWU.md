# FWU — Point de reprise (multi-bots)

Ce fichier sert à reprendre le travail plus tard, dans une nouvelle session.
Il est mis à jour à chaque étape terminée.

## Décisions du propriétaire (23/11/2026)

| Bot | Profil technique | Rôle |
|---|---|---|
| **FWU** | `fwu` | Le bot actuel. **Garde son application et son token** (`DISCORD_TOKEN`). Écoute tous les événements (logs, audit, ACL). Porte `/ban` (et la future blacklist), les tickets, le social, les jeux, RESUME. Reprend automatiquement un domaine si son bot dédié est arrêté. |
| **GUARD** | `guard` | Administration et protection : GuildGuard, avertissements, mute, kick, purge, verrouillage, vérification, anti-spam, Guardian. |
| **FDPDLAVOC** | `fdpdlavoc` | Musique, radio, vocaux temporaires, `/pv`, `/access`, `/voc`. |
| **SUCK ME** | `suckme` | Tout le SYS+ : `/sysp`, rôles, rankall, DOG, MENOTTE, WAKEUP, WOUAF, LOCKNAME, Anti-Move, automation, webhook, panel, setup. |
| **LE FISC** | `fisc` | Toute l'économie : solde, banque, boutique, marché, enchères, casino, business, investissements. |

Autres décisions :
- Les bots **partagent leurs informations** (même base SQLite en WAL, un seul écrivain par tâche, verrous de domaine).
- **FWU écoute les événements** et centralise les logs des autres bots (file d'attente partagée).
- **Aucun bot n'est retiré.** Le token actuel n'est pas touché ; on transfère les commandes vers les nouveaux bots domaine par domaine.
- **RESUME est voulu à tout prix** : nommé `/afk on|off|resume` (et `=afk …`) pour ne pas entrer en conflit avec `/resume` de la musique.
- IA : pas prioritaire. Alertes LIVE configurables : à coder, faible priorité.

## Avancement

Voir la section « État » en bas, mise à jour à chaque étape.

## État

- [x] Répartition partagée `src/lib/bot-profiles.ts` + tests (`bot/bot-runtime.test.js`)
- [x] Runtime multi-bots `bot/bot-runtime.js` (profil, verrous de domaine, file de logs)
- [x] `index.js` : chaque gestionnaire filtré par domaine (mode historique identique)
- [x] RESUME `/afk` (`bot/resume.js`, `bot/resume.test.js`)
- [x] Bug bloquant corrigé : le bot ne pouvait pas démarrer (`recoverInterruptedPndIntelligenceActions` non exporté) + test `entrypoint-imports.test.js`
- [x] Démarrage réel testé hors Discord : FWU, GUARD et LE FISC en parallèle sur la même base
- [x] PM2 (`ecosystem.fwu-bots.config.cjs`), `.env.example`, scripts de mise à jour et retour arrière, guide `MULTI_BOTS_FWU.md`
- [x] Alertes LIVE : déjà configurables depuis le site (module V4 : salon, créateurs, flux RSS). Rien ajouté : en attente de ce qui manque exactement.
- [x] Vérifié : 534/534 tests bot, 226/226 vitest, tsc 0, build OK, banc d'essai 2 208 appels / 0 plantage

- [x] Branding : les textes visibles « 1942 » deviennent « FWU » ; chaque bot signe ses messages (« FWU • GUARD »…), couleur et pied réglables par bot (`PND_<BOT>_COLOR`, `PND_<BOT>_FOOTER`)
- [x] `/sysp diagnostic bots` : quel bot traite chaque domaine en ce moment
- [x] Site : la liste des commandes indique le bot propriétaire
- [x] Vérifié : 536/536 tests bot, 226/226 vitest, tsc 0, build OK, banc d'essai 2 210 appels / 0 plantage

- [x] DM ALL (`bot/dmall.js`) : propriétaire seul, aperçu, confirmation, envoi progressif arrêtable, limites
- [x] Blacklist (`bot/blacklist.js`) sur FWU : OWNER et SYS+, ban par ID, rebannissement à l'arrivée
- [x] Vérifié : 550/550 tests bot, 226/226 vitest, tsc 0, build OK, banc d'essai 2 226 appels / 0 plantage, démarrage hors Discord OK

- [x] Bug corrigé : page Statut du site figée (codes d'événement inconnus) + test
- [x] Page Statut : état des 5 bots
- [ ] **Sauvegarde GitHub** : branche locale `github-fwu` prête (instantané propre). À envoyer sur le dépôt (renommé « FWU ») dès que l'accès en écriture GitHub est ouvert, en remplacement de l'ancienne V3.

## Prochaines étapes possibles

1. Toi : créer les applications de **test** et suivre `MULTI_BOTS_FWU.md` sur le serveur de test.
2. Moi, sur demande : couleurs choisies par bot, ajustements de la blacklist (débannir au retrait ? tous les serveurs ?), ce qui manque aux alertes LIVE.

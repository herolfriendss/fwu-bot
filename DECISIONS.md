# FWU — Décisions en vigueur

Mis à jour le 27/11/2026. Ce fichier liste les choix **actuels**. Quand une décision en remplace une autre, l'ancienne est rayée dans la section « Remplacées » en bas, avec la date du changement.

Chaque choix se change sans toucher au code (variable d'environnement ou commande Discord), sauf mention contraire. Le détail des 5 bots est dans `MULTI_BOTS_FWU.md`, celui des quotas dans `docs/FWU_BASE_PARTAGEE.md`.

## Droits et rôles

| # | Sujet | Choix appliqué | Pour changer |
|---|---|---|---|
| 1 | Droits de Btk et MZ | Aucun droit propre. Seul `PND_OWNER_DISCORD_ID` est OWNER. | Leur donner le rôle SYS+ ou ADMIN+ dans Discord. |
| 2 | SYS+ et MENOTTE / WAKEUP | Réservé à l'OWNER et aux ADMIN+ dont le scope vocal est activé. Les messages d'erreur le disent clairement. | Donner aussi le rôle ADMIN+ aux SYS+ concernés, ou demander une modification du code. |
| 3 | Règle de rang pour l'OWNER | Pas d'exception : l'OWNER doit avoir un rôle au-dessus de sa cible pour DOG et MENOTTE (seul le propriétaire du serveur Discord y échappe, règle native). | Placer le rôle de l'OWNER en haut de la hiérarchie Discord. |
| 4 | Propriétaire du serveur ≠ OWNER FWU | Les deux restent distincts : le propriétaire du serveur garde ses privilèges natifs Discord. | Rien. |
| 22 | Paliers de modération (0, 1, 5, 10, 50 %…) | Seule l'association faite avec `/quota palier` donne un palier ou la protection 0 %. Le nom d'un rôle (« Moi 1 % ») ne compte plus, et « % » est refusé dans les noms de rôles perso. **Arrive avec la correction de sécurité des rôles** (fil « Verrouiller les rôles ») : avant de la déployer, faire `/quota palier` pour le rôle 0 % et chaque rôle de staff. | `/quota palier @rôle palier` (OWNER uniquement). |
| 23 | Rôles et accès sur le site | SYS+, WHITELIST, ADMIN+ et PND Intelligence sont en **lecture seule** sur le site. Ils se modifient seulement dans Discord, par l'OWNER, avec `/sysp` (chaque changement est journalisé). | Rien. |
| 24 | Rôle de laisse (DOG) | Un rôle par propriétaire : `En laisse (<nom du propriétaire>)`, partagé par toutes ses laisses, supprimé quand plus personne ne l'a (ton choix du 24/11). L'ancien rôle commun `En laisse` est reconnu et migré. | Rien. |

## Commandes et bots

| # | Sujet | Choix appliqué | Pour changer |
|---|---|---|---|
| 21 | Préfixes | **Un préfixe par bot** (ta décision du 24/11) : GUARD `+`, FDPDLAVOC `;`, SUCK ME `=`, LE FISC `-`. FWU reste en commandes slash uniquement. Une commande tapée avec le préfixe d'un autre bot ne fait rien (`=ban` ne fait rien, c'est `+ban`). `PND_PREFIX_COMMANDS` n'est plus utilisé. | `PND_DATA_DIR/bots.json` sur le VPS (modèle `bot/config/bots.example.json`), jamais écrasé par une mise à jour. |
| 30 | Mauvais préfixe | Une commande tapée avec le préfixe d'un autre bot (`=pv`) n'est jamais exécutée par un autre bot : seul son bot propriétaire répond, avec la bonne forme (`;pv`). `/pv` et `/unpv` rétablies sur FDPDLAVOC, `;moveall` ajouté (27/11). | Rien. |
| 17 | Nom affiché | **FWU V2** (ta décision du 26/11). Le nom « FWU » n'apparaît **plus nulle part dans Discord** : ni embeds, ni messages, ni raisons du journal d'audit, ni descriptions de commandes. Les bots dédiés signent de leur seul nom (« GUARD », « SUCK ME »…), le bot principal ne signe pas et se nomme « Bot principal ». Le nom reste sur le site et dans la documentation. Le nom des applications dans le Developer Portal n'est pas modifié par le code. Un test (`bot/discord-branding.test.js`) bloque tout retour de « FWU » dans un texte Discord. | `PND_<BOT>_FOOTER`, `PND_<BOT>_COLOR` (sans y remettre « FWU »). |
| 19 | `/sondage` et `/nettoyer` | Tous les deux sur FWU (ton choix du 23/11). | Une ligne dans `src/lib/bot-profiles.ts`. |
| 6 | `/salut` et `/info-serveur` | Gardés mais inaccessibles en slash (catalogue plein). Sans effet. | Rien. |
| 7 | Noms `her-v5-*`, `her-v3`, palette violette | **Conservés** en interne. Renommer les processus PM2 casserait le déploiement. | Rien. |
| 14 | RESUME | **Développé** : `/afk on\|off\|resume` sur SUCK ME (nommé ainsi pour ne pas entrer en conflit avec `/resume` de la musique). | Rien. |
| 15 | Relations entre membres | **Développées le 27/11** (`/famille` sur SUCK ME) : mariage et adoption avec l'accord de l'autre personne (bouton, 15 min), un seul conjoint, deux parents au plus, 6 enfants au plus, aucune boucle dans l'arbre, retrait seul à tout moment (divorce, émancipation, reniement). Arbre sur trois générations, famille affichée sur `/profil`. Bonus de couple : +10 % sur le bonus quotidien de LE FISC. Studio de profil et nouvelles fonctions IA : non développés. | `bot/features/family.js` (`MAX_CHILDREN`, `COUPLE_BONUS_RATE`). |

## Modération et sécurité

| # | Sujet | Choix appliqué | Pour changer |
|---|---|---|---|
| 25 | Quotas de modération | Partagés entre les 5 bots via la base centrale PostgreSQL (`tempmute`, `warn`, `kick`, `ban`, `unban`, `blacklist`, `mv`). Si la base est injoignable, ces commandes sont refusées pour tous sauf l'OWNER. | `/quota definir`, `/quota exemption` (OWNER uniquement). |
| 31 | Ban temporaire et appel | `+tempban @membre durée [raison]` / `/tempban` (GUARD) : 1 minute à 365 jours, débanni automatiquement (bot principal en relais si GUARD est arrêté), quota « ban ». Le MP de sanction avec le bouton « Faire appel » part **avant** le ban (après, Discord empêchait de l'écrire). Un appel accepté par le staff lève tout de suite le ban ou l'exclusion en cours (27/11). | Rien. |
| 18 | Blacklist | Sur FWU, à côté de `/ban` : OWNER et SYS+. Bannissement immédiat par ID, rebanni automatiquement s'il revient. Le rang Discord reste respecté. **Retirer un compte de la blacklist le débannit aussi** (ton choix du 23/11). Liste propre à chaque serveur. | Rien. |
| 13 | rankall | OWNER uniquement, rôles à permission sensible refusés, 5 000 membres maximum. | `PND_RANKALL_MAX_MEMBERS`. |
| 16 | DM ALL | **Toi seul**. Aperçu → confirmation sous 60 s → un MP toutes les 1,5 s, arrêt possible. Bots exclus, aucune mention, 1 000 destinataires maximum, 1 h minimum entre deux envois. Jamais relancé seul après un redémarrage. Le contenu n'est pas copié dans les logs. | `PND_DMALL_MAX_MEMBERS`, `PND_DMALL_STEP_DELAY_MS`, `PND_DMALL_COOLDOWN_MS`. |
| 11 | Transcriptions de tickets | **Désactivées** : les activer suppose d'informer les membres que leurs échanges sont conservés. | `PND_TICKET_TRANSCRIPT_DAYS=30` (1 à 90 jours). |

## Économie et vocal

| # | Sujet | Choix appliqué | Pour changer |
|---|---|---|---|
| 9 | Seuils antifraude des transferts PND | 7 jours de compte, 3 jours sur le serveur, 50 000 PND et 20 transferts par 24 h. WHITELIST lève les plafonds, pas l'ancienneté. | `PND_TRANSFER_*` dans `bot/.env`. |
| 12 | Seuils de réputation | 7 jours de compte, 3 jours sur le serveur, 5 points par 24 h. | `PND_REP_*`. |
| 5 | WAKEUP | Pause de 1,5 s entre deux salons, 60 s par auteur, 25 salons maximum. La cible reste dans le dernier salon. | `PND_WAKEUP_STEP_DELAY_MS`, `PND_WAKEUP_COOLDOWN_MS`. |
| 10 | PV retiré à la main pendant l'arrêt du bot | Réappliqué au démarrage (la commande unpv reste possible et restaure l'état d'origine). | Utiliser unpv avant de modifier un salon à la main. |
| 20 | Alertes LIVE | Réglables depuis Discord (`/live`, sur SUCK ME, OWNER et SYS+), avec un rôle mentionné à chaque annonce (ton choix du 23/11). Jamais @everyone. | `/live role @rôle` ou le site. |
| 28 | Capital des prêts du FISC | Le prêt est créé à partir de rien et son capital est toujours détruit au remboursement. La caisse ne reçoit que les intérêts et la pénalité, que le remboursement soit volontaire ou forcé (choix du 26/11). | Rien. |
| 32 | Braquage (`/braquage`, LE FISC) | Équipe de 3 à 5 membres formée en 3 minutes. Réussite 35 % à 3, jusqu'à 49 % à 5. Le butin vaut 10 % de la caisse du serveur (20 000 PND maximum), partagé à parts égales. En cas d'échec, chacun paie 200 PND d'amende (portefeuille puis banque, jamais en négatif), versés à la caisse. Un braquage toutes les 2 h par serveur, 6 h de repos par membre, caisse d'au moins 1 000 PND. | Constantes `HEIST` dans `bot/features/heist.js`. |
| 33 | Blind test (`/blindtest`, FDPDLAVOC) | Extraits de 30 s joués dans le vocal de l'organisateur par le moteur musical (yt-dlp + FFmpeg), en sautant l'intro des titres longs. Réponses écrites dans le salon : titre 2 pts, artiste 1 pt, au premier qui trouve, fautes de frappe légères tolérées. Liste par défaut de 40 titres connus, ou une playlist musique du membre. Une partie par serveur ; impossible pendant la musique et inversement. Arrêt par l'organisateur ou le staff. Classement cumulé par serveur. Gains en PND à la fin : 20 PND par point, +100 PND au gagnant (ex aequo : chacun). | Constantes `BT` et `DEFAULT_SONGS` dans `bot/features/blindtest.js`. |
| 34 | Offrir un abonnement Invest + (`/abonnement offrir`) | Seulement les formules payables en PND, payées par le donateur après confirmation. Une autre formule active ou en pause chez le bénéficiaire n'est jamais remplacée (la même est prolongée). Le cadeau compte dans les paiements du tableau de bord. | Rien. |
| 35 | Doubles comptes (GUARD) | Guardian ne le faisait pas. Un bot ne voit ni IP ni appareil : à chaque arrivée, le compte est comparé à la liste des bannis du serveur (photo de profil identique 60 pts, nom presque identique 40 pts ou ressemblant 25 pts, puis compte de moins de 7 jours et photo par défaut en bonus). À partir de 50/100, une alerte part dans les logs de modération. **Jamais de sanction automatique.** `/doublecompte` (ou `+doublecompte`) vérifie un compte à la demande (staff : Bannir ou Exclure, ou palier 10 %). | Constantes `ALT` dans `bot/guard/alt-detect.js`. |
| 36 | Lecture vocale (`/lecture`, FDPDLAVOC) | Le bot rejoint le vocal et lit les messages écrits dans le chat de ce vocal, par les membres présents (« Pseudo : message », 200 caractères, 5 messages en attente au plus, commandes jamais lues). Synthèse **locale** : rien n'est envoyé à un service extérieur. Moteur espeak-ng par défaut (**à installer sur le VPS** : `sudo apt-get install -y espeak-ng`), ou Piper (voix plus naturelle) avec `PND_PIPER_MODEL`. Départ automatique si le vocal est vide ou après 30 min sans message. Une seule activité vocale à la fois (musique, blind test ou lecture). | `PND_TTS_VOICE`, `PND_ESPEAK_PATH`, `PND_PIPER_MODEL`, `PND_PIPER_PATH`. |

## Site et mises à jour

| # | Sujet | Choix appliqué | Pour changer |
|---|---|---|---|
| 26 | Enregistrement des réglages | Le site et `/setup` n'envoient que ce qui a changé, avec la valeur de départ. Si quelqu'un a modifié la même chose entre-temps, l'enregistrement est refusé (erreur 409) au lieu d'écraser. | Rien. |
| 27 | `/maj` | Installe ce qui est publié sur `main`. Une branche de travail n'arrive sur le VPS qu'une fois fusionnée dans `main`. | Voir la PR de l'Éclaireur (versions numérotées). |
| 29 | Ordre après la recette V2 | Le socle commun passe avant les modules spécialisés : routeur déclaratif, puis CENTRAL/API, INCIDENT CENTER et LAB, ensuite GUARD, vocal, SUCK ME, économie et Invest + (choix du 26/11). | Rien. |
| 8 | Vieux documents | Les anciens rapports et audits sont rangés dans `docs/archives/` (25/11). Ils ne décrivent plus l'état actuel. | Rien. |

## Remplacées

- ~~**17 (23/11) — « FWU » partout dans Discord, signature « FWU • GUARD ».**~~ Remplacée le 26/11 : FWU V2, aucun « FWU » dans Discord.

- ~~**21 (23/11) — Commandes `=` abandonnées, tout en slash.**~~ Remplacée le 24/11 par la décision 21 ci-dessus (un préfixe par bot, FWU en slash uniquement).
- ~~**14 (23/11) — RESUME non développé.**~~ Développé depuis (`bot/resume.js`).
- ~~**8 (23/11) — `DEMARRER_AVEC_CLAUDE.txt` laissé en l'état.**~~ Rangé dans `docs/archives/` le 25/11.
- ~~**Paliers lus dans le nom des rôles (« 10 % Modérateur »).**~~ Remplacé par la décision 22 (correction de sécurité des rôles).

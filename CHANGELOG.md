# Journal des changements

Ce qui est mis en ligne, du plus récent au plus ancien. Le site (Render) se déploie seul à chaque push sur `main` ;
les bots du VPS prennent la mise à jour avec `/maj lancer` ou la mise à jour automatique de 5 h.

## 28/11/2026 (nuit)
- Tous les bots : garde de budget de connexions Discord (pause croissante après 6 démarrages en 6 h, réserve des 10 dernières connexions du jour, plus de retour arrière déclenché par une attente volontaire).
- Bot principal et SUCK ME : alerte au staff quand un bot tombe, attend son budget de connexions, s'arrête définitivement ou revient (MP à l'OWNER pour un arrêt définitif).
- SUCK ME (STAFF CENTER) : `/staff dispo` (créneaux habituels), `/staff astreinte` (prendre, terminer, voir ; aucun rôle donné), `/staff disponibles` (qui est joignable maintenant), `/staff planning` (couverture de la semaine et trous), `/staff passation` (notes de relève). Aussi en préfixe `=staff`.
- SUCK ME (STAFF CENTER) : dossiers d'intervention `/staff intervention` (ouvrir, liste, voir, assigner, preuve, note, cloturer, valider), validation par un second responsable pour la priorité haute.
- SUCK ME (STAFF CENTER) : `/staff mission` (missions individuelles ou collectives, échéance, bilan) et `/staff reunion` (planification, rappel 30 min avant, comptes rendus).
- SUCK ME (STAFF CENTER) : `/staff formation` (cas pratiques raid, conflit, signalement corrigés ; certification des parcours Academy par un responsable, sans rôle automatique).
- SUCK ME (STAFF CENTER) : `/staff centre`, le tableau de commandement (staff joignable, dossiers, tickets, alertes, missions, réunions, état des bots).
- Infrastructure commune : événements avec identifiant universel et sans doublon ; file de tâches entre bots qui attend le retour d'un bot arrêté, sans perte ni double exécution.
- Infrastructure commune : journal d'audit chaîné (toute modification à la main dans la base est détectée).
- AUTHORITY (service) : registre des dérogations, approbation par l'OWNER seul, signature, expiration fiable, 15 cas d'attaque testés. 
- AUTHORITY sur SUCK ME (provisoire) : `/authority demander`, `mes-demandes`, `statut`, `historique` ; l'OWNER reçoit chaque demande en MP avec Approuver / Refuser, et dispose de `/authority panneau` et `/authority decider`.
- Bot principal : alerte au staff quand le disque, la mémoire ou le processeur du VPS saturent (et quand ça revient).
- GUARD : alerte quand les arrivées ou les départs d'une heure dépassent nettement la normale.
- Console : voyant global vert, orange ou rouge avec les raisons (aussi dans le badge « En direct »), historique des redémarrages.
- Invest + : `/abonnement auto` (renouvellement automatique en PND à l'échéance, si le solde suffit).
- Invest + : formules payables en PND (jusqu'à 1 milliard), en réel ou au choix, avec prix réel affiché ; le membre demande la formule en un clic et l'administration l'active avec « Paiement reçu : activer » (plus de membre à taper) ; instructions de paiement réglables.

## 27/11/2026 (soir et nuit)

### Sécurité
- Relais en chaîne : GUARD absent → le bot principal reprend ses protections ; bot principal absent aussi → SUCK ME. Alerte au staff, vérification des arrivées renforcée pendant l'absence de GUARD.
- AutoMod natif de Discord posé une fois par GUARD (spam, spam de mentions, phishing/faux Nitro), `/automod natif`, `/scan` vérifie la position des rôles et l'AutoMod.
- Alerte de panne par Supabase toutes les 2 min, même si tout est tombé (à activer avec l'URL d'un webhook, voir `docs/MODE_EMPLOI.md`).
- GUARD : contournement de ban, quarantaine automatique après phishing, alerte intégrations, alerte permission perdue ; `/raid purge`.
- Preuve obligatoire pour `/ban`, double validation des actions vocales de masse, appel examiné par un autre que l'auteur, alerte de connexion à la console.

### SYS+
- `/malus` (23 sous-commandes : perroquet, fantôme, mime, clown, robot, bébé, yoda, chuchote, sablier, malédiction, sourdine folle, exil, bouffon, roulette vocale, patate, tribunal, interrogatoire, taxe, rançon, cible, payer-rancon, stop, liste). Raccourcis préfixe : `+perroquet @x`, etc.
- `/garde` : moi, relève, astreinte, enquête, barème, appel, geler, demande de quota, bilan, planning ; bilan du dimanche en MP ; rappel 5 min avant la fin d'une sanction ; « Je prends » sur les signalements.

### Communauté
- Bot principal : `/heure`, `/citation`, `/archive`, `/resume-salon`, `/salon-temp`, `/sante`, `/defi`, `/export-config`, merci aux boosters, résumé du dimanche avec podium vocal récompensé, rapport mensuel d'usage de l'IA.
- LE FISC : rôle « Plus riche du mois ». FDPDLAVOC : `/music recherche`, `/radio station`, `/vocal-plus`.

## 27/11/2026 (après-midi)

### Bots
- Anti-largage vocal : 3 membres ou plus (et au moins la moitié du salon) déconnectés en 8 s → la région du salon change
  (serveur vocal différent), le staff est prévenu avec les membres arrivés dans les 2 min avant. Une fois par salon toutes les 2 min.
  `PND_VOICE_DROP_GUARD=off` le coupe. Le bot doit avoir « Gérer les salons ».
- `/dogall` (SYS+) : met en laisse tout son salon vocal si tout le monde tient dans ses laisses restantes, sinon rien n'est fait.
- WOUAF : une réponse différente et générée au hasard à chaque message, délai par défaut 3 s (réglable dès 2 s).

## 27/11/2026 (nuit)

### Bots
- Limite de connexions Discord : quand Discord répond « Not enough sessions remaining … resets at … », le bot attend
  l'heure de reset (+1 min, 24 h au plus) avant le prochain essai, au lieu de redémarrer et de brûler encore des connexions.
  Cet échec ne compte pas dans les 6 échecs qui arrêtent un bot pour de bon. Fichiers : `bot/gateway-watchdog.js`, `bot/index.js`.

### Console (`/console/`)
- Réglages : bouton « Tout redémarrer » (bots joignables seulement, double clic de confirmation) et aide-mémoire des commandes PM2 à copier.
- Palette `Ctrl K` : cherche aussi dans les commandes des bots et dans le journal.
- Analyse : bouton « Copier le journal en CSV ».
- Installable sur le téléphone : manifeste et icône (`public/console/manifest.webmanifest`, `icon.svg`).

### Site
- En-têtes de sécurité sur toutes les pages (`nitro.config.ts`) : le site ne peut plus être affiché dans un cadre d'un autre site,
  plus HSTS, nosniff, Referrer-Policy et Permissions-Policy.

### Docs
- `docs/MODE_EMPLOI.md` : où est quoi et quoi faire en cas de panne.

## 27/11/2026 (journée)
- Console reliée aux vrais bots : statut, journal, activité, commandes ; redémarrage individuel depuis le site ; page Analyse.
- Migrations Supabase `bot_control_commands` et `bot_activity_snapshots`.
- Feuille de route : `docs/FEUILLE_DE_ROUTE.md`.

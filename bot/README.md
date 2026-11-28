# PND Assist + — processus Discord

Nécessite Node.js 24 LTS. Le bot synchronise les réglages depuis le backend, applique DOG/vocal/modération, lit les flux audio HTTPS autorisés, répond aux commandes slash et conserve le portefeuille PND dans `data/economy.sqlite`.

## Installation isolée

```bash
npm install
cp .env.example .env
chmod 600 .env
# renseigner DISCORD_TOKEN, SITE_URL et BOT_SYNC_SECRET
npm start
```

Pour PM2, le fichier `ecosystem.v5.config.cjs` à la racine du projet démarre le dashboard et le bot ensemble. Ne lance jamais plusieurs processus bot sur la même base SQLite.

## Intelligence artificielle

Les réponses de PND Intelligence et la génération assistée du règlement passent par
`/api/public/bot-sync`, authentifié avec `BOT_SYNC_SECRET`. Les clés de fournisseur
(`LOVABLE_API_KEY` ou `AI_GATEWAY_API_KEY`) restent exclusivement côté serveur web.
Aucune clé Anthropic/Claude personnelle n'est nécessaire dans `bot/.env` ; l'utilisation
de l'IA est facturée par le fournisseur API configuré, indépendamment d'un abonnement
Claude Code ou Claude.ai.

## Commandes slash V4

Le bot enregistre les commandes au démarrage en fusionnant chaque définition (jamais de `PUT` global). Les commandes interactives (économie, DOG, vocal, musique, radio, SYS+) nécessitent ce processus 24/7.

- Économie : `/balance [membre]`, `/daily`, `/pay membre montant`, `/leaderboard`, `/shop voir|ajouter|retirer`, `/shop market list|sell|buy|cancel`, `/shop auction list|create|bid|cancel`, `/buy rôle`, `/inventory`, `/job mission ...` et `/job contract ...`. Les contrats réservent leur récompense jusqu’à validation par leur auteur; le marché revend des rôles achetés et requiert Gérer les rôles et une hiérarchie compatible côté bot. Les enchères retiennent l’offre haute puis règlent automatiquement le rôle et les PND à l’échéance. Les ajustements `/pnd`, `/pnd-add`, `/pnd-remove`, `/pnd-history` et `/pnd-audit` exigent `PND_OWNER_DISCORD_ID` dans la configuration du processus bot et refusent tout autre identifiant, y compris SYS+/ADMIN+.
- Jeux : `/roulette mise choix`, `/blackjack mise` puis boutons **Tirer** / **Rester**.
- DOG : `/dog membre`, `/undog membre`, `/doginfo membre`.
- WAOUF : `/wouaf` permet aux membres SYS+ disposant aussi de la permission Discord Gérer les messages de configurer les salons/phrases, puis d’activer ou arrêter le remplacement temporaire pour un membre. Le bot supprime ses messages dans les salons configurés et applique une durée/cooldown bornés. Les activations et réglages sont isolés par serveur.
- Vocal : `/access membre`, `/unaccess membre`, `/panel`, `/pv`, `/menotte membre [duree_minutes]`, `/unmenotte membre`, `/menotteinfo membre`. Les durées MENOTTE vont de 1 minute à 30 jours ; omettre la durée crée une menotte sans échéance, comme les entrées héritées. ANTI-MOVE : `/anti-moove config etat:on|off`, `/anti-moove proteger membre`, `/anti-moove retirer membre`, `/anti-moove liste`, `/anti-moove exception-ajouter membre` et `/anti-moove exception-retirer membre`.
- Musique : `/play URL_HTTPS`, `/pause`, `/resume`, `/skip`, `/queue`, `/volume`, `/loop`, etc. Le flux doit provenir d’un hôte autorisé pour le serveur. File limitée à 100 entrées et cooldown utilisateur.
- Radio : `/radio host-add|host-remove|host-list`, `/radio set #salon URL_HTTPS`, `/radio start`, `/radio stop`, `/radio clear`, `/radio status`. Les hôtes et la configuration sont isolés par serveur dans `data/radio-config.json`.
- SYS+ : `/sysp panel`, `/sysp role rôle`, `/sysp admin-role rôle`, `/sysp whitelist-role rôle`.
- WHITELIST : `/whitelist-add membre`, `/whitelist-remove membre` et `/whitelist-list` sont réservées au propriétaire Discord du serveur. Le rôle configuré doit s’appeler exactement `WHITELIST`; il contourne le quota DOG interne de trois laisses, sans accorder SYS+/ADMIN+ ni contourner les permissions natives Discord.
- Modération : `/warn`, `/warnings`, `/mute`, `/unmute`, `/kick`, `/ban`, `/purge`, `/slowmode`, `/lock`, `/unlock`, `/verify moi|panel`.
- Sécurité : `/guildguard status|enable|disable|account-age|raid|quarantine|log|lockdown|review|resolve` ; file humaine `=guardian-review list|resolve`.
- Social : `/profil`, `/bio`, `/rep`, `/toprep`, `/color`.
- Cartes : `/cards`, `/card`, `/pack`, `/trade proposer|accepter|annuler|liste`.
- Vocal V2 : `/voc panel|vocal-panel|demander|demander-id|debloquer|limit|name|claim|lock|unlock|delete`. Le panneau vocal classique auparavant accessible via `/vocal-panel` est désormais `/voc vocal-panel` afin de rester dans la limite Discord de 100 commandes racine.
- Jeux : `/dice`, `/coinflip`, `/trivia`, `/giveaway start|end|list`, `/event creer|liste|supprimer`.
- Staff : `/ticket panel|close|add|remove|list`.
- Automatisation : `/automation status|autorole-*|welcome|schedule-*`.

## Isolation des serveurs

Par défaut le bot accepte toutes les invitations. Pour le limiter à deux
serveurs, renseigne `V4_ALLOWED_GUILD_IDS` (identifiants séparés par des
virgules). Au démarrage et à chaque reprise de connexion, le bot quitte tout
serveur absent de la liste ; `guildCreate` refuse les invitations suivantes.
Les données SQLite restent indexées par `guild_id` et ne sont jamais supprimées
lorsqu’un serveur est retiré.

Les commandes préfixées `=` restent disponibles pendant la transition et partagent exactement la même logique métier.

MZ est exclu de l’allowlist même si son identifiant s’y trouve, sauf si `PND_MZ_ENABLED=true` est explicitement défini après validation humaine. PND demeure le serveur actif par défaut.

## Export de l’économie

```bash
npm run export:economy -- /chemin/economy-export.json
```

Le script ouvre `data/economy.sqlite` en lecture seule et produit un JSON de sauvegarde. Il ne modifie jamais les soldes. `ECONOMY_DB=/autre/chemin.sqlite` permet de cibler une autre base.

Pour DOG, le bot crée un rôle système sans permission pour marquer les membres en laisse et rétablit surnom/rôle au retour de ses événements. Le bot a besoin des intents **Message Content** et **Server Members**, ainsi que des permissions Discord adaptées à chaque module.

### ANTI-MOVE individuel

`/anti-moove config etat:on` active le module, puis `/anti-moove proteger membre` inscrit une protection individuelle. Les protections et exceptions sont persistées en SQLite et isolées par serveur. Un déplacement n’est annulé que si le journal d’audit Discord confirme un auteur distinct du membre protégé et une destination exacte ; les déplacements volontaires, les journaux absents et les événements ambigus ne sont jamais bloqués. Le bot doit disposer des permissions Discord **Voir le journal d’audit** et **Déplacer des membres**. Les équivalents préfixés sont `=anti-moove config on|off`, `=anti-moove proteger @membre`, `=anti-moove retirer @membre`, `=anti-moove liste`, `=anti-moove exception-ajouter @membre` et `=anti-moove exception-retirer @membre` (alias `=anti-move`).

`data/economy.sqlite`, `data/dog-state.json`, `data/voice-locks.json` et `data/radio-config.json` sont des données persistantes locales. Elles ne sont pas dans l’archive de code ; sauvegarde-les sur l’hôte.

## Gestion des rôles

Les commandes de gestion des rôles sont disponibles via le processus bot :

- `/rank membre rôle` attribue un rôle ; `=rank` et l’alias historique `=addrole @membre @rôle` restent disponibles.
- `/removerole membre rôle` et `=removerole @membre @rôle` retirent un rôle.
- `/rolepanel` ouvre un panneau interactif de sélection du membre, du rôle et de l'action.
- `/rankall role` et `=rankall @rôle` préparent une attribution générale ; seul le propriétaire déclaré dans `PND_OWNER_DISCORD_ID` peut confirmer. Aperçu, confirmation auteur-only expirant après 60 secondes, respect de la hiérarchie Discord et journalisation sont obligatoires.

L'accès est réservé aux rôles SYS+ et ADMIN+ configurés dans les paramètres du serveur. Chaque action recharge le membre et le rôle, contrôle les hiérarchies de l'acteur et du bot, refuse les rôles gérés et @everyone, puis écrit une entrée dans l'audit SYS+. Le bot doit disposer de la permission Discord `Gérer les rôles` et son rôle le plus élevé doit être placé au-dessus des rôles qu'il doit attribuer ou retirer.


## Alertes LIVE des créateurs (V5)

Le module `live-alerts.js` vérifie toutes les 60 secondes les flux RSS/Atom HTTPS configurés dans le dashboard. Il n'annonce que les nouveaux éléments dont le titre indique explicitement un direct (LIVE / en direct / streaming now, etc.) et déduplique les notifications en SQLite par serveur, créateur et élément.

Pour TikTok, Twitch ou les autres plateformes, fournir un flux RSS/Atom compatible avec les événements de démarrage LIVE (par exemple un flux produit par un service de notification que l'administrateur héberge ou auquel il fait confiance). Les flux de publications classiques ne garantissent pas le signalement du début d'un direct. Aucun scraping de pages privées ni identifiant/mot de passe de réseau social n'est utilisé.

## Gestionnaire Webhooks

La commande `/webhook` permet aux membres SYS+ (ainsi qu'au propriétaire et aux administrateurs Discord) de créer, lister, supprimer, publier et modifier le dernier message d'un webhook géré par PND Assist +. Les secrets sont chiffrés avec AES-256-GCM dans SQLite.

Avant d'activer le module, définir `WEBHOOK_ENCRYPTION_KEY` dans `bot/.env` avec une clé aléatoire de 32 octets encodée en hexadécimal :

```bash
openssl rand -hex 32
```

**Important :** sauvegarder cette clé dans un gestionnaire de secrets. Sans elle, les tokens chiffrés ne pourront plus être déchiffrés. Ne jamais la committer ni la partager. Le bot doit avoir `Gérer les webhooks` dans le salon cible.

## Identité visuelle et animation des webhooks

Les panneaux de contrôle utilisent l'identité noire/violette PND Assist + et la bannière animée publiée sur le dashboard à `/media/her-v5-city-loop.gif`. Les nouveaux webhooks sont animés par défaut.

- `/webhook animation etat:off` désactive l'animation pour tous les webhooks du serveur.
- `/webhook animation etat:on` la réactive.
- Ajoute `id:<id>` pour ne modifier qu'un webhook.

Le réglage est enregistré par webhook dans SQLite et migré de façon additive. `HER_THEME_IMAGE_URL` permet de remplacer l'URL de la bannière par une autre URL HTTPS publique.

## LOCKNAME

`/lockname proteger|retirer|liste` (ou `=lockname`, `=unlockname`, `=locknamelist`) mémorise le pseudonyme par serveur et le restaure après une modification ou au retour du bot. Les opérateurs SYS+/ADMIN+ doivent aussi avoir la permission Discord « Gérer les pseudos » ; le bot doit avoir la même permission et se trouver au-dessus du membre dans la hiérarchie. DOG refuse de modifier un pseudonyme déjà protégé.

## Attribution de rôles et WAKEUP

- `/rank membre role` et `=rank @membre @rôle` attribuent un rôle individuellement. Ils utilisent les mêmes contrôles SYS+/ADMIN+, de hiérarchie et de permissions que la gestion des rôles existante.
- `/rankall role` et `=rankall @rôle` restent réservés aux propriétaires PND configurés, avec aperçu, confirmation à durée limitée et vérification de hiérarchie membre par membre.
- `/wakeup membre [message]` et `=wakeup @membre [message]` réveillent un membre connecté en vocal : il est déplacé successivement dans chaque salon vocal public éligible (un passage par salon, avec une courte pause), et reçoit un MP à chaque déplacement. Sont exclus le salon vocal Owner, le salon d'attente, le salon AFK, les salons privés ou verrouillés et ceux que la cible ou le bot ne peuvent pas utiliser. Les IDs configurés (`wakeup.ownerChannelId`, `wakeup.waitingChannelId`, `wakeup.excludedChannelIds`) priment ; les noms « Owner » et « attente/waiting » ne servent que de repli. L'acteur et le bot doivent avoir « Déplacer des membres ». Un cooldown s'applique par acteur. Le bilan (salons visités, échecs) est écrit en éditant la réponse initiale, sans message de statut supplémentaire.

## Vérification CAPTCHA

`/verify moi` lance le même défi CAPTCHA que le bouton du panneau. `/verify panel` ne publie le panneau que si le module est activé et qu'un rôle de vérification valide est configuré. Avant l'attribution, le bot recharge le membre, le rôle et sa propre position dans la hiérarchie.

## Tickets

L'ouverture vérifie la catégorie et le rôle support configurés ainsi que les permissions `Gérer les salons` et `Gérer les rôles`. Si la création du salon, l'enregistrement SQLite ou la publication du panneau échoue, le salon est nettoyé et l'entrée incomplète est marquée `failed` au lieu de laisser un ticket inutilisable.

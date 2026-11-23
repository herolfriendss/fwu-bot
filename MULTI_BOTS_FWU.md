# FWU — Passer de 1 à 5 bots (guide de bascule)

**Tant que tu ne fais rien, rien ne change** : FWU (le bot actuel, `her-v5-bot`) continue de tout faire, exactement comme aujourd'hui.

## Les 5 bots

| Bot | Processus PM2 | Ce qu'il fait | Token dans `bot/.env` |
|---|---|---|---|
| **FWU** | `her-v5-bot` (inchangé) | Tous les événements et logs, `/ban`, `/blacklist`, `/live`, `/sondage`, `/nettoyer`, tickets, candidatures, social, cartes, jeux, giveaways, événements, RESUME (`/afk`), commandes personnalisées du site, mots-clés, alertes LIVE. **Reprend tout seul** le travail d'un bot arrêté. | `DISCORD_TOKEN` (inchangé) |
| **GUARD** | `fwu-guard` | GuildGuard, `/warn`, `/mute`, `/kick`, `/purge`, `/lock`, `/verify`, anti-spam, filtre d'insultes, Guardian | `PND_GUARD_TOKEN` |
| **FDPDLAVOC** | `fwu-fdpdlavoc` | Musique, radio, vocaux temporaires, `/pv` `=pv` `=unpv`, `/access`, `/voc` | `PND_FDPDLAVOC_TOKEN` |
| **SUCK ME** | `fwu-suckme` | `/sysp`, rôles, `/rankall`, `/dmall` (toi seul), DOG, MENOTTE, WAKEUP, WOUAF, LOCKNAME, Anti-Move, automatisations, webhooks, `/panel`, `/setup` | `PND_SUCKME_TOKEN` |
| **LE FISC** | `fwu-fisc` | Toute l'économie : solde, banque, boutique, marché, enchères, casino, roulette, blackjack, entreprises, investissements | `PND_FISC_TOKEN` |

`/aide` et `/status` existent sur chaque bot : chacun affiche ses propres commandes et cite les autres.
La liste exacte, commande par commande, est dans `src/lib/bot-profiles.ts`. Pour déplacer une commande, il suffit de la changer de liste.

## Comment ils travaillent ensemble

- **Une seule base partagée** (`bot/data/economy.sqlite`) : les rôles SYS+/ADMIN+, la WHITELIST, l'économie, les dossiers… sont vus par les 5 bots.
- **Un verrou par domaine** : un bot spécialisé « réserve » son domaine toutes les 20 s. Tant qu'il le tient, lui seul traite ce domaine (commandes `=`, événements, tâches planifiées). S'il s'arrête, FWU reprend ce domaine **en moins d'une minute**, tout seul.
- **Les logs passent par FWU** : les autres bots lui confient leurs logs, il les publie dans le Logs Hub. Les nouveaux bots n'ont donc pas besoin d'être sur le serveur de logs.
- **RESUME** voit ainsi tous les logs des 5 bots.

## Ordre conseillé

GUARD → FDPDLAVOC → LE FISC → SUCK ME (le même ordre que le plan historique). Un bot à la fois, en vérifiant chaque étape.

⚠️ **Fais d'abord tout le parcours sur ton serveur de test** avec des applications de test (règle du projet : jamais de token de production pour les essais).

## Pour chaque bot (exemple : GUARD)

### 1. Créer l'application (Discord Developer Portal) — toi
1. *New Application* → nom **GUARD** (avatar et couleur à ton goût).
2. Onglet **Bot** : activer **Server Members Intent** et **Message Content Intent**. Copier le token.
3. Onglet **OAuth2 → URL Generator** : `bot` + `applications.commands`, puis les permissions du tableau ci-dessous. Ouvrir le lien et inviter le bot sur le serveur PND.
4. Dans **Paramètres du serveur → Rôles**, placer le rôle du bot comme indiqué.

| Bot | Permissions | Place du rôle |
|---|---|---|
| GUARD | Gérer les messages, Exclure, Bannir, Exclure temporairement, Gérer les rôles (quarantaine), Gérer les salons (lock/slowmode), Voir les logs, Ajouter des réactions | Au-dessus des membres qu'il modère |
| FDPDLAVOC | Se connecter, Parler, Déplacer des membres, Gérer les salons, Gérer les permissions (pv) | Au-dessus des rôles de membres |
| SUCK ME | Gérer les rôles, Gérer les pseudos, Déplacer des membres, Voir les logs (Anti-Move), Gérer les messages (WOUAF), Gérer les webhooks | **Juste sous ton rôle**, au-dessus de tous les rôles qu'il attribue (DOG, MENOTTE, rankall) |
| LE FISC | Gérer les rôles (rôles vendus en boutique ou au marché) | Au-dessus des rôles vendus |

FWU garde ses permissions actuelles.

### 2. Ajouter le token — toi, sur le VPS
```bash
nano /home/opc/her-v5-production/bot/.env
```
Remplir `PND_GUARD_TOKEN=` avec le token copié (jamais le même que `DISCORD_TOKEN`), enregistrer, puis :
```bash
chmod 600 /home/opc/her-v5-production/bot/.env
```

### 3. Démarrer le bot
```bash
cd /home/opc/her-v5-production && pm2 start ecosystem.fwu-bots.config.cjs --only fwu-guard && pm2 save
```
- Dans les logs (`pm2 logs fwu-guard --lines 30`) : `[bot] started_guard` puis `[bot] connected`.
- Dès cet instant, GUARD traite son domaine et FWU s'efface. Les commandes slash de GUARD apparaissent dans Discord (parfois jusqu'à 1 h).
- Pendant cette période, `/warn` existe en double (FWU et GUARD) : celui de FWU répond « gérée par GUARD ».

### 4. Retirer les doublons de FWU
Quand les commandes de GUARD sont visibles, mettre dans **`bot/.env` et `.env`** :
```
PND_FWU_DELEGATED=guard
```
(plus tard : `guard,fdpdlavoc`, puis `guard,fdpdlavoc,fisc`, puis les 4), puis :
```bash
pm2 restart her-v5-bot her-v5-web --update-env
```
FWU supprime ses propres `/warn`, `/kick`… une par une (jamais de remplacement global). **`/afk` (RESUME), `/dmall`, `/blacklist` et `/live` apparaissent à ce moment** : avant, FWU est à 100 commandes, le maximum de Discord. `=afk`, `=dmall`, `=blacklist` et `=live` fonctionnent dès maintenant.

### 5. Vérifier (5 minutes)
- `/warn` sur un compte de test → réponse de GUARD, log dans le Logs Hub (publié par FWU).
- `=guardian-review list` → une seule réponse.
- `pm2 stop fwu-guard`, attendre 1 minute : `=guardian-review list` → FWU répond. `pm2 start fwu-guard`.

## Suivre l'état des bots
- **`/sysp diagnostic bots`** (ou `=sysp bots`) : pour chaque bot, s'il est en ligne ou si FWU fait son travail, plus le nombre de logs en attente.
- Sur le site, la liste des commandes indique le bot qui porte chaque commande intégrée.

## Identité visuelle
Chaque bot signe ses messages : « FWU », « FWU • GUARD », « FWU • FDPDLAVOC », « FWU • SUCK ME », « FWU • LE FISC ». Tous gardent la couleur violette.
Pour changer un bot, ajouter dans `bot/.env` par exemple `PND_GUARD_COLOR=#dc2626` ou `PND_GUARD_FOOTER=GUARD`, puis redémarrer ce bot.

## Retour arrière
- **Immédiat** : `pm2 stop fwu-guard`. FWU reprend le domaine en moins d'une minute (commandes `=`, événements, tâches).
- **Complet** : retirer `guard` de `PND_FWU_DELEGATED` dans les deux `.env`, puis `pm2 restart her-v5-bot her-v5-web --update-env` : FWU réenregistre ses commandes slash.

## Mises à jour
`scripts/update-1942.sh` arrête, puis relance aussi les bots spécialisés **déjà déclarés dans PM2**. Il n'en démarre jamais un nouveau tout seul. Même chose pour `rollback-1942.sh`.

## RESUME
- `/afk on [raison]` : début de l'absence.
- `/afk off` : fin de l'absence, avec le résumé de ce qui s'est passé.
- `/afk resume [heures]` : le résumé, sans terminer l'absence (24 h par défaut si tu n'es pas absent).
- Équivalents `=afk on|off|resume` : le résumé arrive en MP, jamais dans le salon.
- Réservé à l'OWNER, aux SYS+ et aux ADMIN+. Contenu : les événements par domaine, et en priorité les alertes 🚨 et ⚠️ (bans, permissions dangereuses, exclusions…). Conservation 14 jours, sans contenu de messages.
- `/resume` reste la commande musique (sur FDPDLAVOC) : aucun conflit.

## DM ALL (toi seul)
- `/dmall message:<texte> [role:@rôle]` ou `=dmall [@rôle] ton message`.
- Un aperçu montre le nombre de destinataires, la durée estimée et le message tel qu'il sera reçu. Rien n'est envoyé avant ta confirmation (60 s).
- Pendant l'envoi, le même message affiche la progression et un bouton « Arrêter ». À la fin : le nombre de MP envoyés et le nombre de MP fermés.
- Limites par défaut : 1 000 destinataires, un MP toutes les 1,5 s, 1 h entre deux envois. Réglables dans `bot/.env`.

## Blacklist (OWNER et SYS+, sur FWU)
- `/blacklist add membre|id [raison]` ou `=blacklist add @membre|id [raison]` : banni tout de suite, même s'il n'est pas sur le serveur, et rebanni automatiquement s'il revient.
- `/blacklist remove`, `/blacklist list`, `/blacklist check` (et `=blacklist remove|list|check`).
- Retirer un compte de la blacklist le débannit aussi.

## Alertes LIVE depuis Discord (OWNER et SYS+, sur FWU)
- `/live etat` · `/live activer` · `/live desactiver` · `/live salon #salon` · `/live role @rôle` (sans rôle : plus de mention).
- `/live ajouter plateforme nom flux` : flux RSS/Atom en HTTPS public. `/live retirer nom`.
- Équivalents : `=live`, `=live on|off`, `=live salon #salon`, `=live role @rôle|aucun`, `=live ajouter youtube <flux> <nom>`, `=live retirer <nom>`.
- Les changements sont enregistrés sur le site : les deux restent toujours d'accord.

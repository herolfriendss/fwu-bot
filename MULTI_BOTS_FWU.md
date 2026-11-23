# FWU — Passer de 1 à 5 bots (guide de bascule)

**Tant que tu ne fais rien, rien ne change** : FWU (le bot actuel, `her-v5-bot`) continue de tout faire, exactement comme aujourd'hui.

## Les 5 bots

| Bot | Processus PM2 | Ce qu'il fait | Token (dans le `.env` de son dossier) |
|---|---|---|---|
| **FWU** | `her-v5-bot` (inchangé, avec le site `her-v5-web`) | Tous les événements et logs, `/ban`, `/blacklist`, `/live`, `/sondage`, `/nettoyer`, tickets, candidatures, social, cartes, jeux, giveaways, événements, RESUME (`/afk`), commandes personnalisées du site, mots-clés, alertes LIVE. **Reprend tout seul** le travail d'un bot arrêté. | `DISCORD_TOKEN` (inchangé) |
| **GUARD** | `fwu-guard` | GuildGuard, `/warn`, `/mute`, `/kick`, `/purge`, `/lock`, `/verify`, anti-spam, filtre d'insultes, Guardian | `PND_GUARD_TOKEN` |
| **FDPDLAVOC** | `fwu-fdpdlavoc` | Musique, radio, vocaux temporaires, `/pv activer|liste|retirer`, `/access`, `/voc` | `PND_FDPDLAVOC_TOKEN` |
| **SUCK ME** | `fwu-suckme` | `/sysp`, rôles, `/rankall`, `/dmall` (toi seul), DOG, MENOTTE, WAKEUP, WOUAF, LOCKNAME, Anti-Move, automatisations, webhooks, `/panel`, `/setup` | `PND_SUCKME_TOKEN` |
| **LE FISC** | `fwu-fisc` | Toute l'économie : solde, banque, boutique, marché, enchères, casino, roulette, blackjack, entreprises, investissements | `PND_FISC_TOKEN` |

`/aide` et `/status` existent sur chaque bot : chacun affiche ses propres commandes et cite les autres.
La liste exacte, commande par commande, est dans `src/lib/bot-profiles.ts`. Pour déplacer une commande, il suffit de la changer de liste.

## Comment ils travaillent ensemble

- **Une seule base partagée** (`/home/opc/fwu-data/economy.sqlite`) : les rôles SYS+/ADMIN+, la WHITELIST, l'économie, les dossiers… sont vus par les 5 bots.
- **Un verrou par domaine** : un bot spécialisé « réserve » son domaine toutes les 20 s. Tant qu'il le tient, lui seul traite ce domaine (événements, tâches planifiées). S'il s'arrête, FWU reprend ce domaine **en moins d'une minute**, tout seul.
- **Les logs passent par FWU** : les autres bots lui confient leurs logs, il les publie dans le Logs Hub. Les nouveaux bots n'ont donc pas besoin d'être sur le serveur de logs.
- **RESUME** voit ainsi tous les logs des 5 bots.

## Ordre conseillé

GUARD → FDPDLAVOC → LE FISC → SUCK ME (le même ordre que le plan historique). Un bot à la fois, en vérifiant chaque étape.

Tu peux aussi installer les 4 d'un coup : chaque installateur vérifie son bot avant de synchroniser FWU.

## Installation

Chaque bot est livré dans son propre dossier complet (`FWU-GUARD.zip`, `FWU-FDPDLAVOC.zip`, `FWU-SUCK-ME.zip`, `FWU-LE-FISC.zip`) : son code, son `.env` avec son token, son processus PM2 et son installateur. La marche à suivre, pas à pas, est dans **`DEMARRAGE_FWU.md`**.

Emplacements sur le VPS Oracle :
- FWU (bot et site) : `/home/opc/her-v5-production` (inchangé, processus `her-v5-bot` et `her-v5-web`) ;
- les 4 bots : `/home/opc/fwu-bots/fwu-guard`, `fwu-fdpdlavoc`, `fwu-suckme`, `fwu-fisc` (processus du même nom) ;
- les données partagées par les 5 bots : `/home/opc/fwu-data`.

### Permissions de chaque bot

| Bot | Permissions | Place du rôle |
|---|---|---|
| GUARD | Gérer les messages, Exclure, Bannir, Exclure temporairement, Gérer les rôles (quarantaine), Gérer les salons (lock/slowmode), Voir les logs, Ajouter des réactions | Au-dessus des membres qu'il modère |
| FDPDLAVOC | Se connecter, Parler, Déplacer des membres, Gérer les salons, Gérer les permissions (pv) | Au-dessus des rôles de membres |
| SUCK ME | Gérer les rôles, Gérer les pseudos, Déplacer des membres, Voir les logs (Anti-Move), Gérer les messages (WOUAF), Gérer les webhooks | **Juste sous ton rôle**, au-dessus de tous les rôles qu'il attribue (DOG, MENOTTE, rankall) |
| LE FISC | Gérer les rôles (rôles vendus en boutique ou au marché) | Au-dessus des rôles vendus |

### Synchronisation
L'installateur de chaque bot lance `scripts/fwu-synchroniser.sh` : FWU retire de son application les commandes des bots en ligne. C'est ce qui libère la place pour `/afk`, `/dmall`, `/blacklist` et `/live`.

## Retour arrière
- **Immédiat** : `pm2 stop fwu-guard`. FWU reprend le domaine en moins d'une minute (événements, tâches, filtre anti-spam).
- **Complet** : après `pm2 stop fwu-guard`, lance `bash /home/opc/her-v5-production/scripts/fwu-synchroniser.sh` : FWU réenregistre les commandes de GUARD.

## Mises à jour
- FWU : `scripts/update-1942.sh`, comme avant. Les 4 autres bots continuent de tourner pendant la mise à jour de FWU.
- Chaque bot : dézipper la nouvelle version dans `/home/opc/fwu-bots` (`unzip -o`), puis relancer son `installer.sh`. Son `.env` est conservé.

## RESUME
- `/afk on [raison]` : début de l'absence.
- `/afk off` : fin de l'absence, avec le résumé de ce qui s'est passé.
- `/afk resume [heures]` : le résumé, sans terminer l'absence (24 h par défaut si tu n'es pas absent).
- Réservé à l'OWNER, aux SYS+ et aux ADMIN+. Contenu : les événements par domaine, et en priorité les alertes 🚨 et ⚠️ (bans, permissions dangereuses, exclusions…). Conservation 14 jours, sans contenu de messages.
- `/resume` reste la commande musique (sur FDPDLAVOC) : aucun conflit.

## DM ALL (toi seul)
- `/dmall message:<texte> [role:@rôle]` .
- Un aperçu montre le nombre de destinataires, la durée estimée et le message tel qu'il sera reçu. Rien n'est envoyé avant ta confirmation (60 s).
- Pendant l'envoi, le même message affiche la progression et un bouton « Arrêter ». À la fin : le nombre de MP envoyés et le nombre de MP fermés.
- Limites par défaut : 1 000 destinataires, un MP toutes les 1,5 s, 1 h entre deux envois. Réglables dans `bot/.env` de FWU, puis relancer l’installateur de SUCK ME (il recopie les réglages communs).

## Blacklist (OWNER et SYS+, sur FWU)
- `/blacklist add membre|id [raison]` : banni tout de suite, même s'il n'est pas sur le serveur, et rebanni automatiquement s'il revient.
- `/blacklist remove`, `/blacklist list`, `/blacklist check`.
- Retirer un compte de la blacklist le débannit aussi.

## Alertes LIVE depuis Discord (OWNER et SYS+, sur FWU)
- `/live etat` · `/live activer` · `/live desactiver` · `/live salon #salon` · `/live role @rôle` (sans rôle : plus de mention).
- `/live ajouter plateforme nom flux` : flux RSS/Atom en HTTPS public. `/live retirer nom`.
- Les changements sont enregistrés sur le site : les deux restent toujours d'accord.

## Commandes slash uniquement (décision du 23/11)
- Les anciennes commandes `=` ne sont plus exécutées. Taper `=play` affiche un court message (effacé après 15 s, au plus toutes les 10 min par membre) qui indique la commande slash à utiliser.
- Nouvelles commandes slash pour ce qui n'existait qu'en `=` : `/pv activer|liste|retirer`, `/rep donner|historique`, `/verify reaction|reaction-off`, `/automation regles …`, `/ia demande|historique`.
- En cas d'urgence seulement : `PND_PREFIX_COMMANDS=on` dans `bot/.env` réactive les commandes `=`.

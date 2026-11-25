# FWU — Architecture multi-bots : 5 bots principaux + Invest + facultatif

**Tant que tu ne fais rien, rien ne change** : FWU (le bot actuel, `her-v5-bot`) continue de tout faire, exactement comme aujourd'hui.

## Les cinq bots principaux et le sixième bot facultatif (répartition du 25/11/2026 — détail : `docs/FWU_BASE_PARTAGEE.md`)

| Bot | Processus PM2 | Préfixe | Ce qu'il fait | Token (dans le `.env` de son dossier) |
|---|---|---|---|---|
| **FWU** | `her-v5-bot` (avec le site `her-v5-web`) | slash uniquement | Modération staff : `/tempmute`, `/unmute`, `/warn`, `/warnings`, `/sanction`, `/sanction-type`, `/quota` ; embeds `/embed`, règlement IA `/reglement`, écran d'adhésion `/screening`. Événements, logs et IA par mention. **Reprend les événements** (pas les commandes) d'un bot arrêté. | `DISCORD_TOKEN` |
| **GUARD** | `fwu-guard` | `+` | `+ban`, `+unban`, `+kick`, `+blacklist`, `+purge`, `+lock`, `+slowmode` ; GuildGuard, `/verify`, anti-spam, filtre d'insultes, Guardian | `PND_GUARD_TOKEN` |
| **FDPDLAVOC** | `fwu-fdpdlavoc` | `;` | Musique, radio, vocaux temporaires, `;pv`, `;access`, `;voc`, `;mv`, `;accessall` | `PND_FDPDLAVOC_TOKEN` |
| **SUCK ME** | `fwu-suckme` | `=` | SYS+, rôles, DOG, MENOTTE, WAKEUP, LOCKNAME, Anti-Move, automatisations, webhooks, dmall ; tickets, candidatures, sondage, IA, live, AFK, social, giveaways, événements, commandes personnalisées du site | `PND_SUCKME_TOKEN` |
| **LE FISC** | `fwu-fisc` | `-` | Économie, casino, jeux (dice, coinflip, trivia) et cartes | `PND_FISC_TOKEN` |
| **Invest +** | `fwu-investplus` | `$` | Abonnements des membres, salon privé par membre, administration des formules (`/abonnement`, `/investadmin`). Guide : `docs/INVEST_PLUS.md` | `PND_INVESTPLUS_TOKEN` |

Les quotas de modération sont communs aux 5 bots (base centrale PostgreSQL, `SHARED_DATABASE_URL`).

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
| SUCK ME | Gérer les rôles, Gérer les pseudos, Déplacer des membres, Voir les logs (Anti-Move), Gérer les messages (WOUAF), Gérer les webhooks ; **rôle 0 % intouchable** : Rendre muet, Mettre en sourdine, Exclure temporairement, Bannir | **Juste sous ton rôle**, au-dessus du rôle 0 % et de tous les rôles qu'il attribue (DOG « En laisse (…) », MENOTTE, rankall) |
| LE FISC | Gérer les rôles (rôles vendus en boutique ou au marché) | Au-dessus des rôles vendus |

### Synchronisation
L'installateur de chaque bot lance `scripts/fwu-synchroniser.sh` : FWU retire de son application les commandes des bots en ligne. C'est ce qui libère la place pour `/afk`, `/dmall`, `/blacklist` et `/live`.

## Retour arrière
- **Immédiat** : `pm2 stop fwu-guard`. FWU reprend en moins d'une minute les **événements** du domaine (tâches, filtre anti-spam, blacklist à l'arrivée). Les **commandes** de GUARD restent indisponibles tant que GUARD est arrêté : une commande n'existe que sur son bot (décision du 24/11).

## Bot qui n'arrive pas à se connecter
- Un bot qui ne se connecte pas à Discord (token faux, intents non activés) ne reste plus « online » pour rien : il réessaie après 30 s, 1 min, 2 min, 4 min puis 8 min, et s'arrête définitivement au 6e échec (PM2 ne le relance plus).
- `/sysp diagnostic bots` l'affiche en 🟠 (essais en cours) ou 🔴 (arrêté). Après correction : `pm2 restart fwu-<bot>` (ou `her-v5-bot` pour FWU).
- Les installateurs et la mise à jour de FWU attendent la vraie connexion à Discord, pas seulement « online » dans PM2.

## Mises à jour
- FWU : `scripts/update-1942.sh`, comme avant. Les 4 autres bots continuent de tourner pendant la mise à jour de FWU.
- Chaque bot : `/maj lancer` s'en occupe. Avant de dézipper, il garde une copie de l'ancienne version de chaque bot ; si l'installateur d'un bot échoue, cette ancienne version est remise et redémarrée (`/maj etat` le dit). À la main : dézipper la nouvelle version dans `/home/opc/fwu-bots` (`unzip -o`), puis relancer son `installer.sh`. Son `.env` est conservé.

## RESUME (sur SUCK ME : `/afk` ou `=afk`)
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

## Blacklist (OWNER et SYS+, sur GUARD : `/blacklist` ou `+blacklist`, soumise au quota « blacklist »)
- `/blacklist add membre|id [raison]` : banni tout de suite, même s'il n'est pas sur le serveur, et rebanni automatiquement s'il revient.
- `/blacklist remove`, `/blacklist list`, `/blacklist check`.
- Retirer un compte de la blacklist le débannit aussi.

## Alertes LIVE depuis Discord (OWNER et SYS+, sur SUCK ME)
- `/live etat` · `/live activer` · `/live desactiver` · `/live salon #salon` · `/live role @rôle` (sans rôle : plus de mention).
- `/live ajouter plateforme nom flux` : flux RSS/Atom en HTTPS public. `/live retirer nom`.
- Les changements sont enregistrés sur le site : les deux restent toujours d'accord.

## Préfixes (décision du 24/11, remplace « slash uniquement » du 23/11)
- Chaque bot a son préfixe (GUARD `+`, FDPDLAVOC `;`, SUCK ME `=`, LE FISC `-`) ; FWU reste en slash uniquement.
- Un seul fichier pour les 5 bots : `PND_DATA_DIR/bots.json` (modèle `bot/config/bots.example.json`), jamais écrasé par une mise à jour.
- Une commande tapée avec le préfixe d'un autre bot n'existe pas (`=ban` ne fait rien : c'est `+ban`).
- `PND_PREFIX_COMMANDS` n'est plus utilisé.

## Statut riche (25/11)
- Chaque bot affiche un statut qui tourne toutes les minutes, avec des compteurs à jour : `{membres}`, `{serveurs}`, `{vocal}`, `{prefixe}`, `{bot}`.
- Pour le changer, ajouter une section `presence` dans `PND_DATA_DIR/bots.json`, puis relancer le bot :
  `"presence": { "guard": { "status": "dnd", "interval": 90, "activities": [{ "type": "watching", "text": "{membres} membres" }, { "type": "custom", "text": "🔒 Anti-nuke actif" }] } }`
- Types : `playing`, `watching`, `listening`, `competing`, `custom`. Statut : `online`, `idle`, `dnd`. Intervalle : 30 s minimum. 10 activités maximum.
- Un réglage invalide ne bloque jamais le bot : il est signalé dans ses logs et les statuts par défaut s'appliquent.

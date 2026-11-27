# Invest + : le 6e bot (abonnements des membres)

**Statut du code** : prêt et intégré aux scripts multi-bots. **Statut de l'instance A1** : le dernier état rapporté le 25/11 indiquait que le processus n'était pas encore démarré faute de token ; vérifier `pm2 status` avant de considérer l'installation terminée. Invest + reste facultatif.

## À quoi il sert

- **Toi (l'administration)** : tu crées des formules (nom, prix, durée, avantages, rôle éventuel), tu les attribues, prolonges, mets en pause ou résilies, tu vois un tableau de bord et tu traites les demandes des membres. Tout se fait depuis Discord avec `/investadmin`.
- **Chaque membre abonné** reçoit un **salon privé** (« 💼・son-pseudo ») dans la catégorie Invest +. Un panneau épinglé y montre sa formule, son statut, son échéance, **à quoi elle sert** et ses avantages, avec 4 boutons : Actualiser, Formules, Historique, Écrire à l'administration.
- **Automatique, 24 h/24** : rappel dans le salon du membre avant l'échéance (3 jours par défaut), passage en « expiré » à l'échéance, retrait du rôle de la formule, panneau mis à jour, message dans le salon d'administration.

## Ce que fait le bot avec l'argent

Invest + **ne détient ni ne place l'argent de personne**. Deux modes de paiement par formule :

| Mode | Fonctionnement |
|---|---|
| `manuel` | Tu attribues la formule toi-même (`/investadmin attribuer`). Si un règlement existe, il se fait en dehors du bot. |
| `pnd` | Le membre paie lui-même en PND (monnaie interne du serveur) depuis son espace. Débit atomique, inscrit dans le journal de l'économie (`investplus_abonnement`). |

> Si un jour les formules sont payées en **argent réel**, il faudra des CGV, une politique de confidentialité (RGPD) et un prestataire de paiement (Stripe, etc.). **Collecter de l'argent pour l'investir pour le compte des membres est une activité réglementée** (en France : AMF / ACPR) : le bot ne doit servir qu'au suivi des abonnements, jamais à la gestion des fonds.

## Mise en route (5 minutes)

1. Portail développeur Discord : crée l'application « Invest + », onglet **Bot** → active **Server Members Intent** et **Message Content Intent**, copie le token.
2. Invite le bot avec les permissions : Voir les salons, Envoyer des messages, Intégrer des liens, Lire l'historique, **Gérer les salons**, **Gérer les messages** (épingler le panneau), **Gérer les rôles** (seulement si une formule donne un rôle ; place alors le rôle d'Invest + au-dessus des rôles de formules).
3. Sur le VPS : `unzip -o FWU-INVEST-PLUS.zip -d /home/opc/fwu-bots && bash /home/opc/fwu-bots/fwu-investplus/installer.sh` (il demande le token, saisie masquée).
4. Sur Discord : `/investadmin installer` → crée la catégorie « 💼 Invest + » (privée) et le salon `#invest-admin`.
5. Crée tes formules : `/investadmin formule-creer nom:Gold prix:500 duree:30 paiement:pnd avantages:Salon privé ; Analyse mensuelle`.
6. Attribue : `/investadmin attribuer membre:@x formule:Gold` → le membre reçoit son salon privé tout seul.

Mémoire : environ 100 Mo comme les autres bots (PM2 : `fwu-investplus`, limite 160 Mo).

## Commandes

**Membres** (`/abonnement` ou `$abonnement` / `$abo`)
- `voir` : ta formule, ton échéance, tes avantages (+ paiement en PND si possible)
- `formules` : les formules proposées
- `historique` : attribution, prolongations, paiements, cadeaux, pauses…
- `offrir membre formule` : offre une formule payable en PND à un autre membre (après confirmation, ton solde est débité). Si le membre a déjà une autre formule active ou en pause, le cadeau est refusé. S'il a la même formule, elle est prolongée. Le membre est prévenu et l'administration aussi (journal de l'économie : `investplus_cadeau`).
- `espace` : ouvre ou retrouve ton salon privé
- `demande type:[renouveler|changer|question] formule message` : écrit à l'administration

**Administration** (`/investadmin`, réservé à l'OWNER, au propriétaire du serveur, aux Administrateurs et à « Gérer le serveur »)
- `installer`, `config`, `tableau`, `actualiser`
- `formules`, `formule-creer`, `formule-modifier`, `formule-archiver`, `formule-reactiver`
- `attribuer` (vide = durée de la formule, `jours:0` = sans fin), `prolonger`, `pause`, `reprendre`, `resilier`, `note` (interne), `fiche`, `abonnes`
- `espace`, `espace-fermer`, `demandes`

Les demandes arrivent dans `#invest-admin` avec des boutons : **Prolonger d'une période / Attribuer la formule**, **Marquer traitée**, **Refuser**. Le membre est prévenu dans son salon.

## Sécurité

- **Rôles** : le rôle d'une formule passe par `bot/role-grant-guard.js` en **attribution automatique** : un rôle protégé (SYS+, ADMIN+, WHITELIST, paliers, ou rôle à permission sensible) est refusé à la création de la formule **et** au moment de le donner, même si c'est toi qui lances la commande.
- `/investadmin` est caché aux membres par défaut (permission « Gérer le serveur ») et revérifié à chaque commande. Les boutons d'un panneau ne répondent qu'à leur membre (ou à l'administration).
- Textes saisis : pas de @everyone/@here ni de mention de rôle ; les messages du bot ne mentionnent personne sauf le membre concerné dans son propre salon.
- La note interne n'est jamais montrée au membre.

## Si Invest + est arrêté

Comme pour les autres bots : FWU reprend en moins d'une minute **les tâches automatiques** (rappels, échéances). Les commandes `/abonnement` et `/investadmin` restent indisponibles tant qu'Invest + est arrêté.

## Technique

- Code : `bot/features/investplus.js` (données, règles, sans Discord) et `bot/features/investplus-commands.js` (Discord). Tests : `bot/features/investplus.test.js`.
- Tables (base partagée) : `investplus_config`, `investplus_plans`, `investplus_subscriptions`, `investplus_spaces`, `investplus_history`, `investplus_requests`.
- Profil `investplus`, token `PND_INVESTPLUS_TOKEN`, serveurs `PND_INVESTPLUS_GUILD_IDS` (sinon `V4_ALLOWED_GUILD_IDS`), préfixe `$` (modifiable dans `bots.json`).

## Reste à faire (hors de ce lot)

- Écran d'administration sur le site : à brancher sur le générateur de modules (`SETUP_MODULES`) une fois la PR du site fusionnée.
- **Scripts d'installation, de mise à jour et de migration : intégrés dans la PR #23** (`TOUT-INSTALLER.sh`, `METTRE-A-JOUR-BOTS.sh`, `fwu-auto-update.sh`, `MIGRER-VERS-A1.sh`). Invest + est passé comme optionnel lorsque son token manque ; son installation réelle sur l'A1 reste à vérifier.
- Paiement en argent réel : seulement si tu le décides, avec les obligations ci-dessus.

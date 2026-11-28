# Commandes des bots (générée automatiquement)

> Ne pas modifier à la main : `node --experimental-strip-types bot/scripts/generate-command-docs.mjs`.
> Source : `src/lib/slash-commands.ts` (définitions) et `src/lib/bot-profiles.ts` (bot qui porte chaque commande).
> Les mêmes commandes existent avec le préfixe du bot (ex. `=staff centre`), sauf les fenêtres de saisie.

Commandes communes à tous les bots : `/aide`, `/status`.

## Bot principal

Modération staff (tempmute, warn, sanctions, quotas) et embeds — slash uniquement

20 commandes.

### /archive

Staff : archive les derniers messages d'un salon en fichier  
Catégorie : Modération · Utilisation : `/archive [salon] [messages]`

- `salon` (salon, facultatif) — Salon (celui-ci par défaut)
- `messages` (nombre entier, facultatif) — Nombre (10 à 500, 200 par défaut)

### /citation

Transforme un message en belle citation  
Catégorie : Général · Utilisation : `/citation lien`

- `lien` (texte, obligatoire, 200 caractères max) — Lien du message (clic droit → Copier le lien)

### /defi

Défi collectif de la semaine : un objectif commun récompensé  
Catégorie : Général · Utilisation : `/defi etat | lancer messages [recompense]`

- `/defi etat` — Où en est le défi de la semaine
- `/defi lancer` — Lance le défi de la semaine (Gérer le serveur)<br>`messages` (nombre entier, obligatoire) — Objectif de messages (100 à 100 000)<br>`recompense` (nombre entier, facultatif) — PND par participant (10 à 1 000, 100 par défaut)

### /embed

Admins : crée, édite et publie des embeds  
Catégorie : Embeds & règlement · Utilisation : `/embed creer · modifier · champ · champ-retirer · apercu · publier · importer · liste · supprimer`

- `/embed creer` — Crée un embed (formulaire : titre, description, couleur, image, footer)<br>`nom` (texte, obligatoire, 32 caractères max) — Identifiant court (lettres, chiffres, - et _)
- `/embed modifier` — Modifie un embed (formulaire prérempli)<br>`nom` (texte, obligatoire, 32 caractères max) — Embed à modifier
- `/embed champ` — Ajoute un champ à un embed<br>`nom` (texte, obligatoire, 32 caractères max) — Embed<br>`titre` (texte, obligatoire, 256 caractères max) — Titre du champ<br>`valeur` (texte, obligatoire, 1024 caractères max) — Contenu du champ<br>`en_ligne` (oui/non, facultatif) — Afficher sur la même ligne que le champ voisin
- `/embed champ-retirer` — Retire un champ (par numéro)<br>`nom` (texte, obligatoire, 32 caractères max) — Embed<br>`numero` (nombre entier, obligatoire) — Numéro du champ (1 = premier)
- `/embed image` — Change l'image, la miniature ou l'auteur<br>`nom` (texte, obligatoire, 32 caractères max) — Embed<br>`image` (texte, facultatif, 500 caractères max) — URL HTTPS de la grande image (vide = retirer)<br>`miniature` (texte, facultatif, 500 caractères max) — URL HTTPS de la miniature (vide = retirer)
- `/embed apercu` — Affiche l'embed (visible par toi seul)<br>`nom` (texte, obligatoire, 32 caractères max) — Embed
- `/embed publier` — Publie l'embed dans un salon (ou met à jour le message déjà publié)<br>`nom` (texte, obligatoire, 32 caractères max) — Embed<br>`salon` (salon, facultatif) — Salon cible (par défaut : salon de la dernière publication)
- `/embed importer` — Reprend un embed déjà publié par le bot pour pouvoir l'éditer<br>`lien` (texte, obligatoire, 200 caractères max) — Lien du message<br>`nom` (texte, obligatoire, 32 caractères max) — Identifiant à lui donner
- `/embed liste` — Liste les embeds enregistrés
- `/embed supprimer` — Supprime un embed enregistré (le message publié reste)<br>`nom` (texte, obligatoire, 32 caractères max) — Embed

### /export-config

Owner : reçois toute la configuration du serveur en fichier  
Catégorie : Administration & sécurité · Utilisation : `/export-config`

### /heure

Heure locale des membres (chacun indique son fuseau)  
Catégorie : Général · Utilisation : `/heure voir [membre] | regler fuseau`

- `/heure voir` — Heure chez un membre<br>`membre` (membre, facultatif) — Membre (toi par défaut)
- `/heure regler` — Indique ton fuseau horaire<br>`fuseau` (texte, obligatoire, 60 caractères max) — Ex. Europe/Paris, America/Montreal

### /quota

Owner : quotas de modération partagés entre les 5 bots  
Catégorie : Modération · Utilisation : `/quota moi · voir · definir · reinitialiser · palier · paliers · exemption … · bot … · journal`

- `/quota moi` — Ce qu'il te reste pour chaque commande, et quand la suivante se libère
- `/quota voir` — Affiche les quotas en vigueur (et ton palier)<br>`commande` (texte, facultatif, choix : tempmute, unmute, warn, kick, ban, unban, blacklist, mv) — Limiter à une commande
- `/quota definir` — Modifie un quota à chaud (sans redéploiement)<br>`commande` (texte, obligatoire, choix : tempmute, unmute, warn, kick, ban, unban, blacklist, mv) — Commande de modération<br>`palier` (nombre entier, obligatoire, choix : 1 % · All Access, 5 % · Administrateur, 10 % · Modérateur, 50 % · Modérateur test) — Palier de rôle<br>`valeur` (texte, obligatoire, 10 caractères max) — Nombre d'utilisations (0 = interdit, « illimite » = sans limite)<br>`fenetre` (texte, obligatoire, 20 caractères max) — Fenêtre de temps : 30m, 1h, 1j…
- `/quota reinitialiser` — Revient à la valeur par défaut pour ce serveur<br>`commande` (texte, obligatoire, choix : tempmute, unmute, warn, kick, ban, unban, blacklist, mv) — Commande de modération<br>`palier` (nombre entier, obligatoire, choix : 1 % · All Access, 5 % · Administrateur, 10 % · Modérateur, 50 % · Modérateur test) — Palier de rôle
- `/quota palier` — Associe un rôle à un palier (0 %, 1 %, 5 %, 10 %, 50 %, 70 %, 80 %, 100 %)<br>`role` (rôle, obligatoire) — Rôle Discord<br>`palier` (nombre entier, obligatoire, choix : 0 % · Owner, 1 % · All Access, 5 % · Administrateur, 10 % · Modérateur, 50 % · Modérateur test, 70 %, 80 %, 100 %, Retirer l'association) — Palier (−1 = retirer l'association)
- `/quota paliers` — Affiche les rôles associés à chaque palier (staff)
- `/quota exemption ajouter` — Exempte un utilisateur de tous les quotas<br>`utilisateur` (texte, obligatoire, 40 caractères max) — Mention ou ID<br>`raison` (texte, facultatif, 200 caractères max) — Raison
- `/quota exemption retirer` — Retire une exemption<br>`utilisateur` (texte, obligatoire, 40 caractères max) — Mention ou ID
- `/quota exemption liste` — Liste les utilisateurs exemptés
- `/quota bot ajouter` — Ajoute un bot à la whitelist<br>`bot` (texte, obligatoire, 40 caractères max) — Mention ou ID du bot
- `/quota bot retirer` — Retire un bot de la whitelist<br>`bot` (texte, obligatoire, 40 caractères max) — Mention ou ID du bot
- `/quota bot liste` — Liste les bots whitelistés
- `/quota journal` — Dernières modifications de configuration (qui, quoi, avant, après)

### /reglement

Admins : règlement écrit ou généré par l'IA, publié en embed  
Catégorie : Embeds & règlement · Utilisation : `/reglement generer [consignes] [nombre] · ecrire · apercu · publier salon`

- `/reglement generer` — Génère un brouillon de règlement (aperçu à valider)<br>`consignes` (texte, facultatif, 1000 caractères max) — Ton, thèmes à couvrir, points importants<br>`nombre` (nombre entier, facultatif) — Nombre de règles (5 à 20)
- `/reglement ecrire` — Écris ou corrige le règlement toi-même (sans IA), une règle par ligne
- `/reglement apercu` — Réaffiche le dernier brouillon et ses boutons de validation
- `/reglement publier` — Publie le dernier règlement validé<br>`salon` (salon, obligatoire) — Salon du règlement

### /resume-salon

Résumé par l'IA de ce que tu as raté dans un salon public  
Catégorie : Général · Utilisation : `/resume-salon [salon] [heures]`

- `salon` (salon, facultatif) — Salon (celui-ci par défaut)
- `heures` (nombre entier, facultatif) — Fenêtre (1 à 24 h, 3 par défaut)

### /salon-temp

Crée un salon texte supprimé tout seul après l'événement  
Catégorie : Administration & sécurité · Utilisation : `/salon-temp nom [heures]`

- `nom` (texte, obligatoire, 90 caractères max) — Nom du salon
- `heures` (nombre entier, facultatif) — Durée (1 à 168 h, 24 par défaut)

### /sanction

Historique complet des sanctions d'un membre (tous bots confondus)  
Catégorie : Modération · Utilisation : `/sanction membre [page]`

- `membre` (membre, obligatoire) — Membre à consulter
- `page` (nombre entier, facultatif) — Page de l'historique (10 sanctions par page)

### /sanction-type

Admins : gère les sanctions prédéfinies de /tempmute et leurs durées  
Catégorie : Modération · Utilisation : `/sanction-type liste · ajouter nom duree · modifier sanction [nom] [duree] · supprimer sanction`

- `/sanction-type liste` — Affiche les sanctions prédéfinies et leurs durées
- `/sanction-type ajouter` — Ajoute une sanction prédéfinie<br>`nom` (texte, obligatoire, 80 caractères max) — Nom de la sanction (ex. Spam)<br>`duree` (texte, obligatoire, 20 caractères max) — Durée : 10m, 1h, 1h30, 2j…
- `/sanction-type modifier` — Modifie le nom ou la durée d'une sanction<br>`sanction` (texte, obligatoire, 20 caractères max) — Sanction à modifier<br>`nom` (texte, facultatif, 80 caractères max) — Nouveau nom<br>`duree` (texte, facultatif, 20 caractères max) — Nouvelle durée : 10m, 1h, 2j…
- `/sanction-type supprimer` — Supprime une sanction prédéfinie<br>`sanction` (texte, obligatoire, 20 caractères max) — Sanction à supprimer

### /sante

Staff : état des 6 bots  
Catégorie : Administration & sécurité · Utilisation : `/sante`

### /screening

Admins : écran d'adhésion alimenté par le règlement validé  
Catégorie : Embeds & règlement · Utilisation : `/screening configurer salon role · synchroniser · etat`

- `/screening configurer` — Publie le règlement avec un bouton « J'accepte » qui donne l'accès<br>`salon` (salon, obligatoire) — Salon d'arrivée<br>`role` (rôle, obligatoire) — Rôle donné après acceptation
- `/screening synchroniser` — Copie le règlement validé dans le Membership Screening natif de Discord
- `/screening etat` — Affiche la configuration de l'écran d'adhésion

### /snipe

Staff : dernier message supprimé ou modifié d'un salon (10 dernières minutes)  
Catégorie : Modération · Utilisation : `/snipe [type] [salon]`

- `type` (texte, facultatif, choix : Supprimé, Modifié) — Supprimé (par défaut) ou modifié
- `salon` (salon, facultatif) — Salon (par défaut : celui-ci)

### /tempmute

Exclut temporairement un membre avec une sanction prédéfinie (durée automatique)  
Catégorie : Modération · Utilisation : `/tempmute membre sanction [raison]`

- `membre` (membre, obligatoire) — Membre à sanctionner
- `sanction` (texte, obligatoire, 20 caractères max) — Sanction prédéfinie : sa durée s'applique automatiquement
- `raison` (texte, facultatif, 300 caractères max) — Précision facultative (contexte, message en cause)

### /ui

Fiche d'un membre : abonnement, boost, vocal, dates, rôles  
Catégorie : Utilitaires · Utilisation : `/ui [membre]`

- `membre` (membre, facultatif) — Membre (vide = toi)

### /unmute

Retire la sourdine d’un membre  
Catégorie : Modération · Utilisation : `/unmute membre [raison]`

- `membre` (membre, obligatoire) — Membre à rendre muet
- `raison` (texte, facultatif, 300 caractères max) — Raison

### /warn

Avertit un membre et enregistre la raison  
Catégorie : Modération · Utilisation : `/warn membre raison [expire]`

- `membre` (membre, obligatoire) — Membre à avertir
- `raison` (texte, obligatoire, 300 caractères max) — Raison de l’avertissement
- `expire` (nombre entier, facultatif) — Expiration en jours (0 = jamais)

### /warnings

Affiche les avertissements actifs d’un membre  
Catégorie : Modération · Utilisation : `/warnings [membre]`

- `membre` (membre, facultatif) — Membre à consulter (par défaut : toi)

## GUARD (préfixe `+`)

Administration lourde (+ban, +kick, blacklist), GuildGuard, vérification, anti-spam

23 commandes.

### /antinuke

GUARD : protection contre les destructions en masse (salons, rôles, bans, webhooks)  
Catégorie : Administration & sécurité · Utilisation : `/antinuke etat | activer | desactiver | seuil | confiance-ajouter | confiance-retirer`

- `/antinuke etat` — Affiche la protection anti-nuke · préfixe `+antinuke etat`
- `/antinuke activer` — Active l'anti-nuke · préfixe `+antinuke activer`
- `/antinuke desactiver` — Désactive l'anti-nuke · préfixe `+antinuke desactiver`
- `/antinuke seuil` — Nombre d'actions destructrices tolérées dans la fenêtre · préfixe `+antinuke seuil`<br>`actions` (nombre entier, obligatoire) — Actions avant réaction (2 à 20)<br>`secondes` (nombre entier, facultatif) — Fenêtre en secondes (10 à 600)
- `/antinuke confiance-ajouter` — Exempte une personne de confiance · préfixe `+antinuke confiance-ajouter`<br>`membre` (membre, obligatoire) — Membre de confiance
- `/antinuke confiance-retirer` — Retire une personne de confiance · préfixe `+antinuke confiance-retirer`<br>`membre` (membre, obligatoire) — Membre

### /automod

GUARD : modération automatique (liens, invitations, mots, majuscules, flood)  
Catégorie : Administration & sécurité · Utilisation : `/automod etat | natif | regle | mot-ajouter | mot-retirer | exempter | retirer-exemption`

- `/automod etat` — Affiche les règles de l'automod · préfixe `+automod etat`
- `/automod natif` — Crée les règles AutoMod natives de Discord (marchent même si les bots sont hors ligne) · préfixe `+automod natif`
- `/automod regle` — Active, désactive ou règle une règle · préfixe `+automod regle`<br>`regle` (texte, obligatoire, choix : Liens, Invitations Discord, Mots interdits, Majuscules excessives, Flood) — Règle<br>`etat` (texte, obligatoire, choix : Activer, Désactiver) — Activer ou désactiver<br>`action` (texte, facultatif, choix : Supprimer, Supprimer + avertir, Supprimer + exclure) — Sanction<br>`minutes` (nombre entier, facultatif) — Durée d'exclusion (1 à 10080)
- `/automod mot-ajouter` — Ajoute un mot interdit · préfixe `+automod mot-ajouter`<br>`mot` (texte, obligatoire, 60 caractères max) — Mot ou expression
- `/automod mot-retirer` — Retire un mot interdit · préfixe `+automod mot-retirer`<br>`mot` (texte, obligatoire, 60 caractères max) — Mot ou expression
- `/automod exempter` — Exempte un salon ou un rôle · préfixe `+automod exempter`<br>`salon` (salon, facultatif) — Salon<br>`role` (rôle, facultatif) — Rôle
- `/automod retirer-exemption` — Retire l'exemption d'un salon ou d'un rôle · préfixe `+automod retirer-exemption`<br>`salon` (salon, facultatif) — Salon<br>`role` (rôle, facultatif) — Rôle

### /ban

Bannit un membre du serveur  
Catégorie : Modération · Utilisation : `/ban membre raison preuve|capture`

- `membre` (membre, obligatoire) — Membre à bannir
- `raison` (texte, obligatoire, 300 caractères max) — Raison
- `preuve` (texte, facultatif, 300 caractères max) — Lien du message ou description précise (preuve obligatoire)
- `capture` (fichier, facultatif) — Capture d'écran de la preuve

### /blacklist

OWNER et SYS+ : bannit un compte et le rebannit automatiquement s’il revient  
Catégorie : Modération · Utilisation : `/blacklist add membre|id [raison] · remove · list · check`

- `/blacklist add` — Blackliste et bannit un compte (même absent du serveur) · préfixe `+blacklist add`<br>`membre` (membre, facultatif) — Membre à blacklister<br>`id` (texte, facultatif, 25 caractères max) — Ou identifiant Discord du compte<br>`raison` (texte, facultatif, 300 caractères max) — Raison (facultatif)
- `/blacklist remove` — Retire un compte de la blacklist et le débannit · préfixe `+blacklist remove`<br>`membre` (membre, facultatif) — Membre concerné<br>`id` (texte, facultatif, 25 caractères max) — Ou identifiant Discord du compte
- `/blacklist list` — Affiche la blacklist du serveur · préfixe `+blacklist list`
- `/blacklist check` — Vérifie si un compte est blacklisté · préfixe `+blacklist check`<br>`membre` (membre, facultatif) — Membre concerné<br>`id` (texte, facultatif, 25 caractères max) — Ou identifiant Discord du compte

### /bouclier

Salon piège, sauvegardes du serveur et verrouillage d'urgence  
Catégorie : Administration · Utilisation : `/bouclier piege | sauvegarder | restaurer | verrouiller | etat`

- `/bouclier etat` — Ce que le bouclier protège en ce moment · préfixe `+bouclier etat`
- `/bouclier piege` — Arme un salon piège anti-robot · préfixe `+bouclier piege`<br>`action` (texte, facultatif, choix : Mettre en quarantaine (recommandé), Signaler seulement, Expulser, Bannir) — Sanction appliquée à qui y écrit<br>`salon` (salon, facultatif) — Salon existant à utiliser (sinon le bot en crée un)
- `/bouclier piege-off` — Désarme le salon piège · préfixe `+bouclier piege-off`
- `/bouclier sauvegarder` — Enregistre la structure du serveur · préfixe `+bouclier sauvegarder`<br>`nom` (texte, facultatif, 40 caractères max) — Nom de la sauvegarde
- `/bouclier sauvegardes` — Liste les sauvegardes disponibles · préfixe `+bouclier sauvegardes`
- `/bouclier restaurer` — Aperçu puis restauration d'une sauvegarde · préfixe `+bouclier restaurer`<br>`sauvegarde` (nombre entier, obligatoire) — Numéro de la sauvegarde
- `/bouclier verrouiller` — Ferme tous les salons à l'écriture · préfixe `+bouclier verrouiller`<br>`raison` (texte, facultatif, 200 caractères max) — Raison affichée dans le journal
- `/bouclier deverrouiller` — Rouvre les salons que le verrouillage avait fermés · préfixe `+bouclier deverrouiller`

### /casier

GUARD : historique des sanctions d'un membre  
Catégorie : Modération · Utilisation : `/casier voir membre · /casier supprimer affaire motif`

- `/casier voir` — Affiche le casier d'un membre · préfixe `+casier voir`<br>`membre` (membre, obligatoire) — Membre
- `/casier supprimer` — SYS+ : retire une affaire du casier (archivée, avec un motif) · préfixe `+casier supprimer`<br>`affaire` (nombre entier, obligatoire) — Numéro de l'affaire<br>`motif` (texte, obligatoire, 300 caractères max) — Pourquoi l'affaire est retirée

### /doublecompte

GUARD : ce compte ressemble-t-il à un membre banni ? (indice pour le staff)  
Catégorie : Modération · Utilisation : `/doublecompte membre`

- `membre` (membre, obligatoire) — Compte à vérifier

### /guildguard

Configure GuildGuard : admission, anti-raid et confinement  
Catégorie : Administration & sécurité · Utilisation : `/guildguard status | enable | disable | account-age | raid | quarantine | log | lockdown | review | resolve`

- `/guildguard status` — Affiche l’état de GuildGuard · préfixe `+guildguard status`
- `/guildguard enable` — Active GuildGuard · préfixe `+guildguard enable`
- `/guildguard disable` — Désactive GuildGuard · préfixe `+guildguard disable`
- `/guildguard account-age` — Âge minimal du compte Discord · préfixe `+guildguard account-age`<br>`jours` (nombre entier, obligatoire) — Nombre de jours requis (0 = désactivé)
- `/guildguard raid` — Seuil de détection des rafales de connexions · préfixe `+guildguard raid`<br>`connexions` (nombre entier, obligatoire) — Connexions autorisées dans la fenêtre<br>`secondes` (nombre entier, obligatoire) — Durée de la fenêtre en secondes
- `/guildguard quarantine` — Rôle attribué aux comptes suspects · préfixe `+guildguard quarantine`<br>`role` (rôle, obligatoire) — Rôle de quarantaine
- `/guildguard log` — Salon du journal GuildGuard · préfixe `+guildguard log`<br>`salon` (salon, obligatoire) — Salon textuel
- `/guildguard lockdown` — Active ou désactive le confinement des nouvelles arrivées · préfixe `+guildguard lockdown`<br>`etat` (texte, obligatoire, choix : Activer, Désactiver) — Nouvel état
- `/guildguard review` — Affiche les dossiers Guardian à examiner · préfixe `+guildguard review`
- `/guildguard resolve` — Clôt un dossier de revue humaine · préfixe `+guildguard resolve`<br>`id` (nombre entier, obligatoire) — Identifiant du dossier<br>`decision` (texte, obligatoire, choix : Examiné, Classé sans suite) — Décision<br>`note` (texte, facultatif, 300 caractères max) — Note interne facultative

### /kick

Expulse un membre du serveur  
Catégorie : Modération · Utilisation : `/kick membre raison`

- `membre` (membre, obligatoire) — Membre à expulser
- `raison` (texte, obligatoire, 300 caractères max) — Raison

### /lock

Verrouille le salon pour @everyone  
Catégorie : Modération · Utilisation : `/lock`

### /medias

GUARD : salons réservés aux médias (texte seul supprimé, fil de commentaires)  
Catégorie : Modération · Utilisation : `/medias ajouter salon [fils] · retirer salon · liste`

- `/medias ajouter` — Réserve un salon aux médias · préfixe `+medias ajouter`<br>`salon` (salon, obligatoire) — Salon<br>`fils` (oui/non, facultatif) — Fil de commentaires sous chaque média (oui par défaut)
- `/medias retirer` — Rend un salon normal · préfixe `+medias retirer`<br>`salon` (salon, obligatoire) — Salon
- `/medias liste` — Les salons médias du serveur · préfixe `+medias liste`

### /nettoyer

Supprime les derniers messages de ce salon  
Catégorie : Général · Utilisation : `/nettoyer nombre`

- `nombre` (nombre entier, obligatoire) — Nombre de messages à supprimer (1–100)

### /nuit

GUARD : mode nuit planifié (mode lent, verrouillage, anti-raid renforcé)  
Catégorie : Administration & sécurité · Utilisation : `/nuit etat · configurer · activer · desactiver · salon-ajouter · salon-retirer`

- `/nuit etat` — Réglages et état du mode nuit · préfixe `+nuit etat`
- `/nuit configurer` — Plage horaire et mesures de nuit · préfixe `+nuit configurer`<br>`debut` (nombre entier, facultatif) — Heure de début, Paris (0 à 23)<br>`fin` (nombre entier, facultatif) — Heure de fin, Paris (0 à 23)<br>`lent` (nombre entier, facultatif) — Mode lent en secondes (0 = aucun)<br>`verrouiller` (oui/non, facultatif) — Empêcher @everyone d'écrire la nuit<br>`antiraid` (nombre entier, facultatif) — Seuil d'arrivées du mode raid la nuit (3 à 100)
- `/nuit activer` — Programme le mode nuit · préfixe `+nuit activer`
- `/nuit desactiver` — Arrête le mode nuit (salons remis comme avant) · préfixe `+nuit desactiver`
- `/nuit salon-ajouter` — Ajoute un salon concerné · préfixe `+nuit salon-ajouter`<br>`salon` (salon, obligatoire) — Salon
- `/nuit salon-retirer` — Retire un salon · préfixe `+nuit salon-retirer`<br>`salon` (salon, obligatoire) — Salon

### /panic

Admins : verrouillage d'urgence (salons fermés + mode raid)  
Catégorie : Administration & sécurité · Utilisation : `/panic [raison]`

- `raison` (texte, facultatif, 200 caractères max) — Raison

### /piege

Admins : salons appâts — qui y écrit (hors staff) passe en BLR  
Catégorie : Administration & sécurité · Utilisation : `/piege configurer salon · retirer salon · liste`

- `/piege configurer` — Ajoute un salon appât · préfixe `+piege configurer`<br>`salon` (salon, obligatoire) — Salon appât
- `/piege retirer` — Retire un salon appât · préfixe `+piege retirer`<br>`salon` (salon, obligatoire) — Salon appât
- `/piege liste` — Salons appâts actifs · préfixe `+piege liste`

### /purge

Supprime des messages de ce salon  
Catégorie : Modération · Utilisation : `/purge nombre`

- `nombre` (nombre entier, obligatoire) — Nombre de messages (1–100)

### /quarantaine

GUARD : isole un membre (rôles mis de côté) ou lève l'isolement  
Catégorie : Modération · Utilisation : `/quarantaine ajouter membre [raison] · /quarantaine retirer membre`

- `/quarantaine ajouter` — Met un membre en quarantaine · préfixe `+quarantaine ajouter`<br>`membre` (membre, obligatoire) — Membre<br>`raison` (texte, facultatif, 300 caractères max) — Raison
- `/quarantaine retirer` — Lève la quarantaine et rend les rôles · préfixe `+quarantaine retirer`<br>`membre` (membre, obligatoire) — Membre

### /raid

Admins : mode raid (invitations fermées, comptes récents en quarantaine)  
Catégorie : Administration & sécurité · Utilisation : `/raid etat · on · off · purge · seuils`

- `/raid etat` — État et seuils du mode raid · préfixe `+raid etat`
- `/raid on` — Active le mode raid à la main · préfixe `+raid on`<br>`raison` (texte, facultatif, 200 caractères max) — Raison
- `/raid off` — Coupe le mode raid · préfixe `+raid off`<br>`raison` (texte, facultatif, 200 caractères max) — Raison
- `/raid purge` — Quarantaine ou expulsion d'un coup des comptes récents arrivés pendant un raid · préfixe `+raid purge`<br>`minutes` (nombre entier, facultatif) — Arrivés dans les X dernières minutes (1 à 60, 10 par défaut)<br>`anciennete_jours` (nombre entier, facultatif) — Comptes créés il y a moins de X jours (0 à 30, 7 par défaut)<br>`action` (texte, facultatif, choix : Quarantaine, Expulsion) — Quarantaine (défaut) ou expulsion<br>`confirmer` (oui/non, facultatif) — Vrai pour exécuter (sinon simple aperçu)
- `/raid seuils` — Seuils de détection automatique · préfixe `+raid seuils`<br>`arrivees` (nombre entier, obligatoire) — Arrivées déclenchant le mode raid<br>`secondes` (nombre entier, obligatoire) — Fenêtre en secondes<br>`calme` (nombre entier, obligatoire) — Minutes de calme avant la sortie automatique

### /scan

Admins : audit de sécurité du serveur avec un score  
Catégorie : Administration & sécurité · Utilisation : `/scan`

### /slowmode

Règle le mode lent du salon  
Catégorie : Modération · Utilisation : `/slowmode secondes`

- `secondes` (nombre entier, obligatoire) — Délai entre deux messages (0–21600)

### /tempban

Bannit un membre pour une durée, débanni automatiquement ensuite  
Catégorie : Modération · Utilisation : `/tempban membre duree raison`

- `membre` (membre, obligatoire) — Membre à bannir
- `duree` (texte, obligatoire, 20 caractères max) — Durée : 30m, 12h, 7j, 1h30… (365 jours au plus)
- `raison` (texte, obligatoire, 300 caractères max) — Raison

### /unlock

Déverrouille le salon pour @everyone  
Catégorie : Modération · Utilisation : `/unlock`

### /verify

Vérifie un membre ou publie le panneau de vérification  
Catégorie : Modération · Utilisation : `/verify moi | panel [salon] [role]`

- `/verify moi` — Te donner le rôle de vérification · préfixe `+verify moi`
- `/verify panel` — Publie le panneau de vérification (et règle la vérification si tu choisis un rôle) · préfixe `+verify panel`<br>`salon` (salon, facultatif) — Salon où publier le panneau<br>`role` (rôle, facultatif) — Rôle « Vérifié » donné après la vérification (active le module)
- `/verify reaction` — Vérification par réaction : publie le message dans un salon · préfixe `+verify reaction`<br>`salon` (salon, obligatoire) — Salon d’accès<br>`role` (rôle, obligatoire) — Rôle donné après réaction
- `/verify reaction-off` — Désactive la vérification par réaction · préfixe `+verify reaction-off`

## FDPDLAVOC (préfixe `;`)

Musique, radio, vocaux temporaires, accès vocaux, ;mv et ;accessall

22 commandes.

### /accessall

Ouvre ton vocal à tout le monde (photo des permissions) ; annuler = retour  
Catégorie : Vocal & DOG · Utilisation : `/accessall [annuler]`

- `annuler` (oui/non, facultatif) — Revenir aux permissions d'avant

### /attente

FDPDLAVOC : salle d'attente du support vocal, le staff est alerté quand un membre attend  
Catégorie : Musique & radio · Utilisation : `/attente etat · configurer salle alerte [role] · desactiver`

- `/attente etat` — Réglages actuels · préfixe `;attente etat`
- `/attente configurer` — Choisis la salle d'attente, le salon d'alerte et le rôle à prévenir · préfixe `;attente configurer`<br>`salle` (salon, obligatoire) — Salon vocal d'attente<br>`alerte` (salon, obligatoire) — Salon textuel des alertes staff<br>`role` (rôle, facultatif) — Rôle support à mentionner
- `/attente desactiver` — Coupe les alertes · préfixe `;attente desactiver`

### /blindtest

FDPDLAVOC : blind test musical dans ton salon vocal  
Catégorie : Musique & radio · Utilisation : `/blindtest lancer [manches] [playlist] · stop · classement`

- `/blindtest lancer` — Lance une partie dans ton vocal (réponses écrites dans ce salon) · préfixe `;blindtest lancer`<br>`manches` (nombre entier, facultatif) — Nombre de manches (3 à 15, 8 par défaut)<br>`playlist` (texte, facultatif, 40 caractères max) — Une de tes playlists musique (sinon la liste par défaut)
- `/blindtest stop` — Arrête la partie en cours (organisateur ou staff) · préfixe `;blindtest stop`
- `/blindtest classement` — Classement du blind test sur le serveur · préfixe `;blindtest classement`

### /dj

FDPDLAVOC : rôle DJ (contrôle de la musique, vote pour passer)  
Catégorie : Musique & radio · Utilisation : `/dj [role]`

- `role` (rôle, facultatif) — Rôle DJ (vide = tout le monde contrôle la musique)

### /effet

FDPDLAVOC : applique un effet audio à la musique  
Catégorie : Musique & radio · Utilisation : `/effet type`

- `type` (texte, obligatoire, choix : Aucun, Bass boost, Nightcore, 8D, Rapide, Lent) — Effet

### /lecture

FDPDLAVOC : lit à voix haute le chat de ton vocal (pour qui ne peut pas parler)  
Catégorie : Musique & radio · Utilisation : `/lecture activer · desactiver`

- `/lecture activer` — Le bot rejoint ton vocal et lit les messages écrits dans son chat · préfixe `;lecture activer`
- `/lecture desactiver` — Arrête la lecture vocale (celui qui l'a lancée ou le staff) · préfixe `;lecture desactiver`

### /music

Contrôle la lecture, la file et le lecteur vocal  
Catégorie : Musique & radio · Utilisation : `/music player play|pause|resume|skip|stop|queue|nowplaying|volume|loop|shuffle|clearqueue|remove|join|leave|panel`

- `/music player play` — Joue un lien YouTube/SoundCloud ou recherche un titre · préfixe `;music player play`<br>`recherche` (texte, obligatoire, 500 caractères max) — Lien YouTube/SoundCloud ou titre à rechercher
- `/music player recherche` — Cherche un titre et choisis parmi 5 résultats · préfixe `;music player recherche`<br>`titre` (texte, obligatoire, 200 caractères max) — Titre, artiste…
- `/music player pause` — Met la musique en pause · préfixe `;music player pause`
- `/music player resume` — Reprend la lecture de la musique · préfixe `;music player resume`
- `/music player skip` — Passe au titre suivant · préfixe `;music player skip`
- `/music player stop` — Arrête la musique et vide la file · préfixe `;music player stop`
- `/music player queue` — Affiche la file d’attente musicale · préfixe `;music player queue`
- `/music player nowplaying` — Affiche le titre en cours de lecture · préfixe `;music player nowplaying`
- `/music player volume` — Règle le volume de la musique · préfixe `;music player volume`<br>`niveau` (nombre entier, obligatoire) — Volume entre 0 et 100
- `/music player loop` — Change le mode de répétition · préfixe `;music player loop`<br>`mode` (texte, facultatif, choix : Désactivée, Titre, File, Auto (titres proches à la fin de la file)) — Mode de répétition
- `/music player shuffle` — Mélange la file d’attente musicale · préfixe `;music player shuffle`
- `/music player clearqueue` — Vide la file d’attente musicale · préfixe `;music player clearqueue`
- `/music player remove` — Retire un titre de la file d’attente · préfixe `;music player remove`<br>`position` (nombre entier, obligatoire) — Position du titre dans /music player queue
- `/music player join` — Connecte le bot à ton salon vocal · préfixe `;music player join`
- `/music player leave` — Déconnecte le bot du salon vocal · préfixe `;music player leave`
- `/music player panel` — Affiche le panneau de contrôle musical · préfixe `;music player panel`

### /muteall

Rend muets les membres d'un vocal (aperçu puis confirmation)  
Catégorie : Vocal & DOG · Utilisation : `/muteall [salon]`

- `salon` (salon, facultatif) — Vocal (par défaut : le tien)

### /mvall

Déplace tous les membres d'un vocal vers un autre (aperçu puis confirmation)  
Catégorie : Vocal & DOG · Utilisation : `/mvall source cible`

- `source` (salon, obligatoire) — Vocal source
- `cible` (salon, obligatoire) — Vocal cible

### /mvrole

Déplace les membres d'un rôle connectés vers un vocal  
Catégorie : Vocal & DOG · Utilisation : `/mvrole role cible`

- `role` (rôle, obligatoire) — Rôle
- `cible` (salon, obligatoire) — Vocal cible

### /playlist

FDPDLAVOC : tes playlists enregistrées  
Catégorie : Musique & radio · Utilisation : `/playlist sauver nom · charger nom · liste · supprimer nom`

- `/playlist sauver` — Enregistre la musique en cours et la file · préfixe `;playlist sauver`<br>`nom` (texte, obligatoire, 40 caractères max) — Nom
- `/playlist charger` — Lance une de tes playlists · préfixe `;playlist charger`<br>`nom` (texte, obligatoire, 40 caractères max) — Nom
- `/playlist liste` — Tes playlists · préfixe `;playlist liste`
- `/playlist supprimer` — Supprime une playlist · préfixe `;playlist supprimer`<br>`nom` (texte, obligatoire, 40 caractères max) — Nom

### /pull

Amène un membre dans ton salon vocal  
Catégorie : Vocal & DOG · Utilisation : `/pull membre`

- `membre` (membre, obligatoire) — Membre

### /pv

Rend privé le salon vocal où tu te trouves  
Catégorie : Vocal & DOG · Utilisation : `/pv`

### /radio

Gère la radio PND 24/7 et ses hôtes autorisés  
Catégorie : Musique & radio · Utilisation : `/radio status | station | set | host-add | host-remove | host-list | start | stop | clear`

- `/radio status` — Affiche l’état de la radio · préfixe `;radio status`
- `/radio set` — Configure et lance la radio (administration) · préfixe `;radio set`<br>`salon` (salon, obligatoire) — Salon vocal de diffusion<br>`source` (texte, obligatoire, 2000 caractères max) — URL de flux audio HTTPS direct
- `/radio station` — Lance une station prête à l'emploi (FIP, Mouv', France Inter…) · préfixe `;radio station`<br>`salon` (salon, obligatoire) — Salon vocal de diffusion<br>`station` (texte, obligatoire, choix : FIP, FIP Rock, FIP Jazz, FIP Groove, FIP Electro, Mouv', France Inter) — Station
- `/radio host-add` — Autorise un hôte audio HTTPS pour ce serveur · préfixe `;radio host-add`<br>`hote` (texte, obligatoire, 253 caractères max) — Nom DNS exact, par exemple audio.example.org
- `/radio host-remove` — Retire un hôte audio autorisé · préfixe `;radio host-remove`<br>`hote` (texte, obligatoire, 253 caractères max) — Nom DNS exact
- `/radio host-list` — Liste les hôtes audio autorisés · préfixe `;radio host-list`
- `/radio start` — Démarre la radio configurée (administration) · préfixe `;radio start`
- `/radio stop` — Arrête la radio sans effacer sa configuration (administration) · préfixe `;radio stop`
- `/radio clear` — Supprime la configuration radio (administration) · préfixe `;radio clear`

### /swap

Échange les salons vocaux de deux membres  
Catégorie : Vocal & DOG · Utilisation : `/swap membre_a membre_b`

- `membre_a` (membre, obligatoire) — Premier membre
- `membre_b` (membre, obligatoire) — Second membre

### /undo

Annule la dernière action vocale de masse (30 min)  
Catégorie : Vocal & DOG · Utilisation : `/undo`

### /unmuteall

Rend la parole aux membres d'un vocal  
Catégorie : Vocal & DOG · Utilisation : `/unmuteall [salon]`

- `salon` (salon, facultatif) — Vocal (par défaut : le tien)

### /unpv

Rétablit les permissions d’origine de ton salon vocal privé  
Catégorie : Vocal & DOG · Utilisation : `/unpv`

### /vclear

Déconnecte les membres d'un vocal (aperçu puis confirmation)  
Catégorie : Vocal & DOG · Utilisation : `/vclear [salon]`

- `salon` (salon, facultatif) — Vocal (par défaut : le tien)

### /voc

Gère ton salon vocal temporaire  
Catégorie : Vocal & DOG · Utilisation : `/voc panel | vocal-panel | demander | demander-id | limit | name | claim | expulser | inviter | transferer | lock | unlock | delete | confiance | bloquer | retirer | listes`

- `/voc panel` — Affiche le panneau de contrôle du salon temporaire · préfixe `;voc panel`
- `/voc vocal-panel` — Ouvre le panneau de contrôle d’accès vocal classique · préfixe `;voc vocal-panel`
- `/voc demander` — Demande l’accès à une vocale privée · préfixe `;voc demander`<br>`salon` (salon, obligatoire) — Vocale privée à rejoindre
- `/voc demander-id` — Demande l’accès à une vocale cachée via son ID · préfixe `;voc demander-id`<br>`id` (texte, obligatoire, 25 caractères max) — ID de la vocale privée
- `/voc debloquer` — Autorise un membre à refaire une demande vocale · préfixe `;voc debloquer`<br>`salon` (salon, obligatoire) — Vocale privée<br>`membre` (membre, obligatoire) — Membre à débloquer
- `/voc limit` — Règle la limite de membres · préfixe `;voc limit`<br>`nombre` (nombre entier, obligatoire) — 0 = illimité, 1–99
- `/voc name` — Renomme le salon temporaire · préfixe `;voc name`<br>`nom` (texte, obligatoire, 100 caractères max) — Nouveau nom
- `/voc claim` — Deviens propriétaire si l’ancien a quitté · préfixe `;voc claim`
- `/voc expulser` — Sort un membre de ton salon et l’empêche de revenir · préfixe `;voc expulser`<br>`membre` (membre, obligatoire) — Membre
- `/voc inviter` — Autorise un membre à rejoindre ton salon · préfixe `;voc inviter`<br>`membre` (membre, obligatoire) — Membre
- `/voc transferer` — Donne la propriété du salon à un membre présent · préfixe `;voc transferer`<br>`membre` (membre, obligatoire) — Membre
- `/voc lock` — Empêche les autres membres de rejoindre · préfixe `;voc lock`
- `/voc unlock` — Autorise à nouveau les membres à rejoindre · préfixe `;voc unlock`
- `/voc delete` — Supprime ton salon temporaire · préfixe `;voc delete`
- `/voc confiance` — Ajoute un membre de confiance : il entre toujours dans tes salons · préfixe `;voc confiance`<br>`membre` (membre, obligatoire) — Membre
- `/voc bloquer` — Bloque un membre : il ne peut plus entrer dans tes salons · préfixe `;voc bloquer`<br>`membre` (membre, obligatoire) — Membre
- `/voc retirer` — Retire un membre de ta liste de confiance ou de blocage · préfixe `;voc retirer`<br>`membre` (membre, obligatoire) — Membre
- `/voc listes` — Affiche tes membres de confiance et tes membres bloqués · préfixe `;voc listes`

### /vocal-plus

Préréglages de ton vocal temporaire et classement du temps en vocal  
Catégorie : Vocal & DOG · Utilisation : `/vocal-plus classement | preset-sauver | preset-charger | preset-liste | preset-supprimer`

- `/vocal-plus classement` — Top 10 du temps en vocal · préfixe `;vocal-plus classement`<br>`periode` (texte, facultatif, choix : Cette semaine, 30 jours, Depuis le début) — Période
- `/vocal-plus preset-sauver` — Enregistre le nom et la limite de ton vocal actuel · préfixe `;vocal-plus preset-sauver`<br>`nom` (texte, obligatoire, 30 caractères max) — Nom du préréglage
- `/vocal-plus preset-charger` — Applique un préréglage à ton vocal · préfixe `;vocal-plus preset-charger`<br>`nom` (texte, obligatoire, 30 caractères max) — Nom du préréglage
- `/vocal-plus preset-liste` — Tes préréglages · préfixe `;vocal-plus preset-liste`
- `/vocal-plus preset-supprimer` — Supprime un préréglage · préfixe `;vocal-plus preset-supprimer`<br>`nom` (texte, obligatoire, 30 caractères max) — Nom du préréglage

### /voice

Gère les accès et la confidentialité des salons vocaux  
Catégorie : Vocal & DOG · Utilisation : `/voice access grant|revoke · /voice private activer|liste|retirer`

- `/voice access grant` — Autorise un membre à rejoindre ton salon vocal · préfixe `;voice access grant`<br>`membre` (membre, obligatoire) — Membre à autoriser
- `/voice access revoke` — Retire l’accès d’un membre à ton salon vocal · préfixe `;voice access revoke`<br>`membre` (membre, obligatoire) — Membre à retirer de la liste d’accès
- `/voice private activer` — Rend ton salon vocal actuel privé · préfixe `;voice private activer`
- `/voice private liste` — Liste les salons privatisés du serveur · préfixe `;voice private liste`
- `/voice private retirer` — Rétablit les permissions d’origine de ton salon vocal · préfixe `;voice private retirer`

## SUCK ME (préfixe `=`)

SYS+, rôles, DOG, MENOTTE, LOCKNAME, communauté (tickets, social, giveaways, AFK, IA)

82 commandes.

### /academy

Accède aux parcours PND Academy  
Catégorie : Social & cartes · Utilisation : `/academy liste | creer | show | complete`

- `/academy liste` — Liste les parcours de formation · préfixe `=academy liste`
- `/academy creer` — Crée un parcours (staff) · préfixe `=academy creer`<br>`titre` (texte, obligatoire, 80 caractères max) — Titre du parcours<br>`etapes` (texte, obligatoire, 1500 caractères max) — Étapes séparées par ; au format Titre:Description
- `/academy show` — Affiche un parcours ou le détail d’une étape · préfixe `=academy show`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant du parcours<br>`etape` (nombre entier, facultatif) — Numéro d’étape (facultatif)
- `/academy complete` — Valide une étape · préfixe `=academy complete`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant du parcours<br>`etape` (nombre entier, obligatoire) — Numéro de l’étape<br>`reponses` (texte, facultatif, 100 caractères max) — Réponses numériques séparées par des virgules (1-based)
- `/academy progress` — Consulte ta progression · préfixe `=academy progress`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant du parcours
- `/academy quiz` — Ajoute une question à une étape (staff) · préfixe `=academy quiz`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant du parcours<br>`etape` (nombre entier, obligatoire) — Numéro de l’étape<br>`configuration` (texte, obligatoire, 900 caractères max) — Question | choix 1 | choix 2 | bonne réponse (1-based)

### /afk

RESUME : signale ton absence et retrouve ce qui s’est passé pendant ce temps  
Catégorie : Administration & sécurité · Utilisation : `/afk on [raison] · /afk off · /afk resume [heures]`

- `/afk on` — Démarre ton absence : les événements importants sont gardés pour toi · préfixe `=afk on`<br>`raison` (texte, facultatif, 200 caractères max) — Raison visible par le staff (facultatif)
- `/afk off` — Termine ton absence et affiche le résumé de ce que tu as manqué · préfixe `=afk off`
- `/afk resume` — Affiche le résumé sans terminer ton absence · préfixe `=afk resume`<br>`heures` (nombre entier, facultatif) — Période à résumer si tu n’es pas absent (1 à 168 h)

### /anciennete

SUCK ME : badges d'ancienneté (1 mois, 6 mois, 1 an) et message d'anniversaire d'arrivée  
Catégorie : Communauté · Utilisation : `/anciennete etat · activer · desactiver · configurer [role-1-mois] [role-6-mois] [role-1-an] [salon]`

- `/anciennete etat` — Réglages actuels · préfixe `=anciennete etat`
- `/anciennete activer` — Active les badges et les anniversaires · préfixe `=anciennete activer`
- `/anciennete desactiver` — Coupe les badges et les anniversaires · préfixe `=anciennete desactiver`
- `/anciennete configurer` — Choisis les rôles et le salon des anniversaires · préfixe `=anciennete configurer`<br>`role-1-mois` (rôle, facultatif) — Rôle après 1 mois<br>`role-6-mois` (rôle, facultatif) — Rôle après 6 mois<br>`role-1-an` (rôle, facultatif) — Rôle après 1 an<br>`salon` (salon, facultatif) — Salon des messages d'anniversaire

### /anim

Animation du serveur : salon de comptage, mur des célébrités, question du jour  
Catégorie : Communauté · Utilisation : `/anim comptage salon|etat|classement|desactiver · /anim vedette config|etat|desactiver · /anim qdj config|etat|ajouter|maintenant|sans_role|desactiver`

- `/anim comptage etat` — Où en est le comptage, et le record · préfixe `=anim comptage etat`
- `/anim comptage classement` — Les meilleurs compteurs du serveur · préfixe `=anim comptage classement`
- `/anim comptage salon` — Staff : choisit le salon de comptage et l'active · préfixe `=anim comptage salon`<br>`salon` (salon, obligatoire) — Salon de comptage
- `/anim comptage desactiver` — Staff : arrête le comptage (le record est gardé) · préfixe `=anim comptage desactiver`
- `/anim vedette etat` — Réglages et statistiques du mur · préfixe `=anim vedette etat`
- `/anim vedette config` — Staff : salon du mur, emoji et nombre d'étoiles · préfixe `=anim vedette config`<br>`salon` (salon, obligatoire) — Salon où les messages sont recopiés<br>`emoji` (texte, facultatif, 64 caractères max) — Emoji qui compte (⭐ par défaut)<br>`seuil` (nombre entier, facultatif) — Nombre d'étoiles nécessaires (3 par défaut)<br>`auto_etoile` (oui/non, facultatif) — L'auteur peut-il voter pour son propre message ? (non par défaut)
- `/anim vedette desactiver` — Staff : arrête le mur (les messages publiés restent) · préfixe `=anim vedette desactiver`
- `/anim qdj etat` — Réglages de la question du jour · préfixe `=anim qdj etat`
- `/anim qdj config` — Staff : salon, heure (Paris), rôle mentionné et fil · préfixe `=anim qdj config`<br>`salon` (salon, obligatoire) — Salon de la question du jour<br>`heure` (nombre entier, facultatif) — Heure de publication, heure de Paris (18 par défaut)<br>`role` (rôle, facultatif) — Rôle mentionné à chaque question<br>`fil` (oui/non, facultatif) — Ouvrir un fil de réponses (oui par défaut)
- `/anim qdj ajouter` — Staff : ajoute une question, publiée avant les questions intégrées · préfixe `=anim qdj ajouter`<br>`question` (texte, obligatoire, 300 caractères max) — La question
- `/anim qdj maintenant` — Staff : publie la question du jour tout de suite · préfixe `=anim qdj maintenant`
- `/anim qdj sans_role` — Staff : ne plus mentionner de rôle · préfixe `=anim qdj sans_role`
- `/anim qdj desactiver` — Staff : arrête la question du jour · préfixe `=anim qdj desactiver`

### /anniversaire

Anniversaires du serveur, souhaités automatiquement  
Catégorie : Social · Utilisation : `/anniversaire definir jour mois · retirer · liste · config`

- `/anniversaire definir` — Enregistre ton anniversaire · préfixe `=anniversaire definir`<br>`jour` (nombre entier, obligatoire) — Jour<br>`mois` (nombre entier, obligatoire) — Mois
- `/anniversaire retirer` — Retire ton anniversaire · préfixe `=anniversaire retirer`
- `/anniversaire liste` — Prochains anniversaires · préfixe `=anniversaire liste`
- `/anniversaire config` — Staff : salon d'annonce et rôle du jour · préfixe `=anniversaire config`<br>`salon` (salon, facultatif) — Salon<br>`role` (rôle, facultatif) — Rôle donné le jour J

### /annonce

SUCK ME : publie une annonce (tout de suite ou programmée)  
Catégorie : SYS+ · Utilisation : `/annonce envoyer salon message [titre] [couleur] [mention] [dans] · liste · annuler`

- `/annonce envoyer` — Publie ou programme une annonce · préfixe `=annonce envoyer`<br>`salon` (salon, obligatoire) — Salon<br>`message` (texte, obligatoire, 3500 caractères max) — Texte (\n pour aller à la ligne)<br>`titre` (texte, facultatif, 200 caractères max) — Titre<br>`couleur` (texte, facultatif, 7 caractères max) — Couleur #RRGGBB<br>`mention` (rôle, facultatif) — Rôle à mentionner<br>`dans` (texte, facultatif, 20 caractères max) — Programmer dans : 30m, 2h, 1j…
- `/annonce liste` — Annonces programmées · préfixe `=annonce liste`
- `/annonce annuler` — Annule une annonce programmée · préfixe `=annonce annuler`<br>`id` (nombre entier, obligatoire) — Numéro

### /anti-moove

Protège individuellement les membres contre les déplacements vocaux forcés  
Catégorie : Vocal & DOG · Utilisation : `/anti-moove config|proteger|retirer|liste|exception-ajouter|exception-retirer|exceptions`

- `/anti-moove config` — Active, désactive ou affiche l’état global · préfixe `=anti-moove config`<br>`etat` (texte, facultatif, choix : Activer, Désactiver) — Nouvel état global (facultatif)
- `/anti-moove proteger` — Protège un membre contre les déplacements forcés · préfixe `=anti-moove proteger`<br>`membre` (membre, obligatoire) — Membre à protéger
- `/anti-moove retirer` — Retire la protection individuelle · préfixe `=anti-moove retirer`<br>`membre` (membre, obligatoire) — Membre à déprotéger
- `/anti-moove liste` — Liste les membres protégés et les exceptions · préfixe `=anti-moove liste`
- `/anti-moove exception-ajouter` — Autorise un membre à déplacer les membres protégés · préfixe `=anti-moove exception-ajouter`<br>`membre` (membre, obligatoire) — Membre autorisé
- `/anti-moove exception-retirer` — Retire une exception individuelle · préfixe `=anti-moove exception-retirer`<br>`membre` (membre, obligatoire) — Membre concerné
- `/anti-moove exceptions` — Liste les membres autorisés à déplacer les membres protégés · préfixe `=anti-moove exceptions`

### /authority

Demandes d'autorisation exceptionnelle, décidées par l'OWNER  
Catégorie : Général · Utilisation : `/authority demander · mes-demandes · statut · historique · panneau · decider`

- `/authority demander` — Demande une autorisation exceptionnelle (décision de l'OWNER) · préfixe `=authority demander`<br>`type` (texte, obligatoire, choix : Salon vocal supplémentaire, Quota de modération doublé (staff), Quota économique supplémentaire, Accès à un module en test, Créer des missions du staff, Planifier des réunions du staff) — Autorisation<br>`justification` (texte, obligatoire, 500 caractères max) — Pourquoi ? (obligatoire)<br>`duree` (texte, facultatif, 20 caractères max) — Durée : 12h, 3j (1 h à 30 j, 24 h par défaut)<br>`beneficiaire` (membre, facultatif) — Pour qui (vide = toi)
- `/authority mes-demandes` — Tes demandes et celles qui te concernent · préfixe `=authority mes-demandes`
- `/authority statut` — État d'une demande · préfixe `=authority statut`<br>`numero` (nombre entier, obligatoire) — Numéro
- `/authority historique` — Historique d'une demande · préfixe `=authority historique`<br>`numero` (nombre entier, obligatoire) — Numéro
- `/authority panneau` — OWNER : demandes en attente et dérogations actives · préfixe `=authority panneau`
- `/authority decider` — OWNER : suspendre, réactiver, révoquer ou prolonger · préfixe `=authority decider`<br>`numero` (nombre entier, obligatoire) — Numéro<br>`action` (texte, obligatoire, choix : Suspendre, Réactiver, Révoquer, Prolonger) — Décision<br>`duree` (texte, facultatif, 20 caractères max) — Prolongation : 12h, 3j

### /automation

Configure les rôles automatiques, MP de bienvenue et messages planifiés  
Catégorie : Automatisation · Utilisation : `/automation status | autorole | welcome | schedule`

- `/automation status` — Affiche la configuration d’automatisation · préfixe `=automation status`
- `/automation autorole-add` — Ajoute un rôle automatique à l’arrivée · préfixe `=automation autorole-add`<br>`role` (rôle, obligatoire) — Rôle à attribuer
- `/automation autorole-remove` — Retire un rôle automatique · préfixe `=automation autorole-remove`<br>`role` (rôle, obligatoire) — Rôle à retirer
- `/automation autorole-list` — Liste les rôles automatiques · préfixe `=automation autorole-list`
- `/automation welcome` — Active ou désactive le MP de bienvenue · préfixe `=automation welcome`<br>`etat` (texte, obligatoire, choix : Activer, Désactiver) — Nouvel état<br>`message` (texte, facultatif, 2000 caractères max) — Message personnalisé ({user}, {server})
- `/automation schedule-add` — Planifie un message récurrent · préfixe `=automation schedule-add`<br>`salon` (salon, obligatoire) — Salon d’envoi<br>`intervalle` (nombre entier, obligatoire) — Intervalle en minutes (5–10080)<br>`message` (texte, obligatoire, 2000 caractères max) — Message à envoyer
- `/automation schedule-remove` — Supprime un message planifié · préfixe `=automation schedule-remove`<br>`id` (nombre entier, obligatoire) — Identifiant du message planifié
- `/automation regles salon` — Salon où le staff valide les déclenchements · préfixe `=automation regles salon`<br>`salon` (salon, obligatoire) — Salon de validation
- `/automation regles creer` — Crée une règle (aperçu puis confirmation staff à chaque déclenchement) · préfixe `=automation regles creer`<br>`declencheur` (texte, obligatoire, choix : Arrivée d’un membre, Départ d’un membre, Message envoyé, Entrée en vocal, Sortie de vocal, Planifiée) — Quand la règle se déclenche<br>`nom` (texte, obligatoire, 80 caractères max) — Nom de la règle<br>`action` (texte, obligatoire, choix : Envoyer un message, Ajouter un rôle, Retirer un rôle) — Ce que fait la règle<br>`salon` (salon, facultatif) — Salon du message (action « message »)<br>`texte` (texte, facultatif, 1500 caractères max) — Texte du message (action « message »)<br>`role` (rôle, facultatif) — Rôle (actions sur les rôles)<br>`intervalle` (nombre entier, facultatif) — Minutes entre deux déclenchements (planifiée, 60 minimum)
- `/automation regles liste` — Liste les règles · préfixe `=automation regles liste`
- `/automation regles desactiver` — Désactive une règle · préfixe `=automation regles desactiver`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de la règle
- `/automation regles confirmer` — Confirme un déclenchement en attente · préfixe `=automation regles confirmer`<br>`run` (texte, obligatoire, 36 caractères max) — Identifiant du déclenchement
- `/automation schedule-list` — Liste les messages planifiés · préfixe `=automation schedule-list`

### /award

Organise les votes et récompenses communautaires  
Catégorie : Social & cartes · Utilisation : `/award liste | creer | vote | close`

- `/award liste` — Liste les campagnes ouvertes · préfixe `=award liste`
- `/award creer` — Crée une campagne (staff) · préfixe `=award creer`<br>`fin` (texte, obligatoire, 40 caractères max) — Date ISO avec fuseau<br>`titre` (texte, obligatoire, 100 caractères max) — Titre<br>`choix` (texte, obligatoire, 500 caractères max) — Options séparées par |
- `/award vote` — Vote pour une option · préfixe `=award vote`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de campagne<br>`option` (nombre entier, obligatoire) — Numéro de l’option
- `/award close` — Clôture une campagne (staff) · préfixe `=award close`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de campagne

### /bio

Définit ta biographie de profil  
Catégorie : Social & cartes · Utilisation : `/bio texte`

- `texte` (texte, obligatoire, 280 caractères max) — Biographie (280 caractères maximum)

### /blr

OWNER, paliers 0 % et 1 % : BLR, plus aucun rôle au-dessus du rôle membre  
Catégorie : Modération · Utilisation : `/blr poser membre [raison] [duree] · lever membre [restaurer] · liste · configurer role membre`

- `/blr poser` — Retire tous les rôles (sauf membre) et pose le BLR · préfixe `=blr poser`<br>`membre` (membre, obligatoire) — Membre visé<br>`raison` (texte, facultatif, 300 caractères max) — Raison (visible dans les journaux du staff seulement)<br>`duree` (texte, facultatif, 20 caractères max) — Durée : 30m, 12h, 7j ou « définitif »
- `/blr lever` — Lève le BLR · préfixe `=blr lever`<br>`membre` (membre, obligatoire) — Membre visé<br>`restaurer` (oui/non, facultatif) — Rendre les anciens rôles qui passent la garde ?
- `/blr liste` — Membres BLR (staff) · préfixe `=blr liste`
- `/blr configurer` — OWNER : rôle BLR et rôle membre · préfixe `=blr configurer`<br>`role` (rôle, obligatoire) — Rôle BLR (sans permission)<br>`membre` (rôle, obligatoire) — Rôle membre (le seul gardé)

### /candidature

Dépose et gère les candidatures PND  
Catégorie : SYS+ · Utilisation : `/candidature deposer|liste|questions|voir|review|assign|entretien|entretiens|evaluation|annuler-entretien`

- `/candidature deposer` — Dépose une candidature pour rejoindre l’équipe PND · préfixe `=candidature deposer`<br>`reponses` (texte, obligatoire, 1000 caractères max) — Réponses séparées par |, sans données sensibles
- `/candidature liste` — Liste les candidatures en attente · préfixe `=candidature liste`
- `/candidature questions` — Configure les questions du formulaire de candidature · préfixe `=candidature questions`<br>`configuration` (texte, obligatoire, 2000 caractères max) — Questions séparées par | (1 à 10)
- `/candidature voir` — Affiche un dossier · préfixe `=candidature voir`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de candidature
- `/candidature review` — Prend une décision sur un dossier · préfixe `=candidature review`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de candidature<br>`decision` (texte, obligatoire, choix : Accepter, Refuser, À revoir) — Décision<br>`note` (texte, facultatif, 300 caractères max) — Note interne
- `/candidature assign` — Affecte un responsable à une candidature · préfixe `=candidature assign`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de candidature<br>`responsable` (membre, obligatoire) — Membre responsable
- `/candidature entretien` — Planifie un entretien · préfixe `=candidature entretien`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de candidature<br>`date` (texte, obligatoire, 40 caractères max) — Date ISO avec fuseau horaire<br>`evaluateur` (membre, obligatoire) — Membre évaluateur<br>`salon` (salon, facultatif) — Salon textuel facultatif
- `/candidature entretiens` — Liste les entretiens à venir · préfixe `=candidature entretiens`
- `/candidature evaluation` — Évalue un entretien terminé · préfixe `=candidature evaluation`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de l'entretien<br>`note` (nombre entier, obligatoire) — Note de 1 à 5<br>`commentaire` (texte, facultatif, 1000 caractères max) — Évaluation interne
- `/candidature annuler-entretien` — Annule un entretien planifié · préfixe `=candidature annuler-entretien`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de l'entretien

### /charte

SUCK ME : charte du staff à lire et accepter, suivi de ceux qui ne l'ont pas fait  
Catégorie : SYS+ · Utilisation : `/charte voir · definir · suivi`

- `/charte voir` — Lis la charte et accepte-la (staff) · préfixe `=charte voir`
- `/charte definir` — Admins : écris ou modifie la charte (chacun devra ré-accepter) · préfixe `=charte definir`
- `/charte suivi` — Admins : qui n'a pas encore accepté la version en cours · préfixe `=charte suivi`

### /clan

Fonde ou rejoins un clan : coffre commun, points et classement  
Catégorie : Communauté · Utilisation : `/clan creer | inviter | rejoindre | info | liste | depot | retrait`

- `/clan creer` — Fonde un clan (50 000 PND) · préfixe `=clan creer`<br>`nom` (texte, obligatoire, 32 caractères max) — Nom du clan (3 à 32 caractères)<br>`tag` (texte, obligatoire, 5 caractères max) — Tag court, 2 à 5 lettres ou chiffres
- `/clan inviter` — Invite un membre dans ton clan · préfixe `=clan inviter`<br>`membre` (membre, obligatoire) — Membre à inviter
- `/clan rejoindre` — Rejoins un clan qui t'a invité · préfixe `=clan rejoindre`<br>`tag` (texte, obligatoire, 5 caractères max) — Tag du clan
- `/clan quitter` — Quitte ton clan · préfixe `=clan quitter`
- `/clan info` — Fiche d'un clan · préfixe `=clan info`<br>`tag` (texte, facultatif, 5 caractères max) — Tag du clan (le tien par défaut)
- `/clan liste` — Classement des clans du serveur · préfixe `=clan liste`<br>`classement` (texte, facultatif, choix : Saison en cours, Depuis toujours) — Points de saison ou points à vie
- `/clan depot` — Verse des PND au coffre du clan · préfixe `=clan depot`<br>`montant` (nombre entier, obligatoire) — Montant en PND
- `/clan retrait` — Retire des PND du coffre (chef) · préfixe `=clan retrait`<br>`montant` (nombre entier, obligatoire) — Montant en PND
- `/clan promouvoir` — Change le rang d'un membre (chef) · préfixe `=clan promouvoir`<br>`membre` (membre, obligatoire) — Membre concerné<br>`rang` (texte, obligatoire, choix : Membre, Officier, Chef (transmet la direction)) — Nouveau rang
- `/clan exclure` — Exclut un membre du clan · préfixe `=clan exclure`<br>`membre` (membre, obligatoire) — Membre à exclure
- `/clan dissoudre` — Dissout le clan et récupère le coffre (chef) · préfixe `=clan dissoudre`

### /color

Change la couleur de ton profil  
Catégorie : Social & cartes · Utilisation : `/color #5865f2`

- `couleur` (texte, obligatoire, 7 caractères max) — Couleur hexadécimale (#RRGGBB)

### /compteurs

SUCK ME : salons compteurs (membres, en vocal, boosts) mis à jour toutes les 10 min  
Catégorie : Communauté · Utilisation : `/compteurs installer · retirer · actualiser`

- `/compteurs installer` — Crée la catégorie Statistiques et ses salons compteurs · préfixe `=compteurs installer`
- `/compteurs retirer` — Supprime les salons compteurs · préfixe `=compteurs retirer`
- `/compteurs actualiser` — Met les compteurs à jour tout de suite · préfixe `=compteurs actualiser`

### /confession

Envoie une confession anonyme : texte, image ou note vocale  
Catégorie : Communauté · Utilisation : `/confession envoyer | config | bloquer | debloquer | stats`

- `/confession envoyer` — Envoie une confession anonyme · préfixe `=confession envoyer`<br>`texte` (texte, facultatif, 1500 caractères max) — Ce que tu veux dire (facultatif si tu joins un fichier)<br>`image` (fichier, facultatif) — Image à joindre (PNG, JPEG, GIF ou WEBP, 8 Mo max)<br>`vocal` (fichier, facultatif) — Note vocale à joindre (MP3, OGG, WAV, M4A ou WEBM, 8 Mo max)
- `/confession config` — Configure les confessions (staff) · préfixe `=confession config`<br>`salon` (salon, facultatif) — Salon où les confessions sont publiées<br>`salon_moderation` (salon, facultatif) — Salon privé où le staff relit et voit les auteurs<br>`moderation` (oui/non, facultatif) — Relire avant publication (recommandé)<br>`confiance_minimale` (nombre entier, facultatif) — Score de confiance requis (0 à 100)<br>`par_jour` (nombre entier, facultatif) — Confessions maximum par membre et par jour
- `/confession bloquer` — Empêche un membre de confesser (staff) · préfixe `=confession bloquer`<br>`membre` (membre, obligatoire) — Membre à bloquer<br>`raison` (texte, facultatif, 200 caractères max) — Raison
- `/confession debloquer` — Rend l'accès aux confessions à un membre (staff) · préfixe `=confession debloquer`<br>`membre` (membre, obligatoire) — Membre à débloquer
- `/confession stats` — Statistiques des confessions du serveur · préfixe `=confession stats`

### /courante

SUCK ME : main courante du staff, journal de bord partagé entre les gardes  
Catégorie : SYS+ · Utilisation : `/courante ajouter texte · voir [jours] · retirer id`

- `/courante ajouter` — Note ce qui s'est passé (400 caractères, pas de données sensibles) · préfixe `=courante ajouter`<br>`texte` (texte, obligatoire, 400 caractères max) — Ce qui s'est passé
- `/courante voir` — Relis les dernières entrées · préfixe `=courante voir`<br>`jours` (nombre entier, facultatif) — Nombre de jours (1 à 30, 2 par défaut)
- `/courante retirer` — Retire une entrée (la tienne, ou n'importe laquelle pour un admin) · préfixe `=courante retirer`<br>`id` (nombre entier, obligatoire) — Numéro de l'entrée

### /decompte

SUCK ME : compte à rebours d'un événement, rappel aux inscrits à J-1 et H-1  
Catégorie : Jeux & événements · Utilisation : `/decompte demarrer id salon · arreter id`

- `/decompte demarrer` — Publie un message qui se met à jour jusqu'au début de l'événement · préfixe `=decompte demarrer`<br>`id` (nombre entier, obligatoire) — Identifiant de l'événement (/event liste)<br>`salon` (salon, obligatoire) — Salon du compte à rebours
- `/decompte arreter` — Arrête le compte à rebours d'un événement · préfixe `=decompte arreter`<br>`id` (nombre entier, obligatoire) — Identifiant de l'événement

### /dmall

Propriétaire : envoie un message privé à tous les membres (aperçu et confirmation)  
Catégorie : SYS+ · Utilisation : `/dmall message:<texte> [role:@rôle]`

- `message` (texte, obligatoire, 1800 caractères max) — Message à envoyer (1 800 caractères maximum)
- `role` (rôle, facultatif) — Limiter aux membres de ce rôle (facultatif)

### /dog

Met un membre en laisse ou liste les laisses actives  
Catégorie : Vocal & DOG · Utilisation : `/dog [membre]`

- `membre` (membre, facultatif) — Membre à mettre en laisse (vide pour afficher la liste)

### /dogall

SYS+ : met en laisse tous les membres de ton salon vocal (dans la limite de tes laisses)  
Catégorie : Vocal & DOG · Utilisation : `/dogall`

### /doginfo

Affiche la laisse DOG d’un membre  
Catégorie : Vocal & DOG · Utilisation : `/doginfo membre`

- `membre` (membre, obligatoire) — Membre à consulter

### /dossier

Staff : affiche un dossier de sanction ou d'action sensible  
Catégorie : Modération · Utilisation : `/dossier numero`

- `numero` (nombre entier, obligatoire) — Numéro du dossier

### /event

Crée et consulte les événements du serveur  
Catégorie : Jeux & événements · Utilisation : `/event creer | liste | supprimer`

- `/event creer` — Crée un événement · préfixe `=event creer`<br>`titre` (texte, obligatoire, 100 caractères max) — Titre de l’événement<br>`date` (texte, obligatoire, 40 caractères max) — Date : JJ/MM/AAAA HH:mm ou ISO<br>`description` (texte, facultatif, 1000 caractères max) — Description (facultative)
- `/event liste` — Liste les prochains événements · préfixe `=event liste`
- `/event supprimer` — Supprime un événement · préfixe `=event supprimer`<br>`id` (nombre entier, obligatoire) — Identifiant de l’événement

### /famille

Relations entre membres : mariage, adoption, arbre familial  
Catégorie : Communauté · Utilisation : `/famille mariage membre · divorce · adopter membre · emanciper · renier membre · arbre [membre]`

- `/famille mariage` — Demander un membre en mariage (il doit accepter) · préfixe `=famille mariage`<br>`membre` (membre, obligatoire) — Membre à épouser
- `/famille divorce` — Mettre fin à ton mariage · préfixe `=famille divorce`
- `/famille adopter` — Proposer d'adopter un membre (il doit accepter) · préfixe `=famille adopter`<br>`membre` (membre, obligatoire) — Membre à adopter
- `/famille emanciper` — Quitter ta famille (tes parents) · préfixe `=famille emanciper`
- `/famille renier` — Retirer un de tes enfants · préfixe `=famille renier`<br>`membre` (membre, obligatoire) — Ton enfant
- `/famille arbre` — Afficher un arbre familial · préfixe `=famille arbre`<br>`membre` (membre, facultatif) — Membre (toi par défaut)

### /fwu

Vue d'ensemble des cinq bots et de leur état  
Catégorie : Communauté · Utilisation : `/fwu`

### /garde

SYS+ : tes outils de garde (relève, astreinte, enquête, appel, gel d'un salon…)  
Catégorie : SYS+ · Utilisation : `/garde moi | releve | astreinte | enquete | bareme | appel | geler | demande-quota | bilan | planning`

- `/garde moi` — Ton quota, tes sanctions récentes, tes malus actifs · préfixe `=garde moi`
- `/garde releve` — Résumé des dernières heures pour prendre la suite · préfixe `=garde releve`<br>`heures` (nombre entier, facultatif) — Fenêtre (1 à 72 h, 12 par défaut)
- `/garde astreinte` — Te déclarer d'astreinte : les alertes de sécurité t'arrivent en privé · préfixe `=garde astreinte`<br>`etat` (texte, obligatoire, choix : Je prends l'astreinte, Je termine, Qui est d'astreinte ?) — Choix
- `/garde enquete` — Arrivée, invitation, vocal, casier et barème d'un membre · préfixe `=garde enquete`<br>`membre` (membre, obligatoire) — Membre
- `/garde bareme` — Sanction suivante proposée selon le casier · préfixe `=garde bareme`<br>`membre` (membre, obligatoire) — Membre
- `/garde appel` — Vote rapide des SYS+ avant une sanction lourde · préfixe `=garde appel`<br>`membre` (membre, obligatoire) — Membre concerné<br>`sanction` (texte, obligatoire, 80 caractères max) — Sanction envisagée<br>`raison` (texte, obligatoire, 300 caractères max) — Motif
- `/garde geler` — Couper l'écriture d'un salon pendant une dispute, réouverture automatique · préfixe `=garde geler`<br>`salon` (salon, facultatif) — Salon (celui-ci par défaut)<br>`minutes` (nombre entier, facultatif) — Durée (1 à 120 min, 10 par défaut)
- `/garde demande-quota` — Demander à l'owner quelques sanctions de plus · préfixe `=garde demande-quota`<br>`nombre` (nombre entier, obligatoire) — Sanctions en plus (1 à 20)<br>`raison` (texte, obligatoire, 300 caractères max) — Pourquoi
- `/garde bilan` — Ton bilan de la semaine (aussi envoyé le dimanche soir) · préfixe `=garde bilan`
- `/garde planning` — Planning du staff : indique tes dispos ou vois celles de tous · préfixe `=garde planning`<br>`dispos` (texte, facultatif, 120 caractères max) — Tes disponibilités (ex. lun-ven 18h-23h) ; vide = voir le planning

### /giveaway

Crée et gère des giveaways  
Catégorie : Jeux & événements · Utilisation : `/giveaway start | end | list | reroll | verifier`

- `/giveaway start` — Lance un giveaway · préfixe `=giveaway start`<br>`prix` (texte, obligatoire, 200 caractères max) — Récompense du giveaway<br>`duree` (texte, obligatoire, 20 caractères max) — Durée : 30m, 2h, 1d…<br>`gagnants` (nombre entier, facultatif) — Nombre de gagnants (1–10)
- `/giveaway end` — Termine un giveaway immédiatement · préfixe `=giveaway end`<br>`id` (texte, obligatoire, 12 caractères max) — Identifiant du giveaway
- `/giveaway list` — Liste les giveaways du serveur · préfixe `=giveaway list`
- `/giveaway reroll` — Nouveau tirage vérifiable (anciens gagnants exclus) · préfixe `=giveaway reroll`<br>`id` (texte, obligatoire, 12 caractères max) — Identifiant du giveaway<br>`gagnants` (nombre entier, facultatif) — Nombre de gagnants (1–10)
- `/giveaway verifier` — Rejoue et vérifie les tirages d'un giveaway · préfixe `=giveaway verifier`<br>`id` (texte, obligatoire, 12 caractères max) — Identifiant du giveaway

### /guide

Guide des permissions : rangs, paliers, quotas, sanctions  
Catégorie : Général · Utilisation : `/guide voir · configurer public [staff] [role_staff] · publier`

- `/guide voir` — Affiche le guide avec un menu de sections · préfixe `=guide voir`
- `/guide configurer` — Admins : salons du guide (public, et staff réservé à un rôle) · préfixe `=guide configurer`<br>`public` (salon, obligatoire) — Salon public du guide<br>`staff` (salon, facultatif) — Salon du guide staff<br>`role_staff` (rôle, facultatif) — Rôle qui voit le guide staff
- `/guide publier` — Admins : republie le guide maintenant · préfixe `=guide publier`

### /ia

Gère ta mémoire de conversation avec le bot  
Catégorie : Général · Utilisation : `/ia memoire etat:activer|desactiver · /ia oublier`

- `/ia memoire` — Choisis si le bot peut conserver le contexte de tes conversations · préfixe `=ia memoire`<br>`etat` (texte, obligatoire, choix : Activer la mémoire pour moi, Désactiver la mémoire pour moi) — Ton choix de consentement
- `/ia oublier` — Efface immédiatement tes conversations mémorisées sur ce serveur · préfixe `=ia oublier`
- `/ia demande` — PND Intelligence : demande une action (aperçu puis confirmation) · préfixe `=ia demande`<br>`texte` (texte, obligatoire, 1500 caractères max) — Ta demande, ex. « crée un rôle Animateur »
- `/ia historique` — PND Intelligence : tes 10 dernières actions · préfixe `=ia historique`

### /invitations

SUCK ME : tes invitations récompensées (PND si l'invité reste 7 jours) et le classement  
Catégorie : Communauté · Utilisation : `/invitations moi [membre] · classement`

- `/invitations moi` — Tes invitations (ou celles d'un membre) · préfixe `=invitations moi`<br>`membre` (membre, facultatif) — Membre
- `/invitations classement` — Les meilleurs inviteurs du serveur · préfixe `=invitations classement`

### /knowledge

Consulte et modifie les rubriques d'information du serveur  
Catégorie : Général · Utilisation : `/knowledge panel | show | edit`

- `/knowledge panel` — Publie le panneau interactif PND Knowledge · préfixe `=knowledge panel`
- `/knowledge show` — Affiche une rubrique · préfixe `=knowledge show`<br>`rubrique` (texte, obligatoire, choix : Permissions & hiérarchie, Recrutement, Tickets & assistance, Règlement, Guide du serveur, Guide SYS+) — Rubrique à consulter
- `/knowledge edit` — Modifie une rubrique (Gérer le serveur) · préfixe `=knowledge edit`<br>`rubrique` (texte, obligatoire, choix : Permissions & hiérarchie, Recrutement, Tickets & assistance, Règlement, Guide du serveur, Guide SYS+) — Rubrique à modifier<br>`titre` (texte, obligatoire, 100 caractères max) — Titre affiché<br>`contenu` (texte, obligatoire, 4000 caractères max) — Texte de la rubrique

### /live

OWNER et SYS+ : règle les alertes LIVE (créateurs, salon, rôle mentionné)  
Catégorie : Automatisation · Utilisation : `/live etat|activer|desactiver|salon|role|ajouter|retirer`

- `/live etat` — Affiche le réglage des alertes LIVE · préfixe `=live etat`
- `/live activer` — Active les alertes LIVE · préfixe `=live activer`
- `/live desactiver` — Désactive les alertes LIVE · préfixe `=live desactiver`
- `/live salon` — Choisit le salon des annonces · préfixe `=live salon`<br>`salon` (salon, obligatoire) — Salon textuel
- `/live role` — Rôle mentionné à chaque LIVE (vide = aucun) · préfixe `=live role`<br>`role` (rôle, facultatif) — Rôle à mentionner
- `/live ajouter` — Suit un nouveau créateur · préfixe `=live ajouter`<br>`plateforme` (texte, obligatoire, choix : YouTube, TikTok, Twitch, Autre) — Plateforme<br>`nom` (texte, obligatoire, 80 caractères max) — Nom affiché du créateur<br>`flux` (texte, obligatoire, 1000 caractères max) — Adresse HTTPS du flux RSS/Atom
- `/live retirer` — Arrête de suivre un créateur · préfixe `=live retirer`<br>`nom` (texte, obligatoire, 80 caractères max) — Nom du créateur

### /lockname

Protège les pseudonymes contre les modifications ultérieures  
Catégorie : SYS+ · Utilisation : `/lockname proteger|retirer|liste`

- `/lockname proteger` — Mémorise le pseudonyme actuel d’un membre · préfixe `=lockname proteger`<br>`membre` (membre, obligatoire) — Membre concerné
- `/lockname retirer` — Désactive la protection d’un membre · préfixe `=lockname retirer`<br>`membre` (membre, obligatoire) — Membre concerné
- `/lockname liste` — Affiche les pseudonymes protégés de ce serveur · préfixe `=lockname liste`

### /logs

Staff : journaux typés (recherche, chronologie) ; OWNER : configuration du hub  
Catégorie : Administration & sécurité · Utilisation : `/logs statut · rechercher · chronologie · hub · source-ajouter · source-activer · source-retirer · alertes · conservation · resume`

- `/logs statut` — Hub, serveurs sources, logs en attente et logs perdus · préfixe `=logs statut`
- `/logs rechercher` — Cherche dans la copie en base des journaux · préfixe `=logs rechercher`<br>`membre` (membre, facultatif) — Membre concerné (acteur ou cible)<br>`action` (texte, facultatif, 40 caractères max) — Code d'action (ban, warn, blr_set…)<br>`periode` (texte, facultatif, 10 caractères max) — Période : 1h, 7j, 30j…
- `/logs chronologie` — Chronologie d'un membre · préfixe `=logs chronologie`<br>`membre` (membre, obligatoire) — Membre
- `/logs hub` — OWNER : serveur qui reçoit les journaux · préfixe `=logs hub`<br>`serveur` (texte, obligatoire, 20 caractères max) — ID du serveur hub
- `/logs source-ajouter` — OWNER : ajoute un serveur source (un jeu de salons par source) · préfixe `=logs source-ajouter`<br>`serveur` (texte, obligatoire, 20 caractères max) — ID du serveur source<br>`nom` (texte, obligatoire, 12 caractères max) — Nom court (préfixe des salons, ex. mz)<br>`libelle` (texte, facultatif, 60 caractères max) — Libellé affiché
- `/logs source-activer` — OWNER : active ou coupe une source · préfixe `=logs source-activer`<br>`serveur` (texte, obligatoire, 20 caractères max) — ID du serveur source<br>`actif` (oui/non, obligatoire) — Activer ?
- `/logs source-retirer` — OWNER : retire un serveur source · préfixe `=logs source-retirer`<br>`serveur` (texte, obligatoire, 20 caractères max) — ID du serveur source
- `/logs alertes` — OWNER : rôle du hub prévenu pour les alertes graves (vide = aucun) · préfixe `=logs alertes`<br>`role` (texte, facultatif, 20 caractères max) — ID du rôle dans le hub
- `/logs conservation` — OWNER : durée de conservation de la copie en base · préfixe `=logs conservation`<br>`jours` (nombre entier, obligatoire) — 7 à 730 jours
- `/logs resume` — OWNER : résumé automatique des journaux · préfixe `=logs resume`<br>`frequence` (texte, obligatoire, choix : Quotidien, Hebdomadaire, Désactivé) — Fréquence

### /maj

OWNER : met à jour les 5 bots depuis GitHub, sans ordinateur  
Catégorie : SYS+ · Utilisation : `/maj lancer [version] · /maj etat`

- `/maj lancer` — Installe la dernière version publiée, ou une version précise (10 à 30 min) · préfixe `=maj lancer`<br>`version` (texte, facultatif, 20 caractères max) — Version précise pour revenir en arrière, ex. v1.2.0
- `/maj etat` — Avancement et journal de la dernière mise à jour · préfixe `=maj etat`

### /malus

SYS+ : malus temporaires sur un membre (perroquet, fantôme, mime, clown…)  
Catégorie : SYS+ · Utilisation : `/malus <type> membre [minutes] | stop membre [type] | liste`

- `/malus perroquet` — Ses messages deviennent moqueurs, à l'envers ou en majuscules · préfixe `=malus perroquet`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus fantome` — Ses messages disparaissent au bout de 5 s · préfixe `=malus fantome`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus mime` — Il ne peut écrire qu'en émojis · préfixe `=malus mime`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus clown` — Chacun de ses messages reçoit un 🤡 · préfixe `=malus clown`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus robot` — Ses messages deviennent BIP BOUP · préfixe `=malus robot`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus bebe` — Ses messages en langage bébé · préfixe `=malus bebe`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus yoda` — Ses mots dans le désordre, hmm · préfixe `=malus yoda`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus chuchote` — Ses messages en tout petits caractères · préfixe `=malus chuchote`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus sablier` — Un seul message par minute · préfixe `=malus sablier`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus malediction` — 1 message sur 5 remplacé par une phrase gênante · préfixe `=malus malediction`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus sourdine-folle` — En vocal, son micro coupé et rendu au hasard (5 min au plus) · préfixe `=malus sourdine-folle`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus exil` — Renvoyé dans le salon AFK à chaque connexion vocale · préfixe `=malus exil`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus bouffon` — Rôle « Bouffon du serveur » affiché à part (aucune permission) · préfixe `=malus bouffon`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus roulette-vocale` — Un membre de ton salon vocal, tiré au sort, est rendu muet 1 min · préfixe `=malus roulette-vocale`
- `/malus patate` — Patate chaude : à passer en mentionnant quelqu'un en 30 s · préfixe `=malus patate`<br>`membre` (membre, obligatoire) — Premier à recevoir la patate
- `/malus tribunal` — Vote public de 60 s : coupable ou innocent · préfixe `=malus tribunal`<br>`membre` (membre, obligatoire) — Accusé
- `/malus interrogatoire` — 3 questions, 30 s pour répondre à chacune · préfixe `=malus interrogatoire`<br>`membre` (membre, obligatoire) — Membre interrogé
- `/malus taxe` — 30 % de ses gains de PND vont au SYS+ · préfixe `=malus taxe`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus rancon` — Muet jusqu'à ce que quelqu'un paie la rançon · préfixe `=malus rancon`<br>`membre` (membre, obligatoire) — Membre pris en otage<br>`montant` (nombre entier, obligatoire) — Rançon en PND (10 à 100 000)<br>`minutes` (nombre entier, facultatif) — Durée maximale (1 à 60 min, 10 par défaut)
- `/malus cible` — Chaque membre qui le mentionne gagne 25 PND · préfixe `=malus cible`<br>`membre` (membre, obligatoire) — Membre visé<br>`minutes` (nombre entier, facultatif) — Durée (1 à 60 min, 10 par défaut)
- `/malus payer-rancon` — Paie la rançon d'un membre pour le libérer · préfixe `=malus payer-rancon`<br>`membre` (membre, obligatoire) — Otage à libérer
- `/malus stop` — Lève les malus d'un membre · préfixe `=malus stop`<br>`membre` (membre, obligatoire) — Membre<br>`type` (texte, facultatif, choix : perroquet, fantome, mime, clown, robot, bebe, yoda, chuchote, sablier, malediction, sourdine-folle, exil, bouffon, taxe, rancon, cible) — Un seul malus (vide = tous)
- `/malus liste` — Malus actifs sur le serveur · préfixe `=malus liste`

### /membredumois

Vote pour le membre du mois : rôle pendant 30 jours et prime en PND  
Catégorie : Communauté · Utilisation : `/membredumois voter membre · classement · configurer [role] [salon] [prime]`

- `/membredumois voter` — Vote (une fois par mois, modifiable) pour un membre · préfixe `=membredumois voter`<br>`membre` (membre, obligatoire) — Ton choix
- `/membredumois classement` — Votes du mois en cours · préfixe `=membredumois classement`
- `/membredumois configurer` — Admins : rôle du gagnant, salon d'annonce, prime · préfixe `=membredumois configurer`<br>`role` (rôle, facultatif) — Rôle donné pendant 30 jours<br>`salon` (salon, facultatif) — Salon de l'annonce<br>`prime` (nombre entier, facultatif) — Prime en PND (0 à 100 000)

### /menotte

Immobilise un membre dans ton salon vocal avec durée facultative  
Catégorie : Vocal & DOG · Utilisation : `/menotte membre [duree_minutes]`

- `membre` (membre, obligatoire) — Membre à menotter
- `duree_minutes` (nombre entier, facultatif) — Durée en minutes (1 à 30 jours)

### /menotteinfo

Consulte l’état et l’échéance d’une MENOTTE  
Catégorie : Vocal & DOG · Utilisation : `/menotteinfo membre`

- `membre` (membre, obligatoire) — Membre à consulter

### /moi

Ton profil complet : niveau, argent, casino, confiance et casier  
Catégorie : Communauté · Utilisation : `/moi [membre]`

- `membre` (membre, facultatif) — Voir le profil d'un autre membre

### /niveau

Niveaux et XP : ton niveau, le classement, les récompenses  
Catégorie : Social · Utilisation : `/niveau voir [membre] | succes [membre] | classement | recompenses | salon | recompense-ajouter | recompense-retirer | activer | desactiver`

- `/niveau voir` — Affiche un niveau · préfixe `=niveau voir`<br>`membre` (membre, facultatif) — Membre (toi par défaut)
- `/niveau classement` — Top 10 des niveaux du serveur · préfixe `=niveau classement`
- `/niveau succes` — Succès débloqués et à débloquer · préfixe `=niveau succes`<br>`membre` (membre, facultatif) — Membre (toi par défaut)
- `/niveau recompenses` — Liste les rôles débloqués par niveau · préfixe `=niveau recompenses`
- `/niveau salon` — Staff : salon d'annonce des passages de niveau (vide = salon du message) · préfixe `=niveau salon`<br>`salon` (salon, facultatif) — Salon
- `/niveau recompense-ajouter` — Staff : donne un rôle à un niveau · préfixe `=niveau recompense-ajouter`<br>`niveau` (nombre entier, obligatoire) — Niveau<br>`role` (rôle, obligatoire) — Rôle
- `/niveau recompense-retirer` — Staff : retire la récompense d'un niveau · préfixe `=niveau recompense-retirer`<br>`niveau` (nombre entier, obligatoire) — Niveau
- `/niveau activer` — Staff : active les niveaux · préfixe `=niveau activer`
- `/niveau desactiver` — Staff : désactive les niveaux (l'XP est gardée) · préfixe `=niveau desactiver`

### /outils

Outils staff : message collé en bas d'un salon et modmail (MP au staff)  
Catégorie : Administration & sécurité · Utilisation : `/outils sticky definir|retirer|liste · /outils modmail config|etat|repondre|fermer|bloquer|debloquer|desactiver`

- `/outils sticky definir` — Colle un message en bas d'un salon (remplace l'ancien) · préfixe `=outils sticky definir`<br>`salon` (salon, obligatoire) — Salon<br>`texte` (texte, obligatoire, 1500 caractères max) — Texte du message (\n pour aller à la ligne)
- `/outils sticky retirer` — Retire le message collé d'un salon · préfixe `=outils sticky retirer`<br>`salon` (salon, obligatoire) — Salon
- `/outils sticky liste` — Les messages collés du serveur · préfixe `=outils sticky liste`
- `/outils modmail repondre` — Dans un fil modmail : envoie une réponse en MP au membre · préfixe `=outils modmail repondre`<br>`message` (texte, obligatoire, 1800 caractères max) — Ta réponse<br>`anonyme` (oui/non, facultatif) — Signer « Staff du serveur » au lieu de ton nom (réglage du serveur par défaut)
- `/outils modmail fermer` — Dans un fil modmail : ferme la conversation · préfixe `=outils modmail fermer`<br>`raison` (texte, facultatif, 300 caractères max) — Raison montrée au membre
- `/outils modmail config` — Staff : salon privé où arrivent les conversations · préfixe `=outils modmail config`<br>`salon` (salon, obligatoire) — Salon réservé au staff<br>`anonyme` (oui/non, facultatif) — Réponses signées « Staff du serveur » (oui par défaut)
- `/outils modmail etat` — Le modmail est-il activé ? · préfixe `=outils modmail etat`
- `/outils modmail bloquer` — Staff : empêche un membre d'écrire au staff · préfixe `=outils modmail bloquer`<br>`membre` (membre, obligatoire) — Membre
- `/outils modmail debloquer` — Staff : autorise de nouveau un membre · préfixe `=outils modmail debloquer`<br>`membre` (membre, obligatoire) — Membre
- `/outils modmail desactiver` — Staff : arrête le modmail · préfixe `=outils modmail desactiver`

### /panel

Ouvre le centre de contrôle  
Catégorie : Général · Utilisation : `/panel`

### /pndevent

Gère les événements de la communauté PND  
Catégorie : Jeux & événements · Utilisation : `/pndevent liste | creer | join | leave | cancel`

- `/pndevent liste` — Liste les prochains événements · préfixe `=pndevent liste`
- `/pndevent creer` — Crée un événement · préfixe `=pndevent creer`<br>`date` (texte, obligatoire, 40 caractères max) — Date ISO avec fuseau, ex. 2026-12-01T20:00:00+01:00<br>`titre` (texte, obligatoire, 100 caractères max) — Titre<br>`description` (texte, facultatif, 1000 caractères max) — Description
- `/pndevent join` — Inscris-toi à un événement · préfixe `=pndevent join`<br>`id` (nombre entier, obligatoire) — Numéro de l’événement
- `/pndevent leave` — Désinscris-toi d’un événement · préfixe `=pndevent leave`<br>`id` (nombre entier, obligatoire) — Numéro de l’événement
- `/pndevent cancel` — Annule un événement (organisateur ou staff) · préfixe `=pndevent cancel`<br>`id` (nombre entier, obligatoire) — Numéro de l’événement

### /pourquoi

Explique pourquoi une commande t'est refusée ou permise  
Catégorie : Général · Utilisation : `/pourquoi commande`

- `commande` (texte, obligatoire, 60 caractères max) — Commande (ex. ban, rank, blr poser)

### /presence

OWNER/admins : statut d'un bot sans modifier de fichier, ou sa description  
Catégorie : Administration & sécurité · Utilisation : `/presence definir bot texte [type] [statut] [duree] · retirer bot · description bot texte`

- `/presence definir` — Impose un statut (prioritaire sur la rotation) · préfixe `=presence definir`<br>`bot` (texte, obligatoire, choix : Bot principal, GUARD, FDPDLAVOC, SUCK ME, LE FISC, Invest +) — Bot<br>`texte` (texte, obligatoire, 120 caractères max) — Texte affiché (120 caractères)<br>`type` (texte, facultatif, choix : Statut personnalisé, Joue à, Regarde, Écoute, Participe à) — Type d'activité<br>`statut` (texte, facultatif, choix : En ligne, Absent, Ne pas déranger) — Pastille<br>`duree` (texte, facultatif, 10 caractères max) — Durée : 30m, 2h, 1j (vide = jusqu'au retrait)
- `/presence retirer` — Rétablit le statut automatique · préfixe `=presence retirer`<br>`bot` (texte, obligatoire, choix : Bot principal, GUARD, FDPDLAVOC, SUCK ME, LE FISC, Invest +) — Bot
- `/presence description` — Texte « À propos » du bot · préfixe `=presence description`<br>`bot` (texte, obligatoire, choix : Bot principal, GUARD, FDPDLAVOC, SUCK ME, LE FISC, Invest +) — Bot<br>`texte` (texte, obligatoire, 400 caractères max) — Description (400 caractères)

### /profil

Affiche le profil social d’un membre  
Catégorie : Social & cartes · Utilisation : `/profil [membre]`

- `membre` (membre, facultatif) — Membre dont afficher le profil

### /pseudo

SUCK ME : change ou réinitialise le pseudo d'un membre  
Catégorie : SYS+ · Utilisation : `/pseudo changer membre nom · reset membre`

- `/pseudo changer` — Change le pseudo · préfixe `=pseudo changer`<br>`membre` (membre, obligatoire) — Membre<br>`nom` (texte, obligatoire, 32 caractères max) — Nouveau pseudo
- `/pseudo reset` — Remet le pseudo d'origine · préfixe `=pseudo reset`<br>`membre` (membre, obligatoire) — Membre

### /quete

Tes trois quêtes du jour et leurs récompenses  
Catégorie : Communauté · Utilisation : `/quete`

### /radar

Consulte les statistiques PND agrégées (staff)  
Catégorie : Social & cartes · Utilisation : `/radar [du] [au]`

- `du` (texte, facultatif, 10 caractères max) — Date de début AAAA-MM-JJ
- `au` (texte, facultatif, 10 caractères max) — Date de fin AAAA-MM-JJ

### /rank

Attribue un rôle à un membre (SYS+ / ADMIN+)  
Catégorie : SYS+ · Utilisation : `/rank membre rôle`

- `membre` (membre, obligatoire) — Membre à promouvoir
- `role` (rôle, obligatoire) — Rôle à attribuer

### /rankall

Attribue un rôle à tous les membres éligibles (propriétaires du bot uniquement)  
Catégorie : Administration & sécurité · Utilisation : `/rankall role`

- `role` (rôle, obligatoire) — Rôle à attribuer à tous les membres éligibles

### /rappel

Programme un rappel  
Catégorie : Utilitaires · Utilisation : `/rappel creer dans message · liste · supprimer`

- `/rappel creer` — Crée un rappel · préfixe `=rappel creer`<br>`dans` (texte, obligatoire, 20 caractères max) — Délai : 10m, 2h, 1j12h…<br>`message` (texte, obligatoire, 500 caractères max) — Texte du rappel
- `/rappel liste` — Tes rappels en cours · préfixe `=rappel liste`
- `/rappel supprimer` — Supprime un rappel · préfixe `=rappel supprimer`<br>`id` (nombre entier, obligatoire) — Numéro du rappel

### /rapportstaff

SUCK ME : rapport du staff chaque lundi et alerte après 14 jours d'inactivité  
Catégorie : SYS+ · Utilisation : `/rapportstaff etat · configurer salon · desactiver`

- `/rapportstaff etat` — Réglages actuels · préfixe `=rapportstaff etat`
- `/rapportstaff configurer` — Choisis le salon (réservé au staff) du rapport et des alertes · préfixe `=rapportstaff configurer`<br>`salon` (salon, obligatoire) — Salon du rapport
- `/rapportstaff desactiver` — Coupe le rapport et les alertes · préfixe `=rapportstaff desactiver`

### /removerole

Retire un rôle à un membre (SYS+ / ADMIN+)  
Catégorie : SYS+ · Utilisation : `/removerole membre rôle`

- `membre` (membre, obligatoire) — Membre à modifier
- `role` (rôle, obligatoire) — Rôle à retirer

### /rep

Réputation : donner un point ou voir l’historique  
Catégorie : Social & cartes · Utilisation : `/rep donner membre [raison] · /rep historique [membre]`

- `/rep donner` — Donne un point de réputation à un membre · préfixe `=rep donner`<br>`membre` (membre, obligatoire) — Membre à récompenser<br>`raison` (texte, facultatif, 200 caractères max) — Raison (facultative)
- `/rep historique` — Historique des points de réputation · préfixe `=rep historique`<br>`membre` (membre, facultatif) — Membre concerné (toi par défaut)

### /rolepanel

Panneau SYS+ de rôles personnalisés et gestion des rôles membres  
Catégorie : SYS+ · Utilisation : `/rolepanel panel | espace | membre | create | rename | color | delete | list | manage`

- `/rolepanel panel` — Ouvre le panneau interactif des rôles personnalisés · préfixe `=rolepanel panel`
- `/rolepanel espace` — Publie ici le panneau « Rôles personnels — Espace membres » · préfixe `=rolepanel espace`<br>`eligible1` (rôle, facultatif) — Rôle autorisé à créer son rôle perso (vide = création par le staff seulement)<br>`eligible2` (rôle, facultatif) — Autre rôle autorisé<br>`eligible3` (rôle, facultatif) — Autre rôle autorisé
- `/rolepanel membre` — Crée ou modifie le rôle perso d'un membre (nom, couleur) · préfixe `=rolepanel membre`<br>`membre` (membre, obligatoire) — Membre concerné
- `/rolepanel manage` — Ouvre l'ancien panneau d'attribution de rôles aux membres · préfixe `=rolepanel manage`
- `/rolepanel create` — Crée un rôle sans permissions Discord · préfixe `=rolepanel create`<br>`nom` (texte, obligatoire, 32 caractères max) — Nom (2 à 32 caractères)<br>`couleur` (texte, obligatoire, 7 caractères max) — Couleur hexadécimale #RRGGBB
- `/rolepanel rename` — Renomme un rôle personnalisé · préfixe `=rolepanel rename`<br>`role` (rôle, obligatoire) — Rôle personnalisé<br>`nom` (texte, obligatoire, 32 caractères max) — Nouveau nom (2 à 32 caractères)
- `/rolepanel color` — Change la couleur d'un rôle personnalisé · préfixe `=rolepanel color`<br>`role` (rôle, obligatoire) — Rôle personnalisé<br>`couleur` (texte, obligatoire, 7 caractères max) — Couleur hexadécimale #RRGGBB
- `/rolepanel delete` — Supprime un rôle personnalisé · préfixe `=rolepanel delete`<br>`role` (rôle, obligatoire) — Rôle personnalisé<br>`confirmer` (oui/non, obligatoire) — Confirmer explicitement la suppression
- `/rolepanel list` — Liste les rôles personnalisés du serveur · préfixe `=rolepanel list`

### /roletemp

SUCK ME : donne un rôle pour une durée, retiré tout seul à la fin  
Catégorie : SYS+ · Utilisation : `/roletemp donner membre role duree · retirer · liste`

- `/roletemp donner` — Donne un rôle temporaire · préfixe `=roletemp donner`<br>`membre` (membre, obligatoire) — Membre<br>`role` (rôle, obligatoire) — Rôle<br>`duree` (texte, obligatoire, 20 caractères max) — Durée : 30m, 12h, 7j…
- `/roletemp retirer` — Retire un rôle temporaire · préfixe `=roletemp retirer`<br>`membre` (membre, obligatoire) — Membre<br>`role` (rôle, obligatoire) — Rôle
- `/roletemp liste` — Rôles temporaires en cours · préfixe `=roletemp liste`

### /saison

Saison en cours, classements et palmarès  
Catégorie : Communauté · Utilisation : `/saison etat | palmares | demarrer | cloturer`

- `/saison etat` — Saison en cours et classement des clans · préfixe `=saison etat`
- `/saison palmares` — Palmarès des saisons passées · préfixe `=saison palmares`<br>`tableau` (texte, facultatif, choix : Clans, Membres, Casino) — Tableau à consulter
- `/saison demarrer` — Lance une saison (staff) · préfixe `=saison demarrer`<br>`nom` (texte, facultatif, 40 caractères max) — Nom de la saison<br>`semaines` (nombre entier, facultatif) — Durée en semaines (13 par défaut)
- `/saison cloturer` — Clôture la saison et inscrit les podiums (staff) · préfixe `=saison cloturer`

### /setup

Configure les modules du serveur avec aperçu avant application  
Catégorie : Général · Utilisation : `/setup`

### /smash

Smash or pass entre membres inscrits (majeurs, votes anonymes)  
Catégorie : Communauté · Utilisation : `/smash inscrire majeur · jouer · score · desinscrire · retirer membre · retablir membre`

- `/smash inscrire` — Participer (réservé aux personnes majeures) · préfixe `=smash inscrire`<br>`majeur` (oui/non, obligatoire) — Je confirme avoir 18 ans ou plus
- `/smash jouer` — Noter des profils (votes anonymes) · préfixe `=smash jouer`
- `/smash score` — Ton score (compteurs seulement) · préfixe `=smash score`
- `/smash desinscrire` — Quitter le jeu : profil et votes effacés · préfixe `=smash desinscrire`
- `/smash retirer` — Staff : retirer un profil · préfixe `=smash retirer`<br>`membre` (membre, obligatoire) — Membre
- `/smash retablir` — Staff : rétablir un profil suspendu après signalements · préfixe `=smash retablir`<br>`membre` (membre, obligatoire) — Membre

### /sondage

Crée un sondage dans ce salon  
Catégorie : Général · Utilisation : `/sondage question option1 option2 …`

- `question` (texte, obligatoire, 300 caractères max) — La question du sondage
- `option_1` (texte, obligatoire, 55 caractères max) — Premier choix
- `option_2` (texte, obligatoire, 55 caractères max) — Deuxième choix
- `option_3` (texte, facultatif, 55 caractères max) — Troisième choix (facultatif)
- `option_4` (texte, facultatif, 55 caractères max) — Quatrième choix (facultatif)
- `option_5` (texte, facultatif, 55 caractères max) — Cinquième choix (facultatif)

### /stabilite

OWNER/admins : couper une commande ou mettre un bot en maintenance ; OWNER : maintenance globale  
Catégorie : Administration & sécurité · Utilisation : `/stabilite commande-off commande [raison] · commande-on commande · maintenance-on bot [raison] · maintenance-off bot · maintenance-global-on|off [salon] · etat`

- `/stabilite commande-off` — Coupe une commande sur les 6 bots sans redémarrer · préfixe `=stabilite commande-off`<br>`commande` (texte, obligatoire, 32 caractères max) — Nom de la commande<br>`raison` (texte, facultatif, 200 caractères max) — Raison affichée
- `/stabilite commande-on` — Rétablit une commande · préfixe `=stabilite commande-on`<br>`commande` (texte, obligatoire, 32 caractères max) — Nom de la commande
- `/stabilite maintenance-on` — Met un bot en maintenance (message clair aux membres) · préfixe `=stabilite maintenance-on`<br>`bot` (texte, obligatoire, choix : Bot principal, GUARD, FDPDLAVOC, SUCK ME, LE FISC, Invest +) — Bot<br>`raison` (texte, facultatif, 200 caractères max) — Message
- `/stabilite maintenance-off` — Termine la maintenance d'un bot · préfixe `=stabilite maintenance-off`<br>`bot` (texte, obligatoire, choix : Bot principal, GUARD, FDPDLAVOC, SUCK ME, LE FISC, Invest +) — Bot
- `/stabilite maintenance-global-on` — OWNER : suspend les commandes sur tous les bots · préfixe `=stabilite maintenance-global-on`<br>`raison` (texte, facultatif, 200 caractères max) — Message affiché aux membres<br>`salon` (salon, facultatif) — Salon où publier l'annonce de maintenance
- `/stabilite maintenance-global-off` — OWNER : rétablit les commandes sur tous les bots · préfixe `=stabilite maintenance-global-off`<br>`salon` (salon, facultatif) — Salon où publier l'annonce de fin de maintenance
- `/stabilite etat` — Commandes coupées et maintenance · préfixe `=stabilite etat`

### /staff

SUCK ME : échelle, promotions, absences, disponibilités, astreintes, planning, passation  
Catégorie : SYS+ · Utilisation : `/staff centre · liste · echelle · promouvoir · retrograder · absence · retour · dispo · astreinte · disponibles · planning · passation · intervention · mission · reunion · formation`

- `/staff liste` — Le staff par rang, avec les absences · préfixe `=staff liste`
- `/staff echelle` — Définit l'échelle des rôles du staff (du plus bas au plus haut) · préfixe `=staff echelle`<br>`role1` (rôle, obligatoire) — Rôle<br>`role2` (rôle, facultatif) — Rôle<br>`role3` (rôle, facultatif) — Rôle<br>`role4` (rôle, facultatif) — Rôle<br>`role5` (rôle, facultatif) — Rôle<br>`role6` (rôle, facultatif) — Rôle
- `/staff promouvoir` — Fait monter un membre d'un rang · préfixe `=staff promouvoir`<br>`membre` (membre, obligatoire) — Membre
- `/staff retrograder` — Fait descendre un membre d'un rang · préfixe `=staff retrograder`<br>`membre` (membre, obligatoire) — Membre
- `/staff absence` — Déclare ton absence · préfixe `=staff absence`<br>`raison` (texte, facultatif, 200 caractères max) — Raison<br>`duree` (texte, facultatif, 20 caractères max) — Durée : 3j, 1j12h…
- `/staff retour` — Met fin à ton absence · préfixe `=staff retour`
- `/staff dispo` — Tes créneaux habituels (heure de Paris), ex. lun-ven 18-23, sam 14-2 · préfixe `=staff dispo`<br>`creneaux` (texte, facultatif, 200 caractères max) — Ex. « lun-ven 18-23, sam 14-2 » ; « aucun » pour effacer ; vide pour voir
- `/staff astreinte` — Prendre, terminer ou voir les astreintes (aucun rôle donné) · préfixe `=staff astreinte`<br>`action` (texte, facultatif, choix : Prendre, Terminer, Voir) — Action<br>`duree` (texte, facultatif, 20 caractères max) — Durée si tu prends : 4h, 12h, 1j (12 h par défaut, 7 j maximum)
- `/staff disponibles` — Staff joignable maintenant : astreinte, créneaux, absences · préfixe `=staff disponibles`
- `/staff centre` — Centre de commandement : staff joignable, dossiers, tickets, alertes, bots · préfixe `=staff centre`
- `/staff planning` — Couverture de la semaine par tranche horaire, et les trous · préfixe `=staff planning`
- `/staff passation` — Laisse une note de relève à l'équipe suivante, ou lis les dernières · préfixe `=staff passation`<br>`note` (texte, facultatif, 1500 caractères max) — Ce que l'équipe suivante doit savoir (vide pour lire)
- `/staff intervention ouvrir` — Ouvre un dossier d'intervention · préfixe `=staff intervention ouvrir`<br>`titre` (texte, obligatoire, 120 caractères max) — De quoi s'agit-il ?<br>`membre` (membre, facultatif) — Membre concerné<br>`priorite` (texte, facultatif, choix : Basse, Normale, Haute) — Priorité (haute = clôture validée par un autre responsable)
- `/staff intervention liste` — Dossiers en cours, à valider ou clos · préfixe `=staff intervention liste`<br>`statut` (texte, facultatif, choix : En cours, À valider, Clos, Tous) — Lesquels
- `/staff intervention voir` — Affiche un dossier et son historique · préfixe `=staff intervention voir`<br>`numero` (nombre entier, obligatoire) — Numéro du dossier
- `/staff intervention assigner` — Confie le dossier à un membre du staff · préfixe `=staff intervention assigner`<br>`numero` (nombre entier, obligatoire) — Numéro du dossier<br>`membre` (membre, obligatoire) — Membre du staff
- `/staff intervention preuve` — Ajoute une preuve (lien https, message du serveur) ou une référence (sanction:12) · préfixe `=staff intervention preuve`<br>`numero` (nombre entier, obligatoire) — Numéro du dossier<br>`lien` (texte, obligatoire, 400 caractères max) — Lien ou référence
- `/staff intervention note` — Ajoute une note d'enquête · préfixe `=staff intervention note`<br>`numero` (nombre entier, obligatoire) — Numéro du dossier<br>`texte` (texte, obligatoire, 500 caractères max) — Note
- `/staff intervention cloturer` — Clôt le dossier avec sa conclusion · préfixe `=staff intervention cloturer`<br>`numero` (nombre entier, obligatoire) — Numéro du dossier<br>`conclusion` (texte, obligatoire, 500 caractères max) — Ce qui a été fait
- `/staff intervention valider` — Valide la clôture d'un dossier prioritaire (autre responsable) · préfixe `=staff intervention valider`<br>`numero` (nombre entier, obligatoire) — Numéro du dossier
- `/staff mission creer` — SYS+ : crée une mission (un membre du staff ou tout le staff) · préfixe `=staff mission creer`<br>`titre` (texte, obligatoire, 150 caractères max) — La mission<br>`membre` (membre, facultatif) — Membre du staff (vide = tout le staff)<br>`echeance` (texte, facultatif, 30 caractères max) — Échéance (heure de Paris) : 28/11 21h, demain 20h
- `/staff mission liste` — Missions en cours · préfixe `=staff mission liste`
- `/staff mission terminer` — Termine une mission avec son bilan · préfixe `=staff mission terminer`<br>`numero` (nombre entier, obligatoire) — Numéro de la mission<br>`bilan` (texte, obligatoire, 500 caractères max) — Ce qui a été fait
- `/staff mission annuler` — SYS+ : annule une mission · préfixe `=staff mission annuler`<br>`numero` (nombre entier, obligatoire) — Numéro de la mission
- `/staff reunion planifier` — SYS+ : planifie une réunion (rappel 30 min avant dans ce salon) · préfixe `=staff reunion planifier`<br>`sujet` (texte, obligatoire, 150 caractères max) — Sujet<br>`date` (texte, obligatoire, 30 caractères max) — Date et heure de Paris : 28/11 21h, demain 20h30
- `/staff reunion liste` — Réunions à venir et derniers comptes rendus · préfixe `=staff reunion liste`
- `/staff reunion compte-rendu` — Ajoute le compte rendu d'une réunion · préfixe `=staff reunion compte-rendu`<br>`numero` (nombre entier, obligatoire) — Numéro de la réunion<br>`texte` (texte, obligatoire, 1500 caractères max) — Compte rendu
- `/staff reunion annuler` — Annule une réunion · préfixe `=staff reunion annuler`<br>`numero` (nombre entier, obligatoire) — Numéro de la réunion
- `/staff formation exercice` — Lance un cas pratique (raid, conflit, signalement) · préfixe `=staff formation exercice`<br>`type` (texte, facultatif, choix : Raid, Conflit entre membres, Signalement sensible) — Exercice<br>`membre` (membre, facultatif) — Stagiaire (SYS+ ; vide = toi)
- `/staff formation reponse` — Réponds à un exercice · préfixe `=staff formation reponse`<br>`id` (texte, obligatoire, 12 caractères max) — Identifiant de l'exercice<br>`reponses` (texte, obligatoire, 30 caractères max) — Tes lettres, ex. B,A,C,B
- `/staff formation valider` — SYS+ : certifie un parcours Academy terminé (aucun rôle donné) · préfixe `=staff formation valider`<br>`membre` (membre, obligatoire) — Membre<br>`parcours` (texte, obligatoire, 40 caractères max) — Identifiant du parcours (/academy liste)
- `/staff formation certifications` — Parcours certifiés et exercices d'un membre · préfixe `=staff formation certifications`<br>`membre` (membre, facultatif) — Membre (vide = toi)

### /staffhistory

Consulte l'historique de modération et de présence d'un membre  
Catégorie : SYS+ · Utilisation : `/staffhistory membre`

- `membre` (membre, obligatoire) — Membre concerné

### /stats

Statistiques du serveur  
Catégorie : Utilitaires · Utilisation : `/stats serveur`

- `/stats serveur` — Membres, salons, vocal, top niveaux · préfixe `=stats serveur`

### /story

Propose et publie des stories communautaires  
Catégorie : Social & cartes · Utilisation : `/story liste | creer | approve | publish`

- `/story liste` — Liste les stories publiées · préfixe `=story liste`
- `/story creer` — Propose une story · préfixe `=story creer`<br>`titre` (texte, obligatoire, 100 caractères max) — Titre<br>`texte` (texte, obligatoire, 1500 caractères max) — Texte
- `/story approve` — Valide une story (staff) · préfixe `=story approve`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de story
- `/story publish` — Publie une story validée (staff) · préfixe `=story publish`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de story

### /suggestion

Propose une idée au serveur, votée par les membres  
Catégorie : Social · Utilisation : `/suggestion proposer texte · /suggestion salon · /suggestion repondre`

- `/suggestion proposer` — Propose une suggestion · préfixe `=suggestion proposer`<br>`texte` (texte, obligatoire, 1500 caractères max) — Ton idée
- `/suggestion salon` — Staff : salon des suggestions · préfixe `=suggestion salon`<br>`salon` (salon, obligatoire) — Salon
- `/suggestion repondre` — Staff : accepte ou refuse une suggestion · préfixe `=suggestion repondre`<br>`id` (nombre entier, obligatoire) — Numéro de la suggestion<br>`decision` (texte, obligatoire, choix : Accepter, Refuser) — Décision<br>`raison` (texte, facultatif, 500 caractères max) — Réponse (facultatif)

### /sysp

Gestion du système SYS+  
Catégorie : SYS+ · Utilisation : `/sysp panel|audit|role|add|remove|permissions|whitelist-*|supervisor-*|diagnostic acl|sante|logs-couverture|matrice|economie|bots|installation`

- `/sysp panel` — Ouvre le centre de contrôle SYS+ · préfixe `=sysp panel`
- `/sysp audit` — Affiche les dernières actions staff (filtre par membre ou action) · préfixe `=sysp audit`<br>`membre` (membre, facultatif) — Actions faites par ce membre ou le visant<br>`action` (texte, facultatif, 60 caractères max) — Début du nom d’action, ex. whitelist, adminplus
- `/sysp add` — Attribue le rôle SYS+ à un membre (propriétaire) · préfixe `=sysp add`<br>`membre` (membre, obligatoire) — Membre concerné<br>`duree` (texte, facultatif, 20 caractères max) — Durée du SYS+ : 12h, 7j… (retrait automatique)<br>`essai` (oui/non, facultatif) — Période d'essai de 14 jours (confirmation de l'owner requise)<br>`simuler` (oui/non, facultatif) — Simuler : vérifie la demande sans rien modifier
- `/sysp annuler` — Annule ta dernière attribution de SYS+ (dans l'heure) · préfixe `=sysp annuler`
- `/sysp remove` — Retire le rôle SYS+ à un membre (propriétaire) · préfixe `=sysp remove`<br>`membre` (membre, obligatoire) — Membre concerné
- `/sysp permissions` — Consulte les scopes ADMIN+ · préfixe `=sysp permissions`
- `/sysp permissions-edit` — Modifie un scope ADMIN+ · préfixe `=sysp permissions-edit`<br>`module` (texte, obligatoire, choix : Gestion des rôles, Administration vocale et MENOTTE, LOCKNAME, Gestion du support) — Module à configurer<br>`autorise` (oui/non, obligatoire) — Autoriser ADMIN+ sur ce module
- `/sysp incident` — Centre de gestion des incidents SYS+ · préfixe `=sysp incident`<br>`action` (texte, obligatoire, choix : Créer, Lister, Consulter, Assigner, Résoudre, Changer le statut, Rapport (Markdown)) — Opération<br>`titre` (texte, facultatif, 100 caractères max) — Titre (création)<br>`resume` (texte, facultatif, 1500 caractères max) — Résumé (création)<br>`gravite` (texte, facultatif, choix : Faible, Moyenne, Élevée, Critique) — Gravité (création)<br>`id` (texte, facultatif, 36 caractères max) — Identifiant incident (action)<br>`membre` (membre, facultatif) — Responsable (assignation)<br>`resolution` (texte, facultatif, 1500 caractères max) — Résolution (fermeture)<br>`statut` (texte, facultatif, choix : Ouvert, En cours) — Statut
- `/sysp config role` — Configure le rôle Perm SYS+ · préfixe `=sysp config role`<br>`role` (rôle, obligatoire) — Rôle à attribuer comme Perm SYS+
- `/sysp config admin-role` — Configure le rôle ADMIN+ (permissions administratives limitées) · préfixe `=sysp config admin-role`<br>`role` (rôle, obligatoire) — Rôle à attribuer comme ADMIN+
- `/sysp config whitelist-role` — Configure le rôle exact WHITELIST (propriétaire uniquement) · préfixe `=sysp config whitelist-role`<br>`role` (rôle, obligatoire) — Rôle nommé WHITELIST
- `/sysp config intelligence-channel` — Configure le salon réservé à PND Intelligence · préfixe `=sysp config intelligence-channel`<br>`salon` (salon, obligatoire) — Salon texte réservé à PND Intelligence
- `/sysp config intelligence-toggle` — Active ou désactive PND Intelligence · préfixe `=sysp config intelligence-toggle`<br>`etat` (oui/non, obligatoire) — Vrai = actif, faux = désactivé
- `/sysp staff supervisor-set` — Assigne un responsable direct à un membre du staff · préfixe `=sysp staff supervisor-set`<br>`membre` (membre, obligatoire) — Modérateur ou membre du staff<br>`responsable` (membre, obligatoire) — Chef ou superviseur en charge
- `/sysp staff supervisor-remove` — Retire le responsable direct d'un membre du staff · préfixe `=sysp staff supervisor-remove`<br>`membre` (membre, obligatoire) — Modérateur ou membre du staff
- `/sysp staff supervisor-list` — Affiche la hiérarchie des responsables configurés · préfixe `=sysp staff supervisor-list`
- `/sysp whitelist whitelist-add` — Attribue WHITELIST (propriétaire) · préfixe `=sysp whitelist whitelist-add`<br>`membre` (membre, obligatoire) — Membre concerné
- `/sysp whitelist whitelist-remove` — Retire WHITELIST (propriétaire) · préfixe `=sysp whitelist whitelist-remove`<br>`membre` (membre, obligatoire) — Membre concerné
- `/sysp whitelist whitelist-list` — Liste les membres WHITELIST (propriétaire) · préfixe `=sysp whitelist whitelist-list`
- `/sysp outils ghost` — Ghost Mode : consultation staff privée et non intrusive · préfixe `=sysp outils ghost`
- `/sysp outils composer` — Command Composer : gérer les procédures staff réutilisables · préfixe `=sysp outils composer`<br>`action` (texte, obligatoire, choix : Créer, Lister, Consulter, Supprimer) — Opération<br>`nom` (texte, facultatif, 40 caractères max) — Nom du runbook<br>`description` (texte, facultatif, 180 caractères max) — Description<br>`contenu` (texte, facultatif, 6000 caractères max) — Procédure documentée
- `/sysp outils search` — Smart Search : recherche dans les données SYS+ du serveur · préfixe `=sysp outils search`<br>`requete` (texte, obligatoire, 120 caractères max) — Termes à rechercher
- `/sysp outils blueprint` — Time Machine : sauvegarde ou compare la structure du serveur · préfixe `=sysp outils blueprint`<br>`action` (texte, obligatoire, choix : Créer une sauvegarde, Lister les sauvegardes, Comparer avec le serveur actuel, Exporter en JSON) — Opération<br>`nom` (texte, facultatif, 80 caractères max) — Nom de la sauvegarde (pour créer)<br>`id` (texte, facultatif, 36 caractères max) — Identifiant de sauvegarde (pour comparer)
- `/sysp outils clone` — Server Clone : aperçu ou restauration additive d'un blueprint · préfixe `=sysp outils clone`<br>`action` (texte, obligatoire, choix : Aperçu (plan), Appliquer (apply)) — Aperçu (plan) ou application (apply)<br>`blueprint` (texte, obligatoire) — Identifiant du blueprint (au moins 4 caractères)<br>`jeton` (texte, facultatif) — Jeton du plan (obligatoire pour apply)
- `/sysp outils studio` — Creator Studio : annonces, stories, événements, validation et planification · préfixe `=sysp outils studio`<br>`action` (texte, obligatoire, choix : create, edit, submit, approve, reject, schedule, cancel, publish, preview, list, fav, history, template-save, template-use, templates) — Action à effectuer<br>`type` (texte, facultatif, choix : Annonce, Story, Événement) — Type de publication (création)<br>`id` (texte, facultatif, 36 caractères max) — Identifiant du brouillon (au moins 4 caractères)<br>`titre` (texte, facultatif, 256 caractères max) — Titre (2 à 256 caractères)<br>`contenu` (texte, facultatif, 4000 caractères max) — Contenu (4000 caractères max)<br>`couleur` (texte, facultatif, 8 caractères max) — Couleur hexadécimale, ex. #7C3AED<br>`image` (texte, facultatif, 500 caractères max) — Image https (optionnel)<br>`note` (texte, facultatif, 300 caractères max) — Note de relecture ou raison de refus<br>`minutes` (nombre entier, facultatif) — Délai avant publication (1 à 525600 minutes)<br>`salon` (salon, facultatif) — Salon de publication<br>`modele` (texte, facultatif, 40 caractères max) — Nom du modèle<br>`mentions` (texte, facultatif, 300 caractères max) — Membres à mentionner (identifiants séparés par des espaces)
- `/sysp outils pack` — Packs premium du serveur : attribuer, révoquer ou lister (propriétaires PND) · préfixe `=sysp outils pack`<br>`action` (texte, obligatoire, choix : Attribuer (grant), Révoquer (revoke), Lister (list)) — Action à effectuer<br>`pack` (texte, facultatif, choix : ai.advanced, automation.advanced, analytics.advanced, commands.exclusive, creator.studio, server.tools, social.advanced, economy.advanced, games.premium, studio.personal, cloud, marketplace, extensions, lab) — Pack premium (pour grant)<br>`jours` (nombre entier, facultatif) — Durée en jours 1 à 730 ; vide = sans expiration (grant)<br>`id` (nombre entier, facultatif) — Identifiant de l'attribution (revoke)<br>`note` (texte, facultatif) — Note interne, 200 caractères max (grant)
- `/sysp diagnostic acl` — Détecte les permissions et overwrites risqués (lecture seule) · préfixe `=sysp diagnostic acl`
- `/sysp diagnostic sante` — État de santé du bot : Gateway, permissions, base, logs · préfixe `=sysp diagnostic sante`
- `/sysp diagnostic logs-couverture` — Matrice de couverture des événements du Logs Hub · préfixe `=sysp diagnostic logs-couverture`
- `/sysp diagnostic matrice` — Matrice des permissions par niveau (calculée depuis le code) · préfixe `=sysp diagnostic matrice`
- `/sysp diagnostic economie` — Intégrité du grand livre PND et signaux de fraude · préfixe `=sysp diagnostic economie`
- `/sysp diagnostic bots` — Bots : quel bot traite chaque domaine en ce moment · préfixe `=sysp diagnostic bots`
- `/sysp diagnostic installation` — Bilan : permissions et place du rôle de chaque bot, base centrale, sauvegarde · préfixe `=sysp diagnostic installation`
- `/sysp suivi fiche` — Fiche complète d'un membre : arrivée, rôles, sanctions des 5 bots, activité · préfixe `=sysp suivi fiche`<br>`membre` (membre, obligatoire) — Membre concerné
- `/sysp suivi stats` — Activité du staff : sanctions, tickets, vocal, refus de quota, inactifs · préfixe `=sysp suivi stats`<br>`periode` (texte, facultatif, choix : 7 jours, 30 jours) — Période (7 jours par défaut)
- `/sysp suivi notes` — Notes privées du staff sur un membre (chaque lecture est journalisée) · préfixe `=sysp suivi notes`<br>`membre` (membre, obligatoire) — Membre concerné
- `/sysp suivi note-ajouter` — Ajoute une note privée du staff sur un membre (gardée 1 an, pas de données sensibles) · préfixe `=sysp suivi note-ajouter`<br>`membre` (membre, obligatoire) — Membre concerné<br>`texte` (texte, obligatoire, 500 caractères max) — La note (500 caractères maximum)
- `/sysp suivi note-retirer` — Retire une note (son auteur, un SYS+ ou l'owner) · préfixe `=sysp suivi note-retirer`<br>`note` (nombre entier, obligatoire) — Numéro de la note
- `/sysp suivi vote` — Vote des SYS+ sur un candidat SYS+ (avis seulement, l'owner décide) · préfixe `=sysp suivi vote`<br>`membre` (membre, obligatoire) — Candidat<br>`pour` (oui/non, facultatif) — Vrai = pour, faux = contre (vide = voir le résultat)
- `/sysp urgence gel` — Owner : suspend toutes les commandes du staff sur les 5 bots, pour une durée · préfixe `=sysp urgence gel`<br>`duree` (texte, obligatoire, 20 caractères max) — Durée : 30m, 2h, 1j (7 jours maximum)<br>`raison` (texte, facultatif, 300 caractères max) — Raison (visible dans le Logs Hub)<br>`retirer_admin_plus` (oui/non, facultatif) — Retire aussi le rôle ADMIN+ (rendu au dégel)
- `/sysp urgence degel` — Owner : lève le gel du staff tout de suite · préfixe `=sysp urgence degel`
- `/sysp urgence alerte-abus` — Alertes MP aux SYS+ si un membre du staff sanctionne en rafale ou s'acharne (owner pour modifier) · préfixe `=sysp urgence alerte-abus`<br>`active` (oui/non, facultatif) — Active ou coupe les alertes<br>`rafale` (nombre entier, facultatif) — Nombre de sanctions qui déclenche l'alerte rafale (2 à 100)<br>`rafale_minutes` (nombre entier, facultatif) — En combien de minutes (1 à 1440)<br>`cible` (nombre entier, facultatif) — Nombre de sanctions sur la même personne (2 à 50)<br>`cible_heures` (nombre entier, facultatif) — En combien d'heures (1 à 720)
- `/sysp urgence double-validation` — Exige l'accord d'un autre membre SYS+ pour attribuer SYS+ · préfixe `=sysp urgence double-validation`<br>`actif` (oui/non, facultatif) — Vrai = active, faux = désactive (vide = voir l'état)
- `/sysp urgence auto-gel` — Gel automatique du staff quand GUARD repousse une attaque (désactivé par défaut) · préfixe `=sysp urgence auto-gel`<br>`actif` (oui/non, facultatif) — Vrai = active, faux = désactive (vide = voir l'état)<br>`minutes` (nombre entier, facultatif) — Durée du gel : 5 à 240 minutes
- `/sysp market catalog` — Catalogue du Marketplace (lecture) · préfixe `=sysp market catalog`
- `/sysp market installed` — Extensions installées sur ce serveur · préfixe `=sysp market installed`
- `/sysp market publish` — Propriétaires : ajouter une extension au catalogue · préfixe `=sysp market publish`<br>`id` (texte, obligatoire, 40 caractères max) — Identifiant slug (3 à 40 caractères)<br>`nom` (texte, obligatoire, 80 caractères max) — Nom affiché<br>`resume` (texte, facultatif, 200 caractères max) — Résumé court
- `/sysp market withdraw` — Propriétaires : retirer une extension du catalogue · préfixe `=sysp market withdraw`<br>`id` (texte, obligatoire, 40 caractères max) — Identifiant de l'extension
- `/sysp market submit` — Propriétaires : soumettre un manifeste JSON à revue · préfixe `=sysp market submit`<br>`id` (texte, obligatoire, 40 caractères max) — Identifiant de l'extension<br>`manifeste` (texte, obligatoire, 6000 caractères max) — Manifeste JSON déclaratif (16 Ko maximum)
- `/sysp market validate` — Propriétaires : valider une version en revue · préfixe `=sysp market validate`<br>`id` (texte, obligatoire, 40 caractères max) — Identifiant de l'extension<br>`version` (texte, obligatoire, 12 caractères max) — Version x.y.z
- `/sysp market reject` — Propriétaires : rejeter une version en revue · préfixe `=sysp market reject`<br>`id` (texte, obligatoire, 40 caractères max) — Identifiant de l'extension<br>`version` (texte, obligatoire, 12 caractères max) — Version x.y.z
- `/sysp market install` — Installe une version validée (consentement requis) · préfixe `=sysp market install`<br>`id` (texte, obligatoire, 40 caractères max) — Identifiant de l'extension<br>`version` (texte, obligatoire, 12 caractères max) — Version x.y.z<br>`confirmer` (oui/non, facultatif) — Vrai pour accepter les permissions affichées
- `/sysp market uninstall` — Désinstalle une extension (historique conservé) · préfixe `=sysp market uninstall`<br>`id` (texte, obligatoire, 40 caractères max) — Identifiant de l'extension
- `/sysp market rollback` — Revient à la version précédente (sans élargir les permissions) · préfixe `=sysp market rollback`<br>`id` (texte, obligatoire, 40 caractères max) — Identifiant de l'extension

### /ticket

Gère les tickets de support  
Catégorie : SYS+ · Utilisation : `/ticket panel | close | add | remove | list | notes | assign | historique | transcript`

- `/ticket panel` — Publie le panneau d’ouverture de tickets · préfixe `=ticket panel`
- `/ticket close` — Ferme le ticket du salon courant · préfixe `=ticket close`<br>`raison` (texte, facultatif, 300 caractères max) — Raison de la fermeture
- `/ticket add` — Ajoute un membre au ticket courant · préfixe `=ticket add`<br>`membre` (membre, obligatoire) — Membre à ajouter
- `/ticket remove` — Retire un membre du ticket courant · préfixe `=ticket remove`<br>`membre` (membre, obligatoire) — Membre à retirer
- `/ticket list` — Liste les tickets du serveur · préfixe `=ticket list`
- `/ticket notes` — Staff : note moyenne du support par modérateur (1 à 5) · préfixe `=ticket notes`
- `/ticket assign` — Assigne le ticket courant à un membre du staff · préfixe `=ticket assign`<br>`membre` (membre, obligatoire) — Membre du staff support
- `/ticket historique` — Historique (métadonnées) d’un ticket · préfixe `=ticket historique`<br>`id` (nombre entier, facultatif) — Identifiant du ticket (sinon le ticket courant)
- `/ticket transcript` — Transcription d’un ticket fermé (si activée) · préfixe `=ticket transcript`<br>`id` (nombre entier, facultatif) — Identifiant du ticket (sinon le ticket courant)

### /toprep

Affiche le classement de réputation du serveur  
Catégorie : Social & cartes · Utilisation : `/toprep`

### /undog

Retire la laisse d’un membre  
Catégorie : Vocal & DOG · Utilisation : `/undog membre`

- `membre` (membre, obligatoire) — Membre à libérer

### /undogall

Retire toutes les laisses DOG : ce serveur, les anciens serveurs, ou tout  
Catégorie : SYS+ · Utilisation : `/undogall [portee]`

- `portee` (texte, facultatif, choix : Ce serveur, Anciens serveurs (où le bot n'est plus), Tout) — Quelles laisses retirer (par défaut : ce serveur)

### /unmenotte

Libère un membre du système MENOTTE  
Catégorie : Vocal & DOG · Utilisation : `/unmenotte membre`

- `membre` (membre, obligatoire) — Membre à libérer

### /vocalpresence

Consulte les présences vocales historiques observées  
Catégorie : SYS+ · Utilisation : `/vocalpresence date`

- `date` (texte, obligatoire, 40 caractères max) — Date ISO ou timestamp Unix

### /wakeup

Réveille un membre en le faisant passer par chaque salon vocal public  
Catégorie : Vocal & DOG · Utilisation : `/wakeup membre [message]`

- `membre` (membre, obligatoire) — Membre à réveiller (connecté en vocal)
- `message` (texte, facultatif, 300 caractères max) — Message d'accompagnement (facultatif)
- `test` (oui/non, facultatif) — Simulation : montre le parcours sans déplacer personne

### /webhook

Gère les webhooks et les publications automatiques  
Catégorie : Automatisation · Utilisation : `/webhook create | list | delete | publish | edit | animation`

- `/webhook create` — Crée un webhook sécurisé dans un salon · préfixe `=webhook create`<br>`salon` (salon, obligatoire) — Salon textuel<br>`nom` (texte, obligatoire, 80 caractères max) — Nom du webhook
- `/webhook list` — Liste les webhooks gérés par le bot · préfixe `=webhook list`
- `/webhook delete` — Supprime un webhook géré · préfixe `=webhook delete`<br>`id` (texte, obligatoire, 25 caractères max) — Identifiant du webhook
- `/webhook publish` — Publie un message via un webhook · préfixe `=webhook publish`<br>`id` (texte, obligatoire, 25 caractères max) — Identifiant du webhook<br>`message` (texte, obligatoire, 2000 caractères max) — Contenu à publier
- `/webhook edit` — Modifie le dernier message publié · préfixe `=webhook edit`<br>`id` (texte, obligatoire, 25 caractères max) — Identifiant du webhook<br>`message` (texte, obligatoire, 2000 caractères max) — Nouveau contenu
- `/webhook animation` — Active ou désactive l'animation des publications (tous ou un webhook) · préfixe `=webhook animation`<br>`etat` (texte, obligatoire, choix : Activer, Désactiver) — État de l'animation<br>`id` (texte, facultatif, 25 caractères max) — ID du webhook (facultatif : sinon tous)

### /wouaf

Configure et active le remplacement temporaire des messages par WOUAF  
Catégorie : Vocal & DOG · Utilisation : `/wouaf canal-ajouter|activer|stop|statut`

- `/wouaf canal-ajouter` — Autorise un salon textuel · préfixe `=wouaf canal-ajouter`<br>`salon` (salon, obligatoire) — Salon où WAOUF peut agir
- `/wouaf canal-retirer` — Retire un salon autorisé · préfixe `=wouaf canal-retirer`<br>`salon` (salon, obligatoire) — Salon à retirer
- `/wouaf phrase-ajouter` — Ajoute une phrase humoristique · préfixe `=wouaf phrase-ajouter`<br>`phrase` (texte, obligatoire, 180 caractères max) — Utilise {membre} pour mentionner la cible
- `/wouaf phrase-retirer` — Retire une phrase par son numéro · préfixe `=wouaf phrase-retirer`<br>`numero` (nombre entier, obligatoire) — Numéro affiché par /wouaf statut
- `/wouaf duree` — Règle la durée par défaut · préfixe `=wouaf duree`<br>`minutes` (nombre entier, obligatoire) — Durée entre 1 et 1 440 minutes
- `/wouaf repetitions` — Règle après combien de messages utiliser les phrases · préfixe `=wouaf repetitions`<br>`nombre` (nombre entier, obligatoire) — Nombre entre 2 et 20
- `/wouaf cooldown` — Règle l’intervalle minimum des réponses · préfixe `=wouaf cooldown`<br>`secondes` (nombre entier, obligatoire) — Durée entre 2 et 300 secondes
- `/wouaf activer` — Active WAOUF temporairement pour un membre · préfixe `=wouaf activer`<br>`membre` (membre, obligatoire) — Membre cible<br>`duree_minutes` (nombre entier, facultatif) — Durée facultative (1 à 1 440 minutes)
- `/wouaf stop` — Arrête immédiatement WAOUF pour un membre · préfixe `=wouaf stop`<br>`membre` (membre, obligatoire) — Membre cible
- `/wouaf stop-tout` — Arrête immédiatement toutes les activations · préfixe `=wouaf stop-tout`
- `/wouaf statut` — Affiche la configuration et les activations en cours · préfixe `=wouaf statut`

### /wrapped

Affiche ton bilan PND des 30 derniers jours  
Catégorie : Social & cartes · Utilisation : `/wrapped`

## LE FISC (préfixe `-`)

Économie, casino, jeux et cartes

35 commandes.

### /avantage

Dépense tes PND pour des avantages valables dans tous les bots  
Catégorie : Économie · Utilisation : `/avantage liste | acheter | mes-avantages`

- `/avantage liste` — Tous les avantages et leur prix · préfixe `-avantage liste`
- `/avantage acheter` — Achète un avantage · préfixe `-avantage acheter`<br>`avantage` (texte, obligatoire, choix : Boost d'XP, Protection anti-vol, Couleur de pseudo, Droit DJ, Plafond de mise doublé) — Avantage à acheter<br>`couleur` (texte, facultatif, 7 caractères max) — Couleur au format #rrggbb (pour la couleur de pseudo)
- `/avantage mes-avantages` — Tes avantages actifs · préfixe `-avantage mes-avantages`

### /balance

Affiche ton solde PND ou celui d’un membre  
Catégorie : Économie PND · Utilisation : `/balance [membre]`

- `membre` (membre, facultatif) — Membre dont afficher le solde

### /bank

Gère ta banque PND  
Catégorie : Économie PND · Utilisation : `/bank solde | deposit | withdraw`

- `/bank solde` — Affiche ton portefeuille et ta banque · préfixe `-bank solde`
- `/bank deposit` — Dépose des PND en banque · préfixe `-bank deposit`<br>`montant` (nombre entier, obligatoire) — Montant à déposer
- `/bank withdraw` — Retire des PND de la banque · préfixe `-bank withdraw`<br>`montant` (nombre entier, obligatoire) — Montant à retirer

### /blackjack

Joue au blackjack PND  
Catégorie : Économie PND · Utilisation : `/blackjack mise`

- `mise` (nombre entier, obligatoire) — Montant misé

### /braquage

LE FISC : monte une équipe (3 à 5) pour braquer la caisse du serveur  
Catégorie : Économie · Utilisation : `/braquage`

### /business

Gère les entreprises et leur trésorerie PND  
Catégorie : Économie PND · Utilisation : `/business list | create | info | hire | salary | fire | deposit | withdraw | payroll`

- `/business list` — Liste les entreprises du serveur · préfixe `-business list`
- `/business create` — Crée une entreprise · préfixe `-business create`<br>`nom` (texte, obligatoire, 40 caractères max) — Nom de l’entreprise
- `/business info` — Affiche une entreprise · préfixe `-business info`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de l’entreprise
- `/business hire` — Recrute un membre · préfixe `-business hire`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de l’entreprise<br>`membre` (membre, obligatoire) — Membre à recruter
- `/business salary` — Définit le salaire d’un employé · préfixe `-business salary`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de l’entreprise<br>`membre` (membre, obligatoire) — Employé<br>`montant` (nombre entier, obligatoire) — Salaire en PND
- `/business fire` — Retire un membre de l’entreprise · préfixe `-business fire`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de l’entreprise<br>`membre` (membre, obligatoire) — Membre à retirer
- `/business deposit` — Verse des PND à la trésorerie · préfixe `-business deposit`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de l’entreprise<br>`montant` (nombre entier, obligatoire) — Montant en PND
- `/business withdraw` — Retire des PND de la trésorerie · préfixe `-business withdraw`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de l’entreprise<br>`montant` (nombre entier, obligatoire) — Montant en PND
- `/business payroll` — Verse la paie de la période · préfixe `-business payroll`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant de l’entreprise

### /buy

Achète un rôle de la boutique PND  
Catégorie : Économie PND · Utilisation : `/buy role`

- `role` (rôle, obligatoire) — Rôle à acheter

### /card

Affiche les détails d’une carte  
Catégorie : Social & cartes · Utilisation : `/card identifiant`

- `carte` (texte, obligatoire, 32 caractères max) — Identifiant de la carte (ex. dragon)

### /cards

Affiche une collection de cartes  
Catégorie : Social & cartes · Utilisation : `/cards [membre]`

- `membre` (membre, facultatif) — Membre dont afficher la collection

### /casino

PND Casino : blackjack, roulette, machine à sous, mines, crash et plinko  
Catégorie : Jeux & événements · Utilisation : `/casino blackjack | roulette | slots | mines | crash | plinko | jackpot | vip`

- `/casino blackjack` — Table de blackjack : doubler, séparer, assurance · préfixe `-casino blackjack`<br>`mise` (nombre entier, obligatoire) — Mise en PND
- `/casino roulette` — Roulette européenne, plusieurs mises par tour · préfixe `-casino roulette`<br>`mises` (texte, obligatoire, 100 caractères max) — Ex. rouge:500, 17:100, douzaine2:200 — ou juste « rouge »<br>`mise` (nombre entier, facultatif) — Mise par défaut si tu ne précises pas de montant
- `/casino slots` — Machine à sous : 5 lignes, joker, scatters et jackpot · préfixe `-casino slots`<br>`mise` (nombre entier, obligatoire) — Mise en PND
- `/casino mines` — Retourne des cases et encaisse avant la bombe · préfixe `-casino mines`<br>`mise` (nombre entier, obligatoire) — Mise en PND<br>`bombes` (nombre entier, facultatif) — Nombre de mines cachées (1 à 24, défaut 3)
- `/casino crash` — La courbe monte, encaisse avant qu'elle lâche · préfixe `-casino crash`<br>`mise` (nombre entier, obligatoire) — Mise en PND<br>`auto` (nombre, facultatif) — Encaissement automatique, ex. 2.5
- `/casino plinko` — Lâche une bille sur 16 rangées · préfixe `-casino plinko`<br>`mise` (nombre entier, obligatoire) — Mise en PND<br>`risque` (texte, facultatif, choix : Faible, Moyen, Fort) — Niveau de risque
- `/casino coinflip` — Joue à pile ou face · préfixe `-casino coinflip`<br>`mise` (nombre entier, obligatoire) — Mise en PND<br>`choix` (texte, obligatoire, choix : Pile, Face) — pile ou face
- `/casino dice` — Parie sur une face du dé · préfixe `-casino dice`<br>`mise` (nombre entier, obligatoire) — Mise en PND<br>`choix` (texte, obligatoire, choix : 1, 2, 3, 4, 5, 6) — Face attendue (1 à 6)
- `/casino jackpot` — Affiche la cagnotte progressive du serveur · préfixe `-casino jackpot`
- `/casino vip` — Consulte ton rang VIP et ton cashback · préfixe `-casino vip`
- `/casino cashback` — Récupère le cashback de tes pertes de la veille · préfixe `-casino cashback`
- `/casino classement` — Classement des joueurs du serveur · préfixe `-casino classement`
- `/casino stats` — Consulte tes statistiques Casino · préfixe `-casino stats`
- `/casino historique` — Consulte tes dernières parties · préfixe `-casino historique`
- `/casino regles` — Règles et taux de paiement de chaque jeu · préfixe `-casino regles`
- `/casino limites` — Consulte tes protections de jeu · préfixe `-casino limites`
- `/casino limite` — Fixe ta limite quotidienne de mises · préfixe `-casino limite`<br>`montant` (nombre entier, obligatoire) — Maximum quotidien en PND
- `/casino limite-off` — Désactive ta limite quotidienne de mises · préfixe `-casino limite-off`
- `/casino pause` — Active une auto-exclusion personnelle · préfixe `-casino pause`<br>`duree` (texte, obligatoire, choix : 24 heures, 7 jours, 30 jours, Permanente) — Durée de l'auto-exclusion

### /coinflip

Parie des PND sur pile ou face  
Catégorie : Jeux & événements · Utilisation : `/coinflip mise [face]`

- `mise` (nombre entier, obligatoire) — Mise en PND (10–10000)
- `face` (texte, facultatif, choix : Pile, Face) — Ton choix

### /daily

Récupère ton bonus quotidien PND  
Catégorie : Économie PND · Utilisation : `/daily`

### /dice

Lance un ou plusieurs dés  
Catégorie : Jeux & événements · Utilisation : `/dice [faces] [nombre]`

- `faces` (nombre entier, facultatif) — Nombre de faces (2–100, défaut 6)
- `nombre` (nombre entier, facultatif) — Nombre de dés (1–10, défaut 1)

### /duel

LE FISC : défie un membre, le gagnant rafle la mise  
Catégorie : Économie · Utilisation : `/duel membre mise [jeu]`

- `membre` (membre, obligatoire) — Adversaire
- `mise` (nombre entier, obligatoire) — Mise de chaque joueur
- `jeu` (texte, facultatif, choix : Pile ou face, Dés) — Jeu

### /history

Affiche tes dix derniers mouvements PND  
Catégorie : Économie PND · Utilisation : `/history`

### /impots

LE FISC : impôts sur les transferts et la fortune, caisse du serveur  
Catégorie : Économie · Utilisation : `/impots etat · config · verser`

- `/impots etat` — Taux d'imposition et caisse du serveur · préfixe `-impots etat`
- `/impots config` — Admin : règle les impôts · préfixe `-impots config`<br>`transferts` (nombre entier, facultatif) — Impôt sur les transferts en % (0 à 20)<br>`fortune` (nombre entier, facultatif) — Impôt hebdo sur la fortune en % (0 à 10)<br>`seuil` (nombre entier, facultatif) — Fortune exonérée (PND)
- `/impots verser` — Admin : verse de l'argent de la caisse à un membre · préfixe `-impots verser`<br>`membre` (membre, obligatoire) — Membre<br>`montant` (nombre entier, obligatoire) — Montant

### /inventory

Affiche les rôles achetés dans la boutique  
Catégorie : Économie PND · Utilisation : `/inventory`

### /invest

Gère tes placements virtuels PND  
Catégorie : Économie PND · Utilisation : `/invest list | create | close | policy | status`

- `/invest list` — Liste tes placements · préfixe `-invest list`
- `/invest create` — Ouvre un placement · préfixe `-invest create`<br>`montant` (nombre entier, obligatoire) — Capital investi en PND<br>`risque` (nombre entier, facultatif) — Risque en points de base (facultatif)
- `/invest close` — Clôture un placement · préfixe `-invest close`<br>`id` (texte, obligatoire, 36 caractères max) — Identifiant du placement
- `/invest policy` — Configure le risque maximal du serveur · préfixe `-invest policy`<br>`defaut` (nombre entier, obligatoire) — Risque par défaut en points de base<br>`maximum` (nombre entier, obligatoire) — Risque maximal en points de base
- `/invest status` — Affiche la politique de risque du serveur · préfixe `-invest status`

### /jeu

Jeux entre membres : morpion et puissance 4 (mise en PND possible), pendu en groupe  
Catégorie : Jeux & événements · Utilisation : `/jeu morpion @adversaire [mise] · /jeu puissance4 @adversaire [mise] · /jeu pendu · /jeu stats [membre] · /jeu classement jeu`

- `/jeu morpion` — Défie un membre au morpion · préfixe `-jeu morpion`<br>`adversaire` (membre, obligatoire) — Le membre que tu défies<br>`mise` (nombre entier, facultatif) — Mise en PND de chaque joueur (0 = amical)
- `/jeu puissance4` — Défie un membre au puissance 4 · préfixe `-jeu puissance4`<br>`adversaire` (membre, obligatoire) — Le membre que tu défies<br>`mise` (nombre entier, facultatif) — Mise en PND de chaque joueur (0 = amical)
- `/jeu pendu` — Lance un pendu dans ce salon : tout le monde peut jouer · préfixe `-jeu pendu`
- `/jeu stats` — Victoires, défaites et nuls d'un membre · préfixe `-jeu stats`<br>`membre` (membre, facultatif) — Membre (toi par défaut)
- `/jeu classement` — Les meilleurs joueurs du serveur · préfixe `-jeu classement`<br>`jeu` (texte, obligatoire, choix : Morpion, Puissance 4, Pendu) — Jeu

### /job

Choisis et suis ton métier PND sur ce serveur  
Catégorie : Économie PND · Utilisation : `/job list | status | choose métier`

- `/job list` — Affiche les métiers disponibles · préfixe `-job list`
- `/job status` — Affiche ton métier et ta progression · préfixe `-job status`
- `/job choose` — Choisis ou changes de métier · préfixe `-job choose`<br>`metier` (texte, obligatoire, choix : Artisane, Explorateur, Hôte communautaire, Mécanicien, Coursier) — Métier choisi
- `/job mission status` — Affiche ta progression du jour · préfixe `-job mission status`
- `/job mission claim` — Réclame les récompenses terminées · préfixe `-job mission claim`
- `/job contract create` — Publie une mission rémunérée · préfixe `-job contract create`<br>`titre` (texte, obligatoire, 80 caractères max) — Titre du contrat<br>`description` (texte, obligatoire, 500 caractères max) — Travail demandé<br>`recompense` (nombre entier, obligatoire) — Récompense réservée en PND
- `/job contract list` — Consulte les contrats de ce serveur · préfixe `-job contract list`<br>`etat` (texte, facultatif, choix : Ouverts, En cours, À valider, Terminés, Tous) — État à afficher
- `/job contract claim` — Réclame un contrat ouvert · préfixe `-job contract claim`<br>`id` (nombre entier, obligatoire) — Identifiant du contrat
- `/job contract submit` — Soumets le compte rendu du travail · préfixe `-job contract submit`<br>`id` (nombre entier, obligatoire) — Identifiant du contrat<br>`compte-rendu` (texte, obligatoire, 500 caractères max) — Compte rendu à valider
- `/job contract approve` — Valide un compte rendu et libère la récompense · préfixe `-job contract approve`<br>`id` (nombre entier, obligatoire) — Identifiant du contrat
- `/job contract cancel` — Annule un contrat encore ouvert et récupère l’escrow · préfixe `-job contract cancel`<br>`id` (nombre entier, obligatoire) — Identifiant du contrat

### /largage

LE FISC : coffre de PND qui tombe dans un salon actif, le premier qui clique gagne  
Catégorie : Économie · Utilisation : `/largage etat · activer · desactiver · configurer [minimum] [maximum]`

- `/largage etat` — Réglages actuels · préfixe `-largage etat`
- `/largage activer` — Active les largages · préfixe `-largage activer`
- `/largage desactiver` — Coupe les largages · préfixe `-largage desactiver`
- `/largage configurer` — Montant tiré entre un minimum et un maximum · préfixe `-largage configurer`<br>`minimum` (nombre entier, facultatif) — PND au moins<br>`maximum` (nombre entier, facultatif) — PND au plus

### /leaderboard

Affiche le classement des soldes PND du serveur  
Catégorie : Économie PND · Utilisation : `/leaderboard`

### /lottery

Participe à la loterie PND du serveur  
Catégorie : Économie PND · Utilisation : `/lottery info | buy | draw`

- `/lottery info` — Affiche la cagnotte et les tickets · préfixe `-lottery info`
- `/lottery buy` — Achète des tickets (100 PND chacun) · préfixe `-lottery buy`<br>`nombre` (nombre entier, obligatoire) — Nombre de tickets (1–10)
- `/lottery draw` — Lance le tirage (administration) · préfixe `-lottery draw`

### /pack

Ouvre un pack de trois cartes (250 PND)  
Catégorie : Social & cartes · Utilisation : `/pack`

### /pari

LE FISC : ticket à gratter ou course de chevaux  
Catégorie : Économie · Utilisation : `/pari grattage mise · /pari course mise cheval`

- `/pari grattage` — Ticket à gratter (jusqu'à x20) · préfixe `-pari grattage`<br>`mise` (nombre entier, obligatoire) — Mise
- `/pari course` — Parie sur un cheval (x4) · préfixe `-pari course`<br>`mise` (nombre entier, obligatoire) — Mise<br>`cheval` (nombre entier, obligatoire) — Cheval 1 à 5

### /pay

Transfère des PND à un membre  
Catégorie : Économie PND · Utilisation : `/pay membre montant`

- `membre` (membre, obligatoire) — Membre qui reçoit les PND
- `montant` (nombre entier, obligatoire) — Montant à transférer

### /pnd

Gère le solde PND (identifiant propriétaire configuré)  
Catégorie : Économie PND · Utilisation : `/pnd ajouter|retirer|definir|historique|audit`

- `/pnd ajouter` — Ajoute des PND à un membre · préfixe `-pnd ajouter`<br>`membre` (membre, obligatoire) — Membre concerné<br>`montant` (nombre entier, obligatoire) — Montant à ajouter
- `/pnd retirer` — Retire des PND à un membre · préfixe `-pnd retirer`<br>`membre` (membre, obligatoire) — Membre concerné<br>`montant` (nombre entier, obligatoire) — Montant à retirer
- `/pnd definir` — Définit le solde exact d’un membre · préfixe `-pnd definir`<br>`membre` (membre, obligatoire) — Membre concerné<br>`montant` (nombre entier, obligatoire) — Nouveau solde
- `/pnd historique` — Consulte l’historique PND d’un membre · préfixe `-pnd historique`<br>`membre` (membre, facultatif) — Membre (facultatif)
- `/pnd audit` — Consulte l’audit des opérations PND · préfixe `-pnd audit`

### /pret

LE FISC : emprunte des PND avec intérêts  
Catégorie : Économie · Utilisation : `/pret demander montant [jours] · rembourser [montant] · etat`

- `/pret demander` — Demande un prêt (10 % d'intérêts) · préfixe `-pret demander`<br>`montant` (nombre entier, obligatoire) — Montant<br>`jours` (nombre entier, facultatif) — Durée (1 à 14 jours, 7 par défaut)
- `/pret rembourser` — Rembourse ton prêt · préfixe `-pret rembourser`<br>`montant` (nombre entier, facultatif) — Montant (tout par défaut)
- `/pret etat` — Ton prêt en cours · préfixe `-pret etat`

### /prime

LE FISC : prime sur un membre, gagnée en le battant en duel ou en le volant  
Catégorie : Économie · Utilisation : `/prime poser membre montant · voir [membre] · liste`

- `/prime poser` — Met une prime sur la tête d'un membre (argent bloqué tout de suite) · préfixe `-prime poser`<br>`membre` (membre, obligatoire) — La cible<br>`montant` (nombre entier, obligatoire) — Montant (100 à 50 000 PND)
- `/prime voir` — La prime sur un membre · préfixe `-prime voir`<br>`membre` (membre, facultatif) — Membre
- `/prime liste` — Les avis de recherche du serveur · préfixe `-prime liste`

### /rob

Tente de voler des PND à un membre (risqué)  
Catégorie : Économie PND · Utilisation : `/rob membre`

- `membre` (membre, obligatoire) — Membre à voler

### /roulette

Joue à la roulette PND  
Catégorie : Économie PND · Utilisation : `/roulette mise choix`

- `mise` (nombre entier, obligatoire) — Montant misé
- `choix` (texte, obligatoire, choix : Rouge, Noir, Vert (0)) — Couleur sur laquelle miser

### /shop

Affiche ou gère la boutique de rôles PND  
Catégorie : Économie PND · Utilisation : `/shop voir | ajouter | retirer`

- `/shop voir` — Affiche les rôles en vente · préfixe `-shop voir`
- `/shop ajouter` — Ajoute un rôle à la boutique (administration) · préfixe `-shop ajouter`<br>`role` (rôle, obligatoire) — Rôle à vendre<br>`prix` (nombre entier, obligatoire) — Prix en PND
- `/shop retirer` — Retire un rôle de la boutique (administration) · préfixe `-shop retirer`<br>`role` (rôle, obligatoire) — Rôle à retirer
- `/shop market list` — Affiche les annonces ouvertes · préfixe `-shop market list`
- `/shop market sell` — Met un rôle de boutique que tu possèdes en vente · préfixe `-shop market sell`<br>`role` (rôle, obligatoire) — Rôle à vendre<br>`prix` (nombre entier, obligatoire) — Prix en PND
- `/shop market buy` — Achète et reçois un rôle annoncé · préfixe `-shop market buy`<br>`id` (nombre entier, obligatoire) — Identifiant de l’annonce
- `/shop market cancel` — Retire ta propre annonce ouverte · préfixe `-shop market cancel`<br>`id` (nombre entier, obligatoire) — Identifiant de l’annonce
- `/shop auction list` — Affiche les enchères ouvertes · préfixe `-shop auction list`
- `/shop auction create` — Ouvre une enchère de 10 minutes à 7 jours · préfixe `-shop auction create`<br>`role` (rôle, obligatoire) — Rôle de boutique que tu possèdes<br>`prix-initial` (nombre entier, obligatoire) — Prix minimal en PND<br>`duree-minutes` (nombre entier, obligatoire) — Durée de l’enchère en minutes
- `/shop auction bid` — Place une offre qui sera retenue en escrow · préfixe `-shop auction bid`<br>`id` (nombre entier, obligatoire) — Identifiant de l’enchère<br>`montant` (nombre entier, obligatoire) — Offre PND, supérieure à la meilleure offre
- `/shop auction cancel` — Annule ta propre enchère sans offre · préfixe `-shop auction cancel`<br>`id` (nombre entier, obligatoire) — Identifiant de l’enchère

### /trade

Propose ou gère un échange de cartes  
Catégorie : Social & cartes · Utilisation : `/trade proposer | accepter | annuler | liste`

- `/trade proposer` — Propose un échange à un membre · préfixe `-trade proposer`<br>`membre` (membre, obligatoire) — Membre à qui proposer<br>`offre` (texte, obligatoire, 32 caractères max) — Carte que tu donnes<br>`demande` (texte, obligatoire, 32 caractères max) — Carte que tu veux recevoir
- `/trade accepter` — Accepte un échange · préfixe `-trade accepter`<br>`id` (texte, obligatoire, 12 caractères max) — Identifiant de l’échange
- `/trade annuler` — Annule un échange que tu as proposé · préfixe `-trade annuler`<br>`id` (texte, obligatoire, 12 caractères max) — Identifiant de l’échange
- `/trade liste` — Liste tes échanges en attente · préfixe `-trade liste`

### /trivia

Lance une question de culture générale récompensée  
Catégorie : Jeux & événements · Utilisation : `/trivia`

### /work

Travaille pour gagner des PND (toutes les heures)  
Catégorie : Économie PND · Utilisation : `/work`

## Invest + (préfixe `$`)

Abonnements des membres, espace privé par membre, administration des formules

2 commandes.

### /abonnement

Invest + : ton abonnement, tes avantages et ton espace privé  
Catégorie : Invest + · Utilisation : `/abonnement voir · formules · historique · offrir · espace · demande`

- `/abonnement voir` — Ton abonnement : formule, échéance, avantages · préfixe `$abonnement voir`
- `/abonnement formules` — Les formules proposées (et le paiement en PND quand il est possible) · préfixe `$abonnement formules`
- `/abonnement historique` — L'historique de ton abonnement · préfixe `$abonnement historique`
- `/abonnement offrir` — Offre une formule payable en PND à un autre membre · préfixe `$abonnement offrir`<br>`membre` (membre, obligatoire) — Le membre qui reçoit le cadeau<br>`formule` (texte, obligatoire, 40 caractères max) — Formule offerte (nom ou numéro)
- `/abonnement espace` — Ouvre (ou retrouve) ton salon privé Invest + · préfixe `$abonnement espace`
- `/abonnement auto` — Renouvellement automatique en PND à l'échéance · préfixe `$abonnement auto`<br>`etat` (texte, facultatif, choix : Activer, Couper) — Choix
- `/abonnement demande` — Écris à l'administration (renouvellement, changement, question) · préfixe `$abonnement demande`<br>`type` (texte, obligatoire, choix : Renouveler, Changer de formule, Question) — Objet de la demande<br>`formule` (texte, facultatif, 40 caractères max) — Formule concernée (nom ou numéro)<br>`message` (texte, facultatif, 500 caractères max) — Ton message

### /investadmin

Invest + : administration des formules, abonnés et espaces  
Catégorie : Invest + · Utilisation : `/investadmin installer · tableau · formule-creer · attribuer · prolonger · resilier · demandes…`

- `/investadmin installer` — Crée la catégorie des espaces et le salon d'administration · préfixe `$investadmin installer`
- `/investadmin tableau` — Tableau de bord : abonnés, échéances, demandes, revenus · préfixe `$investadmin tableau`
- `/investadmin config` — Réglages d'Invest + · préfixe `$investadmin config`<br>`actif` (oui/non, facultatif) — Invest + activé<br>`categorie` (salon, facultatif) — Catégorie des espaces membres<br>`salon_admin` (salon, facultatif) — Salon d'administration (demandes, journal)<br>`role_staff` (rôle, facultatif) — Rôle qui voit les espaces membres (facultatif)<br>`rappel_jours` (nombre entier, facultatif) — Rappel avant échéance, en jours (0 = aucun)<br>`accueil` (texte, facultatif, 900 caractères max) — Texte d'accueil du panneau membre<br>`paiement_infos` (texte, facultatif, 900 caractères max) — Comment payer en réel (montré au membre qui demande une formule)
- `/investadmin formules` — Toutes les formules, archivées comprises · préfixe `$investadmin formules`
- `/investadmin formule-creer` — Crée une formule · préfixe `$investadmin formule-creer`<br>`nom` (texte, obligatoire, 40 caractères max) — Nom de la formule<br>`prix` (nombre entier, obligatoire) — Prix par période (0 = gratuit)<br>`duree` (nombre entier, obligatoire) — Durée d'une période, en jours<br>`paiement` (texte, facultatif, choix : Paiement réel (activée en un clic par l'admin), En PND (payée par le membre), Au choix : PND ou paiement réel) — Comment la formule est payée<br>`prix_reel` (texte, facultatif, 60 caractères max) — Prix en argent réel affiché (ex. 9,99 € / mois)<br>`role` (rôle, facultatif) — Rôle donné aux abonnés (jamais un rôle protégé)<br>`description` (texte, facultatif, 300 caractères max) — À quoi sert la formule<br>`avantages` (texte, facultatif, 900 caractères max) — Avantages, séparés par ;
- `/investadmin formule-modifier` — Modifie une formule · préfixe `$investadmin formule-modifier`<br>`formule` (texte, obligatoire, 40 caractères max) — Formule (nom ou numéro)<br>`nom` (texte, facultatif, 40 caractères max) — Nouveau nom<br>`prix` (nombre entier, facultatif) — Nouveau prix<br>`duree` (nombre entier, facultatif) — Nouvelle durée en jours<br>`paiement` (texte, facultatif, choix : Paiement réel, En PND, Au choix : PND ou réel) — Mode de paiement<br>`prix_reel` (texte, facultatif, 60 caractères max) — Prix en argent réel affiché (ex. 9,99 € / mois)<br>`role` (rôle, facultatif) — Nouveau rôle des abonnés<br>`retirer_role` (oui/non, facultatif) — Ne plus donner de rôle<br>`description` (texte, facultatif, 300 caractères max) — Nouvelle description<br>`avantages` (texte, facultatif, 900 caractères max) — Nouveaux avantages, séparés par ;
- `/investadmin formule-archiver` — Ne plus proposer une formule (les abonnés la gardent) · préfixe `$investadmin formule-archiver`<br>`formule` (texte, obligatoire, 40 caractères max) — Formule (nom ou numéro)
- `/investadmin formule-reactiver` — Proposer de nouveau une formule archivée · préfixe `$investadmin formule-reactiver`<br>`formule` (texte, obligatoire, 40 caractères max) — Formule (nom ou numéro)
- `/investadmin attribuer` — Donne une formule à un membre · préfixe `$investadmin attribuer`<br>`membre` (membre, obligatoire) — Membre<br>`formule` (texte, obligatoire, 40 caractères max) — Formule (nom ou numéro)<br>`jours` (nombre entier, facultatif) — Durée en jours (vide = durée de la formule, 0 = sans fin)<br>`note` (texte, facultatif, 200 caractères max) — Note interne (visible par l'admin seulement)
- `/investadmin prolonger` — Ajoute des jours à l'abonnement d'un membre · préfixe `$investadmin prolonger`<br>`membre` (membre, obligatoire) — Membre<br>`jours` (nombre entier, obligatoire) — Jours à ajouter
- `/investadmin pause` — Met un abonnement en pause (les jours restants sont gardés) · préfixe `$investadmin pause`<br>`membre` (membre, obligatoire) — Membre
- `/investadmin reprendre` — Reprend un abonnement en pause · préfixe `$investadmin reprendre`<br>`membre` (membre, obligatoire) — Membre
- `/investadmin resilier` — Résilie un abonnement tout de suite · préfixe `$investadmin resilier`<br>`membre` (membre, obligatoire) — Membre<br>`raison` (texte, facultatif, 200 caractères max) — Motif (envoyé au membre)
- `/investadmin note` — Note interne sur un abonné · préfixe `$investadmin note`<br>`membre` (membre, obligatoire) — Membre<br>`texte` (texte, facultatif, 200 caractères max) — Note (vide = effacer)
- `/investadmin fiche` — Fiche complète d'un abonné · préfixe `$investadmin fiche`<br>`membre` (membre, obligatoire) — Membre
- `/investadmin abonnes` — Liste des abonnés · préfixe `$investadmin abonnes`<br>`statut` (texte, facultatif, choix : Actifs, En pause, Expirés, Résiliés) — Filtrer
- `/investadmin espace` — Crée ou répare l'espace privé d'un membre · préfixe `$investadmin espace`<br>`membre` (membre, obligatoire) — Membre
- `/investadmin espace-fermer` — Supprime l'espace privé d'un membre · préfixe `$investadmin espace-fermer`<br>`membre` (membre, obligatoire) — Membre
- `/investadmin demandes` — Demandes des membres en attente · préfixe `$investadmin demandes`
- `/investadmin actualiser` — Met à jour tous les panneaux des espaces · préfixe `$investadmin actualiser`

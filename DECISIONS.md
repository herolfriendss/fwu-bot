# 1942 — Décisions : ce qui a été choisi par défaut

Tu m'as demandé de tout terminer en te laissant le moins possible à faire. Pour chaque point qui demandait une décision, j'ai appliqué le choix **le plus prudent**. Chaque choix se change sans toucher au code (variable d'environnement ou commande Discord), sauf mention contraire.

**Tu n'as rien à faire si ces choix te conviennent.**

| # | Sujet | Choix appliqué | Pour changer |
|---|---|---|---|
| 1 | Droits de Btk et MZ | Aucun droit propre. Seul `PND_OWNER_DISCORD_ID` est OWNER. | Leur donner le rôle SYS+ ou ADMIN+ dans Discord. |
| 2 | SYS+ et MENOTTE / WAKEUP | Inchangé : réservé à l'OWNER et aux ADMIN+ dont le scope vocal est activé. Les messages d'erreur le disent désormais clairement. | Donner aussi le rôle ADMIN+ aux SYS+ concernés, ou demander une modification du code. |
| 3 | Règle de rang pour l'OWNER | Pas d'exception : l'OWNER doit avoir un rôle au-dessus de sa cible pour DOG et MENOTTE (seul le propriétaire du serveur Discord y échappe, règle native). | Placer le rôle de l'OWNER en haut de la hiérarchie Discord. |
| 4 | Propriétaire du serveur ≠ OWNER 1942 | Les deux restent distincts : le propriétaire du serveur garde ses privilèges natifs Discord. | Rien. |
| 5 | WAKEUP | Pause de 1,5 s entre deux salons, délai de 60 s par auteur, 25 salons maximum. La cible reste dans le dernier salon. | `PND_WAKEUP_STEP_DELAY_MS`, `PND_WAKEUP_COOLDOWN_MS`. |
| 6 | `/salut` et `/info-serveur` | Gardés mais inaccessibles (le catalogue est plein, 100/100). Sans effet. | Rien. |
| 7 | Noms `her-v5-*`, `her-v3`, palette violette | **Conservés**. Renommer les processus PM2 casserait le déploiement. | Rien. |
| 8 | `DEMARRER_AVEC_CLAUDE.txt` (« deux propriétaires ») | Document périmé, laissé en l'état. La référence est `MISE_EN_PRODUCTION.md`. | Supprimer le fichier si tu veux. |
| 9 | Seuils antifraude `=pay` | 7 jours de compte, 3 jours sur le serveur, 50 000 PND et 20 transferts par 24 h. WHITELIST lève les plafonds, pas l'ancienneté. | `PND_TRANSFER_*` dans `bot/.env`. |
| 10 | PV retiré à la main pendant l'arrêt du bot | Réappliqué au démarrage (`=unpv` reste possible et restaure l'état d'origine). | Utiliser `=unpv` avant de modifier un salon à la main. |
| 11 | Transcriptions de tickets | **Désactivées**. Les activer suppose d'informer les membres que leurs échanges sont conservés. | `PND_TICKET_TRANSCRIPT_DAYS=30` (1 à 90 jours). |
| 12 | Seuils de réputation | 7 jours de compte, 3 jours sur le serveur, 5 points par 24 h. | `PND_REP_*`. |
| 13 | rankall | Propriétaire uniquement, rôles à permission sensible refusés, 5 000 membres maximum. | `PND_RANKALL_MAX_MEMBERS`. |
| 14 | Lot E « 1942 RESUME » | **Non développé** : explicitement reporté dans ton dossier de passation, et aucune spécification dans le dépôt. | M'envoyer ce que doit faire RESUME. |
| 15 | Relations entre membres, studio de profil, nouvelles fonctions IA | **Non développés** : ce seraient des fonctionnalités inventées, sans spécification. Tout ce qui existe dans le code a été vérifié par le banc d'essai. | M'envoyer la liste précise des fonctionnalités voulues. |
| 16 | DM ALL | **Développé** (introuvable dans le code, mais cité dans ta transmission) : **toi seul** (`PND_OWNER_DISCORD_ID`). Aperçu → confirmation sous 60 s → envoi d'un MP toutes les 1,5 s, arrêt possible. Bots exclus, aucune mention, 1 000 destinataires maximum, 1 h minimum entre deux envois. Un envoi coupé par un redémarrage n'est jamais relancé seul : certains membres recevraient le message deux fois. Le contenu n'est pas copié dans les logs. | `PND_DMALL_MAX_MEMBERS`, `PND_DMALL_STEP_DELAY_MS`, `PND_DMALL_COOLDOWN_MS`. |
| 17 | Nom affiché | « FWU » partout dans Discord ; chaque bot signe « FWU • GUARD »… | `PND_<BOT>_FOOTER`, `PND_<BOT>_COLOR`. |
| 18 | Blacklist | **Développée** sur FWU, à côté de `/ban` : réservée à l'OWNER et aux SYS+. Le compte est banni tout de suite, même s'il n'est pas sur le serveur (bannissement par ID), puis rebanni automatiquement s'il revient. Le rang Discord reste respecté : impossible de blacklister l'OWNER, le propriétaire du serveur, un rôle plus élevé ou soi-même. Retirer un compte de la blacklist **ne le débannit pas** : le débannissement reste un geste volontaire dans Discord. Un débannissement manuel d'un compte encore blacklisté déclenche un avertissement dans les logs. Liste propre à chaque serveur. | Me dire si elle doit aussi débannir au retrait, ou s'appliquer à tous tes serveurs. |

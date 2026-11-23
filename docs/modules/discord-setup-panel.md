# Administration Discord First — `/setup` et `/panel`

`/panel` donne accès aux catégories du catalogue slash partagé; les commandes affichées ne peuvent donc pas diverger d’une liste parallèle. La consultation et la navigation sont réservées au propriétaire du serveur ou aux membres ayant Gérer le serveur. Il expose les sections d’administration déjà raccordées. `/setup` configure les modules V5 pris en charge via sélecteur et modales, affiche les champs modifiés, puis demande une confirmation explicite. Les réglages restent propres à chaque guild dans `bot-sync`.

Les brouillons d’aperçu sont privés à leur auteur et à leur guild. L’application est valable 15 minutes; un aperçu expiré reste récupérable pendant 7 jours depuis le bouton **Mes brouillons**. Sa reprise ouvre une nouvelle fenêtre de 15 minutes. Au moment d’appliquer, le bot recharge les paramètres actuels et détecte les modifications concurrentes; il vérifie à nouveau l’existence/type des rôles et salons, la hiérarchie et ses propres permissions. Un conflit ou une référence devenue invalide bloque l’application et impose de recréer l’aperçu.

Les contrôles de composant revalident l’accès propriétaire/Gérer le serveur et l’auteur du brouillon. La récupération exige simultanément le même identifiant de guild et le même auteur. La table `discord_setup_drafts` est créée de façon additive; les lignes héritées reçoivent une rétention de sept jours, et seules les lignes dont la rétention est terminée sont purgées.

## Vérification locale

`node --test bot/systems/setup/setup-drafts.test.js` couvre la reprise après expiration, l’isolation entre guilds et le refus d’un autre utilisateur. Les interactions Discord réelles et l’application des paramètres via un backend de recette restent à valider sur une application dédiée.

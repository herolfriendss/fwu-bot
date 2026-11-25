# Accueil FWU — bienvenue et départ

Les messages d'arrivée et de départ sont pilotés par FWU à partir des réglages existants du serveur.

## Réglages

- Message de bienvenue : welcome.enabled, welcome.channelId, welcome.message.
- Message de départ : welcome.leaveEnabled, welcome.leaveChannelId, welcome.leaveMessage.
- Le départ est désactivé par défaut.
- Si aucun salon de départ distinct n'est choisi, le message utilise le salon de bienvenue existant.
- Les deux fonctions réutilisent exclusivement des salons déjà sélectionnés dans le tableau de bord. Elles ne créent, ne déplacent, ne renomment et ne configurent aucun salon.

## Variables de message

- {user} : mention du membre concerné.
- {server} : nom du serveur.
- {memberCount} : nombre de membres au moment de l'événement.
- {accountCreatedAt} : date de création du compte.

Les mentions sont limitées au membre concerné. Les messages de départ restent opt-in. Les journaux d'arrivée/départ continuent d'être envoyés vers le système de logs déjà configuré.

## Validation

Les fonctions de rendu sont pures côté bot et testées séparément. Le tableau de bord assainit les identifiants de salons Discord et borne les messages à 2 000 caractères.

# Tickets — historique, assignation, transcriptions

- **Historique** (`ticket_events`) : ouverture, prise en charge, assignation, ajout/retrait de membre, fermeture, suppression manuelle du salon. Métadonnées seulement (acteur, cible, date), aucun contenu. `/ticket historique [id]` ou `=ticket historique [id]`, réservé au staff support.
- **Assignation** : `/ticket assign membre` ou `=ticket assign @membre` dans le salon du ticket. L'assigné doit être du staff support (propriétaire du serveur, Gérer les salons, rôle support, ou ADMIN+ avec le scope tickets).
- **Transcriptions : désactivées par défaut.** Pour les activer, définir `PND_TICKET_TRANSCRIPT_DAYS` entre 1 et 90 dans `bot/.env`. À la fermeture, le texte du salon est capturé (500 messages et 200 000 caractères maximum), stocké en SQLite avec une date d'expiration, puis purgé automatiquement toutes les heures. Consultation uniquement par `/ticket transcript [id]` (réponse éphémère, lecture auditée). La version préfixe est refusée pour ne pas publier le fichier dans un salon. Un échec de capture ne bloque jamais la fermeture.

Décision produit à confirmer : activer ou non les transcriptions et choisir leur durée, ce qui suppose d'informer les membres que leurs échanges de ticket sont conservés pendant cette durée.


## Limite de configuration du serveur

Le bot utilise uniquement la catégorie et le rôle support déjà sélectionnés dans les réglages. La commande de panneau publie le panneau dans le salon existant choisi par l'administrateur. Le bot ne provisionne pas de catégorie, ne réorganise pas les salons et ne modifie aucun rôle existant. Un salon privé de ticket est créé uniquement à la demande d'un membre via le bouton d'ouverture, puis supprimé à la fermeture après les opérations prévues. Si aucun emplacement existant n'est configuré, la fonctionnalité signale le prérequis au lieu de créer une structure serveur.

## Prérequis explicites

- Les tickets doivent être activés dans les réglages des modules.
- Un rôle support déjà existant doit être sélectionné avant de publier le panneau ou d’ouvrir un ticket. Le bot ne crée, ne renomme, ne recolore et ne modifie aucun rôle.
- La catégorie reste facultative : si aucune catégorie existante n’est choisie, le salon privé du ticket est créé à la racine du serveur uniquement à la demande du membre.
- `=ticket panel` et `/ticket panel` ne modifient plus automatiquement les réglages. Ils publient seulement le panneau dans le salon textuel où la commande est exécutée.

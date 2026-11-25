# FWU — chantier expérience serveur

## Objectif

Améliorer l'expérience des membres et du staff sur l'ensemble des six applications FWU, sans reconstruire le serveur et sans toucher à sa configuration Discord existante.

## Limites non négociables

- Ne pas créer, supprimer, renommer, déplacer ou modifier des salons.
- Ne pas créer, supprimer, renommer, recolorer, réordonner ou attribuer des rôles.
- Ne pas modifier les paramètres Discord Developer Portal, les invitations OAuth, les intents ou les tokens.
- Ne pas déployer sur Oracle, redémarrer PM2, appliquer une migration distante ou modifier la production.
- Ne pas modifier `main`. Tout travail reste sur la branche de développement et sa PR.
- Les fonctionnalités qui nécessitent un salon déjà existant doivent rester désactivées tant qu'un salon n'a pas été explicitement configuré par le propriétaire.
- Invest + reste facultatif.

## Chantiers

### 1. Stabilisation et sécurité — priorité bloquante

- Corriger tous les échecs des tests bots et dashboard.
- Revoir la hiérarchie des six applications et le traitement des rôles managés.
- Conserver le contrôle d'accès fail-closed pour les opérations sensibles.
- Maintenir le principe de permissions opérationnelles minimales : jamais `Administrator` par défaut.
- Vérifier les interactions, les mentions, les limites de payload, les erreurs API et les opérations concurrentes.
- Ne jamais considérer une CI en échec comme une validation.

### 2. Bienvenue FWU

- Utiliser le système de bienvenue existant et ses réglages actuels.
- Rendre le message plus soigné : embed rouge sombre/noir, avatar du membre, nom du serveur, nombre de membres et date de création du compte.
- Respecter le salon déjà configuré ; ne jamais créer ni choisir un salon automatiquement.
- Garder la fonctionnalité inactive si elle n'est pas activée ou si aucun salon n'est configuré.
- Contrôler les mentions pour éviter les pings non désirés.

### 3. Tickets avec les bots FWU

- Conserver le système natif de tickets : panneau, ouverture privée, prise en charge, assignation, ajout/retrait, fermeture, historique et transcription à rétention limitée.
- Clarifier les commandes et le parcours utilisateur, et uniformiser les embeds.
- Vérifier que les actions staff et l'auteur du ticket sont contrôlés à chaque interaction.
- Ne pas créer de catégorie ni de salon de panneau automatiquement.
- Le panneau ne peut être publié que dans le salon textuel choisi explicitement par un administrateur autorisé.
- La transcription reste désactivée par défaut.

### 4. Identité visuelle et pack d'emojis

Direction proposée : rouge profond, noir charbon, gris acier et détails blancs, dans une esthétique nocturne urbaine FWU/PND.

Pack à concevoir comme fichiers individuels transparents, lisibles à petite taille :
- FWU / monogramme
- couronne OWNER
- bouclier sécurité
- ticket support
- bienvenue / main
- cœur communauté
- éclair / activité
- musique / casque
- vocal / micro
- économie / pièce PND
- trophée / récompense
- alerte / modération

Le pack doit être préparé comme proposition graphique ; aucun emoji ne sera téléversé sur Discord automatiquement.

### 5. Cohérence des six applications

- FWU : modération staff, embeds, bienvenue et expérience de support.
- GUARD : sécurité, anti-raid, anti-nuke, vérification et modération lourde.
- FDPDLAVOC : musique, radio et fonctionnalités vocales.
- SUCK ME : SYS+, hiérarchie, outils staff, DOG, MENOTTE, WAKEUP et automatisations.
- LE FISC : économie PND, jeux, cartes et anti-fraude.
- Invest + : abonnements et espaces privés ; application facultative.

Chaque commande doit avoir un propriétaire explicite. Éviter les doublons, les commandes redondantes et les réponses de statut séparées sous un embed ou un panneau.

### 6. Ergonomie des commandes

- Regrouper les commandes liées sous des racines cohérentes et des sous-commandes.
- Préserver les actions existantes et la compatibilité des préfixes.
- Fournir une aide claire par application, avec exemples courts et permissions requises.
- Vérifier la parité slash/préfixe là où les deux interfaces existent.
- Ne pas ajouter un préfixe à FWU : il reste slash uniquement.

## Validation attendue

- Tests unitaires et d'intégration ciblés.
- Audit de surface des commandes.
- Smoke test de toutes les commandes slash.
- Type-check, lint et build du dashboard.
- Tests de packaging et scripts.
- Vérification finale de la PR et de ses statuts CI.

## État d'application

Ce document est un plan de développement. Il ne configure pas le serveur Discord, ne modifie aucun salon ou rôle, ne publie aucun panneau et ne déploie rien.

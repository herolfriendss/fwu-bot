# PND Assist + — plan directeur

## Principes

- Faire évoluer Her? V5 sans réécriture, préserver ses commandes, données et intégrations utiles.
- Discord First ; contrôles d’autorisation côté serveur et configurations/données strictement séparées par guild.
- PND est le serveur principal ; MZ reste désactivé jusqu’à validation humaine. Le serveur central de logs est une destination isolée, jamais une source de configuration partagée.
- Nom public : PND Assist +. Aucun système de factions. Pas de scraping de plateformes pour fournir l’audio.
- Ne jamais accéder à Oracle/VPS, utiliser un secret de production ou toucher aux données de production pour les tests locaux.

## Lots et critères de sortie

### 1. Musique et radio
- [x] Borner les playlists, séparer les transitions du lecteur, tester file, répétition, erreur de flux et rechargement radio avec des faux.
- [x] Nettoyer et détruire une connexion vocale qui n’atteint pas `Ready`, puis retenter une attente sur les connexions réutilisées ; tests de timeout et de remplacement concurrent.
- [x] Retenter les radios persistantes après un échec de démarrage, avec une seule minuterie par guild et annulation via `stop`/`clear` ; tester le garde de configuration courante sans Gateway.
- [x] Vérifier localement la politique des sources, l’encodage libopus/ffprobe et le round-trip XChaCha20-Poly1305.
- [ ] Vérifier les mêmes flux avec une vraie connexion voice sur serveur de recette.
- [ ] Valider une lecture réellement audible, pause, reprise, skip, erreurs, reconnexion et radio persistante sur recette. Protocole prêt : `docs/recettes/musique-radio-discord.md`; app, guild, backend et flux de test dédiés restent à fournir/configurer.
- [x] Retirer `play-dl` et l’extraction YouTube/Spotify au profit d’URL HTTPS directes autorisées par serveur ; [ ] valider la fiabilité et les droits des fournisseurs.

### 2. Fondations et identité
- [x] Référence Git locale V5 et archive source-only contrôlée.
- [ ] Corriger les types backend/Supabase, rendre les builds/lint répétables et documenter les commandes.
- [ ] Migrer les références visibles Her? vers PND Assist + sans renommer les clés de persistance ni casser les données.
- [ ] Établir sauvegarde/restauration source et stratégie additive de migration ; aucun changement de données prod sans validation.

### 3. Permissions et journalisation
- [ ] Cartographier et tester SYS+, ADMIN+, WHITELIST ; appliquer les limites internes et préserver la hiérarchie Discord.
- [x] GuildGuard n’annonce plus une quarantaine/rétrogradation non appliquée : contrôle de permission native, existence, type et position du rôle; fallback journalisé en cas d’échec Discord.
- [x] Ajouter `/sys-panel` et `/action-history` comme alias du panneau/audit SYS+ existants ; ajouter `/sys-add` et `/sys-remove` owner-only avec permissions Manage Roles, hiérarchie et audit. Actualiser membre/rôle avant les contrôles. [ ] recette Discord isolée.
- [x] Ajouter `/permissions` et `/permissions-edit` pour des scopes ADMIN+ indépendants (rôles, vocal/MENOTTE, LOCKNAME, tickets), avec stockage par guild, valeurs par défaut compatibles et tests d’isolation. [ ] recette et revue des scopes restants.
- [x] Actualiser le panneau SYS+ pour exposer les commandes effectivement livrées et supprimer les mentions de modules encore « en développement » alors que leurs commandes sont disponibles; test runtime du rendu.
- [x] WHITELIST : commandes owner-only, rôle exact par serveur, journalisation et exception au quota DOG ; [ ] vérifier sur serveur de recette et terminer l’audit des autres limites internes.
- [x] WHITELIST contourne également le quota anti-spam interne configuré pour son serveur, sans accorder `ManageMessages`; politique testée sans Discord.
- [x] Vérifier propriétaire-only pour `/pnd`, `/pnd-add`, `/pnd-remove`, `/pnd-history` et `/pnd-audit` via `PND_OWNER_DISCORD_ID`, avec audit local par guild; test runtime slash prouvant qu’un membre avec permissions/rôle privilégiés est refusé alors que l’ID propriétaire configuré passe ; [ ] recette sur bot de test dédié.
- [x] `/pnd-add` et `/pnd-remove` : test runtime par le vrai routeur slash; confirme refus non-propriétaire malgré rôles/permissions privilégiés, succès du propriétaire configuré et absence de crédit croisé entre guilds.
- [x] Préparer un routage PND/MZ distinct au hub avec rôles, catégories et canaux séparés ; MZ reste hors allowlist runtime. [ ] Vérifier les ACL effectives existantes avant toute mise en service.
- [x] Garder MZ bloqué même quand son identifiant figure dans l’allowlist; ne l’autoriser qu’avec `PND_MZ_ENABLED=true` après validation humaine. Les nouvelles catégories de logs ont des rôles sensibles séparés; l’envoi refuse @everyone, rôles hors périmètre/croisés, accès membre additionnel, rôle Logs avec Administrator ou salon non synchronisé. Les ACL Discord existantes sont laissées intactes et doivent encore être vérifiées humainement.
- [x] DOG : nom exact `En laisse` et reprise/renommage du rôle V5 historique sans doublon.
- [x] DOG : l’exception WHITELIST n’est signalée que lorsqu’elle dépasse réellement le quota; cette exception est inscrite dans l’historique SYS+ local et les logs centraux.
- [x] DOG : tests runtime SQLite/JSON temporaires de persistance et restauration rôle/surnom après redémarrage du module.
- [x] DOG : propager les paramètres WHITELIST jusqu’au service métier pour `/dog` comme pour `=dog`; le test runtime utilise le routeur slash réel.
- [x] DOG : ajouter une liste d’état SYS+ guild-scoped via `/dog` sans membre et `=doglist`, sans consommer une nouvelle commande du catalogue global limité à 100.
- [x] DOG : rendre `/dog` et `/undog` invocables par les SYS+ sans ManageNicknames côté membre; l’autorisation SYS+ runtime et les permissions/hierarchie Discord du bot restent obligatoires. `/dog` sans cible liste l’état guild-scoped; tests runtime/catalogue ciblés.
- [ ] DOG : recette Discord isolée des permissions, hiérarchie et déplacements vocaux.
- [x] MENOTTE : durées facultatives bornées, commandes slash, migration additive, expiration auditées et tests locaux ; [ ] recette Discord isolée et validation des permissions/réactions vocales.
- [x] LOCKNAME : protection isolée par guild, restauration sur changements/arrivées/reprise, permissions natives, hiérarchie et tests locaux.
- [x] WAOUF : contrôles SYS+ et permission Discord native, salons autorisés, phrases sûres, durée, cooldown anti-flood, arrêt immédiat, persistance/audit isolés par serveur et expiration périodique ; tests automatisés réussis. [ ] recette Discord isolée.

### 4. Administration Discord First
- [x] `/panel` : navigation par catégories tirées du catalogue slash partagé, accès propriétaire/Gérer le serveur et états des modules configurables; tests de refus d’accès et rendu catalogue. Recette Gateway à faire.
- [x] Première tranche `/setup`: sélecteur, modales, aperçu, brouillon SQLite conservé 15 minutes et application explicite ; recette Gateway à faire.
- [ ] Étendre la configuration à tous les modules.
- [ ] Prochaine tranche `/setup` : ajouter le quota de laisses DOG configurable par guild, après raccordement explicite du réglage au service DOG; tests de parsing, isolation et application du brouillon. Puis étendre LOCKNAME et WAOUF aux seuls paramètres déjà consommés par leurs runtimes.
- [x] Retrouver un aperçu `/setup` expiré pendant 7 jours, privé à l’auteur et à la guild; réactiver 15 minutes avec contrôle de conflit et revalidation des permissions/références avant application. Recette Gateway encore à faire.
- [ ] Catalogue central pour commandes slash, préfixées et panneaux ; chaque entrée doit être raccordée à un service réel.
- [ ] Tester isolation des paramètres, vérification d’accès et opérations sensibles par guild.

### 5. Systèmes PND
- [x] Inventaire de référence des fonctions V5 effectué; étendre les lacunes en réutilisant les services existants.
- [x] Première tranche Métiers : choix/status, progression indépendante par métier et guild, bonus plafonné relié à `/work`, tests SQLite temporaires et documentation. [ ] recette Discord isolée.
- [x] Première tranche Missions quotidiennes : `/job mission status|claim` et préfixe `=mission`, objectifs alimentés par les réussites `/work`, transferts et achats boutique, récompense atomique et isolation guild/membre. [ ] recette Discord isolée.
- [x] Contrats communautaires : escrow PND, attribution, soumission et validation auteur transactionnelles, tests temporaires; recette Discord à faire.
- [x] Marché de rôles boutique : annonces, transfert et règlement compensé, tests temporaires; recette Discord à faire.
- [x] Enchères : escrow de l’offre haute, remboursement des surenchères, échéance et worker de règlement, tests temporaires; recette Discord à faire.
- [ ] Compléter économie et antifraude ; communauté, jeux, profils et événements.
- [x] Modération — dossiers uniques pour warn/mute/unmute/kick/ban, `/warnings` affiche l’historique; écriture warning+dossier transactionnelle, lectures isolées par guild/membre.
- [x] Ajouter les appels de sanctions warn/mute/kick/ban, une seule demande sous 7 jours, boutons DM et `/warnings`, revue isolée par rôle de source au hub; tests unitaires et persistance SQLite. L’acceptation n’annule aucune sanction automatiquement. [ ] recette Discord.
- [x] Anti-spam/mentions : configuration Discord `/setup` et panneau, seuils bornés, suppression du message de flood, timeout avec vérifications natives; WHITELIST est exemptée par guild sans droits supplémentaires. Tests de politique/settings/setup et runtime simulé.
- [x] GuildGuard anti-raid fail-safe : une rafale seule ne kick pas les comptes établis; l’action automatique pendant la rafale est bornée au seuil d’âge configuré, tandis que le confinement explicite garde son comportement. Tests déterministes.
- [ ] Compléter quarantaine, anti-raid/mention, staff, vocal et intégrations IA sans sanction automatique par IA.
- [ ] Développer les systèmes avancés acceptés par petits modules testables et additifs.

### 6. MZ Stream Center
- [ ] Définir stockage, rôles, logs et paramètres dédiés MZ ; vérifier les API officielles Twitch, YouTube, Kick et OBS.
- [ ] Ajouter notifications/planning, points MZ, récompenses viewers et commandes Discord après validation des droits/API.
- [ ] Garder les identifiants MZ en configuration ; ne pas l’activer avant validation humaine.

### 7. Validation finale
- [ ] Exécuter tests, lint, typecheck et build ; traiter les erreurs préexistantes sans masquer les échecs.
- [ ] Vérifier distribution téléchargeable par allowlist, interfaces et commandes ; effectuer recette PND puis revue MZ.
- [ ] Préparer les notes de mise en service. Déploiement Oracle/VPS et activation réelle nécessitent une validation humaine.

## Méthode de suivi

Chaque lot doit fournir tests exacts, résultats et limites, mise à jour de `PND_ASSIST_PLUS_STATUS.md` et entrée `PND_ASSIST_PLUS_CHANGELOG.md`, puis un commit local réversible. Ne marquer une fonction terminée qu’après ses preuves automatisées et, quand Discord est impliqué, sa recette isolée.

## Reprise après point d’arrêt

```bash
cd /home/randoinryan/her-v5-build
source /home/randoinryan/.config/nvm/nvm.sh
nvm use 24.22.2
git status --short
git log -6 --oneline
```

Commencer par lire `AGENTS.md`, `PND_ASSIST_PLUS_STATUS.md` et la section `/setup` de ce plan. Inspecter uniquement les réglages DOG existants et leurs consommateurs avant toute modification. Après le lot, lancer les tests ciblés setup/DOG, mettre à jour statut et changelog, puis créer un commit local.

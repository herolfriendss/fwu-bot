# FWU — 5 bots, préfixes, quotas partagés (24/11/2026)

## 1. Qui fait quoi

| Bot | Préfixe | Commandes |
|---|---|---|
| **FWU** | slash uniquement | `/tempmute`, `/unmute`, `/warn`, `/warnings`, `/sanction`, `/sanction-type`, `/quota`, `/embed`, `/reglement`, `/screening`, `/aide`, `/status` |
| **GUARD** | `+` | `+ban`, `+unban`, `+kick`, `+blacklist`, `+purge` (`+nettoyer`), `+slowmode`, `+lock`, `+unlock`, `+guardian-review`, `+verification` ; en slash : `/ban`, `/kick`, `/blacklist`, `/guildguard`, `/verify`… |
| **FDPDLAVOC** | `;` | musique et radio, `;pv`, `;access`, `;unaccess`, `;voc`, `;demandevocal`, **`;mv`**, **`;accessall`** |
| **SUCK ME** | `=` | SYS+, rôles, DOG, MENOTTE, WAKEUP, LOCKNAME, Anti-Move, automatisations, webhooks, dmall ; **venues de FWU** : tickets, candidatures, sondage, IA, live, AFK, social (profil, bio, rep…), giveaways, événements ; commandes personnalisées du site |
| **LE FISC** | `-` | économie, casino ; **venus de FWU** : dice, coinflip, trivia, cartes (card, cards, pack, trade) |

- La carte exacte est dans `src/lib/bot-profiles.ts` (un test refuse qu'une commande appartienne à deux bots).
- **Une commande n'existe que sur son bot.** Chaque bot retire de son application Discord les commandes des autres ; `=ban` ou `+play` ne font rien. L'ancienne reprise des commandes par FWU quand un bot est arrêté est supprimée (la reprise des **événements** — logs, anti-spam, blacklist à l'arrivée — reste).
- `/mute` est remplacée par `/tempmute` (retirée automatiquement de toutes les applications).
- Préfixes : `PND_DATA_DIR/bots.json` (même fichier pour les 5 bots ; modèle : `bot/config/bots.example.json`). Valeurs vérifiées au démarrage : 1 à 3 symboles, tous différents, aucun préfixe qui commence comme un autre ; FWU sans préfixe.

## 2. Base centrale (PostgreSQL)

- Sur le VPS Oracle, installée par `sudo bash deploy/oracle/install-shared-db.sh` (écoute locale, mot de passe aléatoire écrit seulement dans `bot/.env`).
- Connexion : `SHARED_DATABASE_URL` (+ `SHARED_DATABASE_SSL=require` si la base est sur une autre machine). Aucune valeur dans le code.
- Les tables sont créées par les bots au démarrage : migrations `bot/shared/migrations/NNN_*.sql`, appliquées une seule fois, sous verrou (les 5 bots peuvent démarrer ensemble).
- L'économie et les modules historiques restent dans le SQLite partagé (`PND_DATA_DIR/economy.sqlite`).

| Table | Contenu |
|---|---|
| `schema_migrations` | migrations appliquées |
| `role_tiers` | rôle Discord → palier (0, 1, 5, 10, 50, 70, 80, 100) |
| `sanction_types` | sanctions prédéfinies de `/tempmute` (nom, durée), par serveur |
| `sanctions` | historique complet : modérateur, cible, action, sanction, motif, durée, bot, date |
| `quotas` | commande × palier → nombre max (NULL = illimité, 0 = interdit) et fenêtre ; `guild_id = '*'` = valeur par défaut |
| `quota_usage` | un enregistrement par usage (fenêtre glissante) ; `refunded` si l'action Discord a échoué |
| `quota_exemptions` | exemptions par ID utilisateur |
| `bot_whitelist` | bots qui outrepassent les quotas |
| `command_usage` | journal des commandes (ok, refusée, quota, erreur, base injoignable) |
| `quota_violations` | dépassements de quota |
| `config_changes` | toute modification de configuration : qui, quoi, avant, après |
| `embeds`, `rules_drafts` | embeds gérés par FWU ; brouillons de règlement (brouillon → validé → publié) |
| `screening_config`, `screening_acceptances` | écran d'adhésion et preuves d'acceptation |
| `guild_bootstrap` | initialisations faites une fois par serveur (sanctions par défaut) |

## 3. Paliers et quotas

- Palier d'un membre : l'owner (`PND_OWNER_DISCORD_ID`) est toujours **0 %** ; sinon le plus fort de ses rôles, d'après `/quota palier` ou, à défaut, le nom du rôle (« 10% », « 10 % Modérateur »…).
- 70 %, 80 %, 100 % et membres sans palier : aucune commande de modération.
- Commandes à quota (tous bots) : `tempmute`, `unmute`, `warn`, `kick`, `ban`, `unban`, `blacklist`, `mv`.

| Palier | tempmute | kick | ban | warn | unmute | unban | blacklist | mv |
|---|---|---|---|---|---|---|---|---|
| 50 % | 2 / 30 min | 1 / j | 0 | 3 / 30 min | 4 / 30 min | 0 | 0 | 5 / 10 min |
| 10 % | 4 / 30 min | 2 / j | 1 / j | 6 / 30 min | 8 / 30 min | 1 / j | 0 | 10 / 10 min |
| 5 % | 8 / 30 min | 4 / j | 2 / j | 12 / 30 min | 16 / 30 min | 2 / j | 1 / j | 20 / 10 min |
| 1 % | 15 / 30 min | 8 / j | 4 / j | 20 / 30 min | 30 / 30 min | 4 / j | 4 / j | 40 / 10 min |
| 0 %, exemptés, bots whitelistés | illimité | | | | | | | |

Les colonnes tempmute, kick et ban sont celles du cahier des charges ; les autres sont des valeurs par défaut proposées, modifiables avec `/quota definir`.

- **Atomicité** : chaque (serveur, membre, commande) est sérialisé par un verrou transactionnel PostgreSQL ; l'heure de référence est celle de la base. 30 commandes simultanées de deux bots ne dépassent jamais la limite (testé).
- Ordre d'une sanction : hiérarchie (aucun quota consommé si refus) → quota → action Discord (usage rendu si Discord refuse) → historique, MP, Logs Hub.
- Refus : message avec la limite et le temps restant (« Réessaie dans 12 min »), dépassement journalisé (base + Logs Hub).
- **Base injoignable** : commandes à quota refusées (« base centrale injoignable »), sauf pour l'owner ; reconnexion automatique (1 s → 60 s) ; les journaux sont gardés dans `PND_DATA_DIR/shared-log-outbox.jsonl` (10 000 lignes max) et renvoyés à la reconnexion.
- `/quota definir|reinitialiser|palier|exemption …|bot …` : **owner uniquement**, effet immédiat sur les 5 bots, journalisé dans `config_changes` et le Logs Hub. `/quota voir` et `/quota journal` pour consulter.

## 4. Fonctions FWU

- `/tempmute membre sanction [raison]` : sanction choisie dans la liste (autocomplétion), durée appliquée automatiquement. Types par défaut : Propos déplacés 10 min, Insultes légères 15 min, Insultes graves 30 min, Discrimination 1 h. Gestion : `/sanction-type` (admins, palier 5 % ou plus).
- `/sanction membre [page]` : historique complet, tous bots.
- `/embed` : création et modification par formulaire, champs, image, miniature, publication, mise à jour en place du message publié, import d'un embed déjà publié par FWU.
- `/reglement generer` : règlement généré par Claude (`claude-opus-5-5`, sortie JSON structurée), contrôle local des doublons (régénération automatique une fois), aperçu avec boutons Valider / Régénérer / Refuser — **rien n'est publié sans validation d'un admin** — puis `/reglement publier`. Clé : `ANTHROPIC_API_KEY`.
- `/screening configurer` : règlement validé + bouton « J'accepte » qui donne le rôle d'accès (acceptation enregistrée). `/screening synchroniser` tente le Membership Screening natif ; Discord ne documente pas cette fonction pour les bots et la refuse en général : le bot affiche alors les règles à coller dans les paramètres du serveur.

## 5. Bugs corrigés

- **AFK** : `/afk` était la 105e commande de FWU, au-delà de la limite Discord de 100 : jamais enregistrée. `=afk` était bloquée par la décision « slash uniquement ». Désormais `/afk` et `=afk` sont sur SUCK ME (45 commandes). L'AFK reste réservé à l'owner, aux SYS+ et aux ADMIN+ (règle existante).
- **Laisse** : le bot exigeait que la personne en laisse ait elle-même « Se connecter » sur le salon du maître : impossible de la suivre dans un vocal verrouillé. Seul le bot a besoin des permissions (Discord). Ajouts : erreur Discord absorbée, anti-boucle (6 déplacements par minute et par membre), salon plein géré (le bot passe outre comme Discord l'autorise).
- **Démarrage simultané** : deux bots démarrés en même temps sur une base SQLite à mettre à jour pouvaient planter (`duplicate column name`). Corrigé.

## 6. Validation sur Discord (serveur et bots de test, jamais les tokens de production)

1. `install-shared-db.sh`, redémarrer FWU, vérifier `shared_db_up` dans le statut du site.
2. Rôles « 50% », « 10% »… sur des comptes de test ; `/quota paliers`.
3. `/tempmute` ×3 avec un 50 % : 2 succès, 3e refusé avec délai ; `/sanction` affiche les deux.
4. `+kick` avec un 50 % depuis GUARD puis `/tempmute` depuis FWU : compteurs indépendants par commande, partagés entre bots (`+kick` ×2 → refus).
5. `/quota definir tempmute 50 1 10m` : effet immédiat ; `/quota journal` montre avant/après.
6. Arrêter PostgreSQL : `/tempmute` refusé proprement ; redémarrer : reprise sans redémarrer les bots.
7. `;mv @x` / `;mv ID` / ID invalide / cible hors vocal ; `;accessall` puis verrouiller le salon : les membres reviennent.
8. DOG : maître dans un vocal privé verrouillé → la personne suit ; `=undog` → plus de suivi.
9. `=afk on` puis `=afk off` (SUCK ME), `/afk on|off`.
10. `/reglement generer` → Valider → `/reglement publier` ; `/screening configurer` avec un compte neuf.

## 7. Tests automatisés

```bash
cd bot && SHARED_DATABASE_URL_TEST=postgres://… npm test
```

Sans `SHARED_DATABASE_URL_TEST`, les tests qui ont besoin de PostgreSQL sont ignorés. Chaque exécution crée et supprime son propre schéma.

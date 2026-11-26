# FWU V2 — avancement

Branche : `claude/festive-ramanujan-rn1dzs` (partie de `claude/epic-curie-dg0bud` @ `048d53b`, avance rapide sans réécriture).
Vérification complète : `scripts/verify-all.sh` (les 7 commandes de la section 4).

## Base de référence (avant toute modification, 26/11/2026)

| Commande | Résultat |
|---|---|
| `npm --prefix bot test` | 1 039 tests, 1 013 réussis, 0 échec, 26 ignorés |
| `npm --prefix bot run smoke` | 2 712 exécutions, 0 anomalie |
| `npm --prefix bot run audit:commands` | valide, 129 définitions |
| `npm --prefix bot run audit:replies` | valide, 0 réponse dangereuse |
| `npx vitest run` | 41 fichiers, 277 tests réussis |
| `npx tsc --noEmit` | 0 erreur |
| `npx eslint .` | 0 erreur, 6 avertissements (préexistants, `src/components/ui`) |

Environnement : Node 22.23 (le dépôt annonce Node ≥ 24 ; tout passe néanmoins).

## Tâches

| Tâche | État | Résultat de la vérification |
|---|---|---|
| 0 — Carte, base verte, failles | fait | 1 043 tests (1 017 réussis, 26 ignorés), smoke 2 712/0, vitest 277, tsc/eslint OK |
| 1 — Couche de réponses centrale | fait | 1 057 tests (1 031 réussis, 26 ignorés), smoke 2 712/0, vitest 277, tsc/eslint OK |

### Tâche 1 — couche de réponses (`bot/reply-layer.js`)

- Installée une fois pour toutes dans `index.js` : `installReplyLayer` sur chaque interaction (reply, editReply,
  followUp, update, deferReply) et `installMessageReplyLayer` sur chaque commande à préfixe du bot propriétaire.
  Les ≈480 réponses des 57 fichiers passent donc par elle sans retouche individuelle (le comportement métier ne change pas).
- `shapeReply` décide : **normal** (public, embed couleur/icône du bot, titre ✅/⛔/⚠️/ℹ️), **sensible**
  (`SENSITIVE_ACTIONS` : ban, kick, tempmute, warn, blacklist add, quarantaine ajouter, sanction, blr poser/lever →
  « 🚫 @membre est blacklisté » + bouton « 📁 Voir le dossier », réponse privée au staff, dossier en base `reply_dossiers`, 90 j),
  **erreur** (public, supprimé après 10 s : `deleteReply` / suppression du message du bot), **privé** (`PRIVATE_COMMANDS`,
  secrets détectés, marqueur `visibility: "private"`).
- Une édition texte n'écrase jamais un panneau déjà affiché ; les boutons et menus gardent la visibilité demandée.
- Bouton « En savoir plus » prêt (`enableLearnMore`), masqué jusqu'au guide (tâche 5).
- Tests : `reply-layer.test.js` (12), `interaction-reply-audit.test.js` (échoue si une commande sensible montre ses détails ou si une réponse reste en texte brut).
| 2 — Refonte des logs | partiel (voir ci-dessous) | 1 069 tests (1 043 réussis, 26 ignorés), smoke 2 734/0, vitest 277, tsc/eslint OK |

### Tâche 2 — logs typés

Fait :
- `bot/log-events.js` : événements typés (`category`, `action`, `severity`, acteur, cible, dossier), format unique
  (acteur, action, cible, dossier, lien ; couleur par bot et par gravité), dossiers numérotés par serveur (`log_cases`),
  déduplication 60 s, copie en base de **tous** les logs (`log_archive`, y compris les anciens appels non typés),
  recherche, chronologie, purge selon la conservation, résumé quotidien/hebdomadaire (`startLogMaintenance`).
- Alertes : `critical` ou actions graves (raid, tentative de rang sur un BLR, anti-nuke, dérive de permissions, bot ajouté,
  webhook, token…) → salon `logs-alertes` (facultatif : repli sur `logs-securite`) + mention du rôle de garde. L'anti-nuke émet déjà son alerte typée.
- Routage par catégorie : `sendCentralLog`/`sendToLogsHub` lisent la catégorie (option ou `systemLogEmbed({ category })`),
  transportée par le relais. Tous les appels des modules déclarent leur catégorie (test `logs-coverage.test.js`).
- File durable : un log du bot principal que le hub n'a pas pu recevoir est remis en file (3 essais, puis compté perdu) ;
  compteur des logs perdus dans `/status` et `/logs statut`.
- Configuration en base (`bot/logs-config.js`, `/logs hub|source-ajouter|source-activer|source-retirer|alertes|conservation|resume`, OWNER) :
  hub et sources lus en base → variables d'environnement → valeurs historiques (migration sans perte). Un jeu de salons
  généré par source (fin du jeu « MZ » recopié) ; MZ ne peut pas être activé depuis `/logs`.
- `/logs statut|rechercher|chronologie`, `/dossier <numéro>` (staff), préfixes `=logs`, `=dossier` (SUCK ME ; réponse en MP).
- Correction : chaque sanction apparaissait deux fois dans le hub (`moderation-actions.js` envoyait au hub en plus de `sendCentralLog`).

Reste (partiel) :
- Le journal d'audit générique d'`index.js` (`auditLog`, titres variables) utilise encore le routage par titre : il ne pourra
  être supprimé qu'après typage de ses ≈40 appelants.
- Les modules émettent encore des embeds libres via `systemLogEmbed` (catégorie typée, mais pas encore action/gravité/dossier) ;
  les nouvelles fonctions (BLR, piège, mode raid…) utilisent `logEvent`.
| Demande de l'owner : thème noir et blanc | fait | 1 072 tests (1 046 réussis, 26 ignorés), smoke 2 734/0, vitest 277, tsc/eslint OK |

### Thème noir et blanc (`bot/monochrome-theme.js`)

Crochet unique sur `MessagePayload.resolveBody` (discord.js), installé au démarrage dans `index.js` : **tout** message
sortant des 6 bots (réponses, panneaux, logs, éditions, webhooks) a ses couleurs d'embed converties en gris de même
luminance (un embed sans couleur prend le blanc cassé du thème) et ses boutons bleus/verts/rouges passés en gris.
La couche de réponses et les journaux typés utilisent directement une palette de gris (succès blanc → refus noir).
Non modifié : images (bannières GIF, cartes, avatars), emojis colorés, site/tableau de bord.
| 3 — BLR et garde « consciente de la personne » | fait | 1 083 tests (1 057 réussis, 26 ignorés), smoke 2 742/0, vitest 277, tsc/eslint OK |

### Tâche 3 — BLR

- `bot/blr.js` : état persistant (`blr_state` : raison, auteur, date, expiration, rôles retirés, dossier), configuration
  par serveur (`blr_config` : rôle BLR, rôle membre), décisions pures (rôles autorisés : @everyone, membre, BLR, rôles gérés).
- `bot/blr-shield.js` : crochet discord.js (`GuildMemberRoleManager.add`, `GuildMemberManager.addRole`, `GuildMemberManager.edit`)
  → **aucun chemin du bot** ne peut donner un rôle de trop à un BLR (commandes, rankall, boutique, niveaux, réactions, CAPTCHA,
  rôle automatique, automatisation, anniversaire, couleur, restaurations). Erreur `BLR_PROTECTED` affichée comme un refus.
- `role-grant-guard.js` : option `targetId` (refus BLR même pour l'OWNER) ; `=rank`/`/rank` la passent ; rankall ignore les BLR
  dans le plan et pendant le lot ; fin de quarantaine filtrée (`filterRolesForBlr`).
- `bot/blr-commands.js` : `/blr poser|lever|liste|configurer` et `=blr …` (SUCK ME), OWNER + paliers 0/1 % ; cible jamais OWNER,
  propriétaire ou bot ; hiérarchie centrale (`blr poser/lever` dans `HIERARCHY_TARGETS`) ; dossier et log typés ; réponse publique minimale.
- Application réactive (SUCK ME) : `guildMemberUpdate` retire le rôle en trop, cherche l'auteur dans le journal d'audit et envoie
  une alerte `blr_grant_attempt` (salon d'alertes, aucune sanction automatique) ; anti-boucle 5 corrections/min/membre ;
  balayage au démarrage puis toutes les 10 min (BLR expirés levés sans restauration) ; retour d'un membre BLR → état remis.
| 4 — Anti-raid et protections | fait (CAPTCHA en mode raid : partiel) | 1 089 tests (1 063 réussis, 26 ignorés), smoke 2 760/0, vitest 277, tsc/eslint OK |

### Tâche 4 — anti-raid (`bot/guard/raid-protection.js`, `bot/guard/raid-commands.js`, GUARD)

- **Piège** : `/piege configurer|retirer|liste` (+ `+piege`), plusieurs salons appâts. Un non-exempté (staff, SYS+, ADMIN+,
  WHITELIST, bots, OWNER, propriétaire exemptés) qui y écrit passe en BLR (pose automatique), ses messages de la dernière heure
  sont supprimés (15 salons au plus), alerte typée `trap_caught` avec bouton « 🕊️ Pardon » (staff du serveur source, y compris
  depuis le hub) → BLR levé avec restauration filtrée. L'ancien piège `/bouclier piege` reste disponible.
- **Mode raid** : détection d'afflux (`/raid seuils`, défaut 10 arrivées / 30 s), invitations fermées (`guild.disableInvites`),
  comptes récents mis en quarantaine par GuildGuard pendant le mode raid, alerte `raid_on`, `/raid on|off|etat` et `+raid on/off`,
  sortie automatique après la période calme (mode automatique uniquement).
- **Anti-nuke** : le plafond par personne et par fenêtre (suppressions de rôles/salons, bans, exclusions, webhooks) avec retrait des
  rôles dangereux existait déjà (`guard/anti-nuke.js`, réglable par `/antinuke`) ; il émet maintenant une alerte typée.
- **Dérive de permissions** (`roleUpdate`), **bot ajouté**, **webhook créé hors écosystème** : alertes typées avec l'auteur du
  journal d'audit (signalement, pas de blocage automatique).
- **Token de bot** posté : message supprimé, alerte (le token n'est jamais recopié).
- **A2F** : alerte au démarrage si la double authentification n'est pas exigée.
- `/scan` (+ `+scan`) : score /100 et constats (permissions de @everyone, rôles Admin, bots tiers Admin, A2F, niveau de vérification…).
- `/panic` (+ `+panic`) : verrouillage existant (`startLockdown`) + mode raid manuel.
- Partiel : le CAPTCHA n'est pas encore rendu obligatoire en mode raid (seule la quarantaine des comptes récents s'applique) ;
  `isRaidActive` est exposé pour la refonte du panneau de vérification (tâche 8).
| 5 — Guide des permissions | fait | 1 093 tests (1 067 réussis, 26 ignorés), smoke 2 768/0, vitest 277, tsc/eslint OK |

### Tâche 5 — guide (`bot/permission-guide.js`, SUCK ME)

- Embeds générés depuis `permission-matrix.js`, `TIER_LABELS`, les quotas exacts (`listQuotas`), les types de tempmute et les rôles
  SYS+/ADMIN+/WHITELIST ; « Mis à jour le … » ; réédition sur place quand le contenu change (contrôle toutes les 30 min, empreinte du contenu).
- Salon public : rangs, paliers et quotas exacts, SYS+/ADMIN+/WHITELIST, sanctions (warn, tempmute + durées, kick, ban, blacklist, BLR, DOG,
  menottes, quarantaine), vocal privé et rôle perso. Salon staff réservé au rôle choisi (`/guide configurer public staff role_staff`) : matrice
  complète, quotas, procédures.
- `/guide voir` (menu de sections), `/guide publier`, `/pourquoi commande`, `=guide`, `=pourquoi` ; le bouton « En savoir plus » des refus est
  activé (`guide:why:<commande>` → explication privée, sur les 6 bots).
- Test : le guide cite tous les rangs de la matrice, tous les paliers et toutes les sanctions sensibles ou à dossier du code.
| 6 — Vocal | fait | 1 103 tests (1 077 réussis, 26 ignorés), smoke 2 804/0, vitest 277, tsc/eslint OK |

### Tâche 6 — vocal

- **DOG (cause trouvée et corrigée, `dog-commands.js`)** : (1) au-delà de 6 déplacements par minute, le suivi s'arrêtait sans nouvel
  essai — la personne restait derrière jusqu'au prochain mouvement du maître ; un nouvel essai est désormais programmé à la fin de la
  fenêtre ; (2) une erreur passagère de Discord (limite de débit, 5xx) n'était jamais retentée → un nouvel essai ; (3) la permission
  « Déplacer des membres » n'était pas vérifiée sur le salon du maître et tous les échecs étaient silencieux → vérifiée, cause comptée
  (`dog_voice_permission`, `dog_voice_rate_limited`, `dog_voice_discord_error` dans le diagnostic). À vérifier en staging : que SUCK ME a
  bien « Déplacer des membres » sur les salons concernés (c'est lui qui déplace).
- **WakeUp** : un seul MP au début, retour au salon d'origine à la fin, `=wakeup test @membre` / `/wakeup test:oui` simule le parcours
  sans déplacer ni consommer la recharge.
- **Vocal privé qui se réinitialise** (`voice-private-reset.js`) : départ de la personne qui l'a rendu privé → délai de grâce 45 s →
  permissions d'avant (même chemin que `=unpv`), retour annule ; au démarrage, aucun vocal privé abandonné ne reste bloqué.
  Les vocaux Join-to-Create ne sont pas touchés (leur propriété est déjà transférée).
- **Masse** (`voice-mass.js`, FDPDLAVOC, slash + `;`) : `mvall`, `mvrole`, `pull`, `swap`, `muteall`, `unmuteall`, `vclear` (aperçu +
  confirmation réservée à l'auteur, membres au-dessus et protégés Anti-Move ignorés, verrou de salon), `undo` (30 min).
- **`accessall`** : photo des permissions puis vocal ouvert à tous ; `=accessall annuler` / `/accessall annuler:oui` rend exactement
  les permissions d'avant. `/accessall` existe maintenant en slash.
| 7 — Rôles perso : couleur sans code | fait (page du site : non construite, voir ci-dessous) | 1 106 tests (1 080 réussis, 26 ignorés), smoke 2 804/0, vitest 277, tsc/eslint OK |

### Tâche 7 — couleurs (`bot/systems/sysplus/role-colors.js`)

- « Changer la couleur » ouvre un menu de 25 couleurs nommées ; le choix affiche un aperçu en direct (embed dans la vraie couleur,
  seule exception voulue au thème noir et blanc) et un bouton « Appliquer » ; « Couleur libre (#RRGGBB) » ouvre la saisie.
  Partout où une couleur se tape (`=rolepanel create Nom | rose`, `/rolepanel`, fenêtres de saisie), un nom de couleur est accepté.
  Toujours zéro permission, quota inchangé.
- Page du site avec sélecteur : **non construite**. Le site n'a qu'une session OWNER par mot de passe (`requireOwner`) ; une page pour
  les membres demanderait une connexion Discord des membres, la vérification de leur quota et de la propriété du rôle côté serveur,
  puis un relais vers le bot : ce n'est pas « simple à relier à l'authentification existante ».
| 8 — Vérification et règlement | fait | 1 110 tests (1 084 réussis, 26 ignorés), smoke 2 804/0, vitest 277, tsc/eslint OK |

### Tâche 8 — vérification et règlement

- `bot/verification-panel.js` : panneau refait (bannière « verification », nom du serveur au lieu de « PND », étapes ① règlement
  ② acceptation ③ CAPTCHA), message de bienvenue en MP à la fin, état consultable par le staff (`=verification etat @membre`),
  journal `verification_log` (réaction, CAPTCHA).
- **Mode raid** (complète la tâche 4) : la réaction n'attribue plus le rôle, le membre est mis « en attente du CAPTCHA » et reçoit
  les instructions ; le CAPTCHA réussi enregistre la vérification.
- `/reglement` (brouillon et publication) et `/screening` embellis : en-tête, icône du serveur, parties numérotées, bannière,
  pied de page clair ; flux brouillon → validation → publication inchangé.
| 9 — Préfixes et complétude | partiel (trous /setup et logs typés LE FISC restants) | 1 117 tests (1 091 réussis, 26 ignorés), smoke 2 804/0, vitest 277, tsc/eslint OK |

### Tâche 9 — préfixes et complétude

- Préfixe propre à chaque bot (réglage `bots.json`, inchangé). **FWU reste en slash uniquement** (décision 21 de `DECISIONS.md`).
- `bot/prefix-slash-bridge.js` : toute commande slash d'un bot à préfixe répond aussi avec son préfixe (`+raid on`, `;mvall #a #b`,
  `-impots …`, `=blr poser @m duree:7j raison…`) : sous-commandes et options lues dans le catalogue, `nom:valeur` possible, texte libre
  en fin de ligne ; l'interaction simulée suit le même chemin que le slash (gel, hiérarchie, couche de réponses) ; réponses privées en
  MP ; formulaire → renvoi vers la commande slash. `BRIDGED_PREFIX_COMMANDS` / `isBridgedPrefixCommand` dans `src/lib/bot-profiles.ts`.
- `slash-parity.test.js` vérifie bot par bot, avec son préfixe, que chaque commande slash répond en préfixe sur ce bot seulement.
- `docs/V2_COMPLETUDE.md` généré par `bot/scripts/completeness-matrix.mjs` : préfixe 135/135 (hors FWU), aide 145/145.
  Trous restants signalés par la matrice : réglages dans `/setup` (6 commandes sur 145 y ont un réglage), journaux typés absents de la
  plupart des commandes de LE FISC et d'une partie de SUCK ME, ~30 commandes sans test qui les cite.
| 10 — Présence riche | fait | 1 119 tests (1 093 réussis, 26 ignorés), smoke 2 810/0, vitest 277, tsc/eslint OK |

### Tâche 10 — présence (`bot/presence.js`)

- Statut qui réagit (contrôle toutes les 30 s, la rotation garde son rythme) : maintenance (tâche 12) > statut posé par `/presence` >
  GUARD « 🚨 Mode raid » (pastille « ne pas déranger ») > FDPDLAVOC « Écoute <titre en cours> » > LE FISC « 💰 Cagnotte : … ».
- Statuts saisonniers ajoutés à la rotation (fêtes de fin d'année, nouvel an, Saint-Valentin, Halloween, fête de la musique).
- `/presence definir|retirer|description` (SUCK ME, `=presence …` par le pont) : statut d'un des 6 bots sans fichier (table partagée),
  durée facultative ; description « À propos » appliquée par chaque bot avec son propre jeton.
- Limites Discord respectées : un texte, un type d'activité, une pastille — pas d'image ni de bouton.

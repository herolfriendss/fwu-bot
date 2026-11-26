> [!WARNING]
> **Recette historique de 1942.** Cette liste précède la répartition FWU multi-bots et ne constitue pas à elle seule la validation actuelle. Pour le staging FWU, couvre séparément FWU, GUARD, FDPDLAVOC, SUCK ME, LE FISC et Invest + (facultatif), avec les préfixes de [DECISIONS.md](DECISIONS.md). Ajoute obligatoirement les essais DAVE/audio de la PR #4. N'utilise jamais un token de production.

# 1942 — Recette sur serveur de test (liste unique à cocher)

Durée : environ 45 minutes. But : vérifier en vrai sur Discord ce que les tests automatiques ne peuvent pas prouver.

## Préparation (une fois)

1. Une **application Discord de test** (jamais le token de production) et un **serveur de test**, avec 2 comptes humains : toi et un compte secondaire « B ». Le rôle du bot doit être placé haut dans la hiérarchie.
2. Une copie du projet sur ton PC ou sur le VPS, **dans un autre dossier** que la production.
3. `bot/.env` de test : copie de `bot/.env.example` avec `DISCORD_TOKEN` du bot de test, `V4_ALLOWED_GUILD_IDS=<id du serveur de test>` et `PND_OWNER_DISCORD_ID=<ton id>`. Facultatif : `PND_TICKET_TRANSCRIPT_DAYS=7` pour tester les transcriptions.
4. Démarrage du bot de test :

```bash
npm --prefix bot ci && npm --prefix bot test && npm --prefix bot start
```

5. Dans le serveur de test : `/sysp role` pour définir un rôle SYS+, `/setup` pour les logs. Puis `/sysp diagnostic sante` : tout doit être 🟢 ou 🟠.

Coche chaque ligne. Si une ligne échoue, note l'heure et la commande, puis envoie-moi la sortie de `pm2 logs` ou de la console (sans les secrets).

## Commandes slash uniquement
- [ ] Taper `=play` : aucune exécution, un court message (effacé après 15 s) indique d'utiliser `/play`.
- [ ] `/verify reaction`, `/automation regles liste`, `/ia historique`, `/pv liste` répondent.

## Sécurité et propriétaire
- [ ] Le bot démarre. Avec `PND_OWNER_DISCORD_IDS=1,2` ajouté dans `bot/.env`, il **refuse** de démarrer (retirer ensuite cette ligne).
- [ ] `/sysp diagnostic matrice` correspond à ce que tu attends (qui peut faire quoi).
- [ ] `/sysp diagnostic acl` : rapport lisible ; aucune permission n'est modifiée.

## DOG / MENOTTE / WAKEUP
- [ ] B (sans rôle staff) ne peut pas utiliser `/dog` ni `/menotte` sur toi.
- [ ] `/dog` sur B : laisse posée ; B ne peut pas changer de pseudo ; `/undog` retire la laisse.
- [ ] `/menotte` sur B dans un vocal : B est ramené s'il change de salon ; `/unmenotte` le libère.
- [ ] `/wakeup B` (B en vocal) : B passe une fois par chaque salon public, reçoit un MP à chaque passage et termine dans le dernier salon. Les salons privés, d'attente, AFK et Owner sont sautés. Le bilan s'affiche dans **un seul** message édité.

## Anti-Move
- [ ] `/anti-moove config etat:on`, puis `/anti-moove proteger membre:B`. Avec le compte staff, déplace B : **il revient** dans son salon (log dans `logs-vocaux`).
- [ ] Une minute plus tard, déplace-le de nouveau : il revient encore.
- [ ] B change de salon lui-même : il **ne revient pas**.
- [ ] Déconnecte B : un log est publié, sans retour (normal).
- [ ] 4 déplacements en moins d'une minute : 3 retours, puis l'alerte « restauration suspendue ».

## PV / UNPV
- [ ] `/pv activer` dans un vocal : le salon devient privé. `/pv liste` l'affiche.
- [ ] Redémarre le bot, puis `/pv retirer` : les permissions d'origine sont restaurées.
- [ ] `/pv activer`, arrête le bot, retire à la main le refus de connexion de `@everyone`, redémarre le bot : le salon redevient privé.

## rankall
- [ ] `/rankall` sur un rôle **cosmétique** : un aperçu s'affiche → Confirmer → progression → bilan. Puis « Annuler l'attribution » : le rôle est retiré **seulement** à ceux qui l'ont reçu.
- [ ] `/rankall` sur un rôle avec Administrateur : refusé dès l'aperçu.
- [ ] B ne peut pas utiliser `/rankall`.

## Modération et logs
- [ ] `/warn B` : dossier créé (cette commande échouait à chaque fois avant).
- [ ] Bannir puis débannir un compte de test : deux logs dans `logs-sanctions`.
- [ ] Donner « Gérer les rôles » à `@everyone` sur un salon de test : alerte 🚨 dans `logs-securite`. Retirer ensuite cette permission.
- [ ] Modifier un message : log « Message modifié », sans le contenu.

## LOCKNAME
- [ ] `/lockname proteger B` : B ne peut plus changer de pseudo (cette commande **retirait** la protection avant). `/lockname liste`, puis `/lockname retirer B`.

## Économie, jeux, social
- [ ] `/coinflip 100` : résultat affiché, solde modifié (cette commande plantait avant).
- [ ] Avec le compte B : `/casino pause duree:24 heures`, puis `/coinflip 100` : refusé. L'auto-exclusion ne peut volontairement pas être annulée : elle expire seule après 24 h, et ce n'est que la base de test.
- [ ] `/pay` depuis un compte de moins de 7 jours : refusé, aucun PND ne bouge.
- [ ] `/rep donner B` : accepté ; un second `/rep donner B` dans la foulée est refusé ; `/rep historique B` affiche le point.
- [ ] `/profil` : la ligne « Badges » s'affiche.
- [ ] Giveaway de 1 minute avec 2 participants : gagnant annoncé, `/giveaway verifier` ✅, `/giveaway reroll` donne un autre gagnant.
- [ ] Marché : mettre un rôle en vente, l'acheter avec B, puis redémarrer le bot pendant l'achat (difficile, facultatif). Au redémarrage, l'achat est réglé une seule fois ou l'annonce est rouverte.

## Tickets
- [ ] Ouvrir un ticket avec B, puis `/ticket assign` (vers le staff) et `/ticket historique`.
- [ ] Fermer le ticket. Si `PND_TICKET_TRANSCRIPT_DAYS` est défini : `/ticket transcript <id>` renvoie le fichier en message éphémère.

## Vocal temporaire
- [ ] Créer un salon temporaire (Join-to-Create), arrêter le bot, quitter le salon, redémarrer le bot : le salon vide est supprimé.

## Santé et redémarrage
- [ ] `/sysp diagnostic sante` est 🟢 après 2 minutes.
- [ ] Retirer au bot la permission « Gérer les rôles » : une alerte 🩺 critique arrive en moins de 5 minutes. Remettre la permission : un message « rétablie » suit.

## Musique / radio (facultatif)
- [ ] Protocole complet dans `docs/recettes/musique-radio-discord.md`.

**Quand tout est coché : la version est prête pour la production (étape 4 de `MISE_EN_PRODUCTION.md`).**

## FWU V2 — points à tester à la main (bot et serveur de staging, jamais le jeton de production)

1. **Réponses** : une commande refusée (ex. `/ban` sur un membre au-dessus) affiche un refus public qui disparaît après 10 s, avec « En savoir plus » ; `/ban` réussi n'affiche que « 🚫 @membre a été banni » et « Voir le dossier » répond en privé au staff seulement.
2. **Thème** : embeds et boutons en noir et blanc sur les 6 bots ; seul l'aperçu de couleur d'un rôle perso est en couleur.
3. **Logs** : `/logs statut`, une sanction arrive une seule fois dans `logs-sanctions` avec un numéro de dossier ; `/dossier <n>` ; couper le hub puis le rétablir : le log arrive après reprise ; « logs perdus » visible dans `/status`.
4. **BLR** : `/blr configurer`, `/blr poser` (palier 1 %), puis tenter de donner un rôle au membre (à la main dans Discord, par un autre bot, par `=rank`, par rankall) → retiré aussitôt, alerte avec l'auteur ; départ/retour du membre → BLR remis ; `/blr lever restaurer:oui`.
5. **Piège** : `/piege configurer #appât`, un compte test y écrit → BLR, messages supprimés, alerte « Pardon » (cliquer depuis le hub) → rôles rendus.
6. **Mode raid** : `/raid seuils 3 30 5`, faire rejoindre 3 comptes → invitations fermées, comptes récents en quarantaine, panneau de vérification demande le CAPTCHA ; sortie automatique après 5 min de calme ; `/panic` puis `/bouclier deverrouiller` + `/raid off`.
7. **Alertes** : donner Administrateur à un rôle (dérive), ajouter un bot, créer un webhook, poster un faux token → alertes dans `logs-alertes` (ou `logs-securite`).
8. **Guide** : `/guide configurer`, modifier un quota → le guide se met à jour (≤ 30 min) ; `/pourquoi ban`.
9. **Vocal** : DOG — le maître change 8 fois de salon en 1 min → la personne en laisse revient au bout de la minute ; vocal privé — le propriétaire quitte → permissions d'avant après ~45 s, une coupure courte ne déclenche rien ; `=wakeup test @m` ; `;mvall`, `;undo`, `;accessall` puis `;accessall annuler`.
10. **Rôles perso** : « Changer la couleur » → menu de 25 couleurs, aperçu, « Appliquer ».
11. **Préfixes** : `+raid etat`, `;mvall #a #b`, `-impots …`, `=blr poser @m duree:7j raison` répondent ; la même commande avec le préfixe d'un autre bot ne fait rien.
12. **Présence** : GUARD passe en « 🚨 Mode raid » pendant un raid ; FDPDLAVOC affiche le titre en cours ; `/presence definir`.
13. **Stabilité** : `/stabilite commande-off casino` → refus clair sur le bot concerné ; `/stabilite maintenance-on bot:guard` → message de maintenance et statut « 🛠️ Maintenance ».

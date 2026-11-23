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

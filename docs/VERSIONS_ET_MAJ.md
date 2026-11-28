# Versions et `/maj`

`/maj lancer` n'installe **que ce qui est fusionné dans `main`**, sous forme de versions numérotées.
Aucune branche ne peut être choisie par une variable.

## Publier une version
1. Fusionner la PR dans `main` sur GitHub.
2. GitHub → **Releases** → **Draft a new release**.
3. **Tag** : la version suivante, par exemple `v1.0.0` (format `vX.Y.Z` obligatoire), **Target** : `main`.
4. **Publish release**.
5. Sur Discord : `/maj lancer`.

## Ce que fait `/maj lancer`
- Sans option : installe la dernière version publiée. Si elle est déjà installée, rien ne se passe (« Déjà à jour »).
- Tant qu'aucune version n'est publiée : installe `main`.
- Avec `version:v1.1.0` : installe cette version précise, pour **revenir en arrière** si la dernière pose problème.
- `/maj etat` affiche la version installée (`/home/opc/fwu-data/version-installee`).

## FWU V2 (`v2.0.0`)
- Nouveau nom du produit : **FWU V2**. Dans Discord, plus aucun « FWU » (embeds, messages, journal d'audit, descriptions de commandes) ; les bots dédiés signent de leur nom, le bot principal ne signe pas.
- Action demandée : si `PND_<BOT>_FOOTER` contient « FWU » dans `bot/.env` sur le VPS, retire-le ; ensuite `/maj lancer` pour que les descriptions de commandes soient renvoyées à Discord.
- Détail des corrections et de l'audit : `docs/AUDIT_ET_PROCHAINE_VERSION_2026-11-26.md`.

## Numéros
- `v1.0.1` : correctif. `v1.1.0` : nouvelle fonction. `v2.0.0` : changement qui demande une action (réglage, migration).

## Mise à jour automatique (FWU V2, 27/11/2026)

- Chaque jour à 8 h (heure de Paris), SUCK ME lance `fwu-auto-update.sh --auto`. Le script compare le commit de `main` (ou de la
  dernière version publiée) avec `fwu-data/commit-installe` : s'il n'y a rien de nouveau, il s'arrête sans rien écrire ; sinon il fait
  exactement la même mise à jour que `/maj lancer` (journal `maj.log`, résultat annoncé sur Discord).
- Réglages dans le `.env` du VPS : `FWU_AUTO_UPDATE=off` pour la couper, `FWU_AUTO_UPDATE_HOUR=3` pour changer l'heure.
- Amorçage : le VPS doit installer une fois cette version (un `/maj lancer`) ; ensuite il se met à jour seul.
- Heure : entier de 0 à 23 écrit en chiffres ; toute autre valeur (`8h`, `24`, vide) garde 8 h. Le fuseau Europe/Paris suit
  l'heure d'été et d'hiver.
- Un seul contrôle par jour, même si SUCK ME redémarre : le jour du dernier contrôle est noté dans `fwu-data/auto-update-jour`,
  et une mise à jour terminée ou échouée le jour même (manuelle ou automatique) compte aussi. Un échec n'est pas relancé en boucle :
  nouvel essai le lendemain, ou `/maj lancer`.
- Rattrapage : si SUCK ME était arrêté à l'heure prévue, le contrôle a lieu à son redémarrage jusqu'à 4 h après (8 h → 11 h 59).
  Au-delà, rien avant le lendemain : pas de redémarrage général en pleine journée ou en soirée.
- En mode automatique, un contrôle sans nouveauté n'écrit rien ; un échec (jeton absent, GitHub injoignable, build, bot) est
  toujours écrit dans `maj.log` et visible dans `/maj etat`.
- Les bots dont le paquet n'a pas changé (même contenu, même empreinte `.fwu-paquet-empreinte`) et qui tournent ne sont ni
  réinstallés ni redémarrés : une mise à jour qui ne touche que le site ou FWU n'interrompt pas GUARD, FDPDLAVOC, LE FISC…

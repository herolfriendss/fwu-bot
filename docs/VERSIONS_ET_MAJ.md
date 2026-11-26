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

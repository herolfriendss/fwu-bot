> [!WARNING]
> **Document historique — phase 1942 monolithique.** Il ne décrit plus l'architecture FWU multi-bots actuelle. Ne copie pas les anciennes archives ni les commandes de ce document pour une mise à jour FWU.
> Pour le projet actuel, utilise d'abord [DEMARRAGE_FWU.md](DEMARRAGE_FWU.md), [MULTI_BOTS_FWU.md](MULTI_BOTS_FWU.md) et [DECISIONS.md](DECISIONS.md). Ce guide est conservé uniquement comme référence historique.

# 1942 — Mise en production : le minimum à faire

Tout ce qui pouvait être automatisé l'est. Il te reste 4 étapes, dont une seule à refaire à chaque mise à jour.

---

## Étape 1 — Une seule fois : vérifier les fichiers `.env` sur le VPS

Sur le VPS, dans `/home/opc/her-v5-production` :

```bash
cd /home/opc/her-v5-production
```

Compare tes fichiers avec les modèles fournis (`.env.example` et `bot/.env.example`). Les seuls points qui changent par rapport à avant :

- **`PND_OWNER_DISCORD_ID`** : un seul identifiant, identique dans `.env` et `bot/.env`.
- **`PND_COFOUNDER_DISCORD_IDS`** : peut rester vide. Il est ignoré par le bot. Il ne doit surtout pas contenir l'identifiant du propriétaire.
- **`PND_OWNER_DISCORD_IDS`** (au pluriel) : ne doit pas exister. Le bot refuserait de démarrer.
- Les nouvelles variables facultatives (antifraude, réputation, transcriptions…) ont toutes une valeur par défaut. **Tu n'as rien à ajouter.**

Le script de mise à jour vérifie tout cela et s'arrête avec un message clair si quelque chose ne va pas, **avant** de toucher à la production.

## Étape 2 — Une seule fois : migrations Supabase

Ce lot n'ajoute **aucune** migration Supabase. Les 7 fichiers de `supabase/migrations/` sont ceux d'avant (le plus récent : `202611200001_bot_settings_sync.sql`).

- S'ils sont déjà appliqués dans Supabase (cas normal si la V5 tourne déjà) : rien à faire.
- Sinon : applique-les dans l'éditeur SQL de Supabase, dans l'ordre des noms, après une sauvegarde.

## Étape 3 — Recommandé : recette sur le serveur de test

Suis `RECETTE_STAGING.md` (une liste de cases à cocher, environ 45 minutes). Les tests automatiques (515 tests du bot, 226 du site, et 2 190 appels simulés de toutes les commandes) ne remplacent pas un essai réel sur Discord : déplacements vocaux, messages privés, permissions réelles.

## Étape 4 — À chaque mise à jour : une commande

1. Copie l'archive `1942_*.zip` sur le VPS, par exemple dans `/home/opc/`.
2. Sors le script de mise à jour de l'archive (indispensable la première fois, car l'ancienne version ne l'a pas) :

```bash
cd /home/opc && python3 -c "import zipfile;open('update-1942.sh','wb').write(zipfile.ZipFile('1942_FINAL_20261123.zip').read('scripts/update-1942.sh'))"
```

3. Lance la mise à jour :

```bash
PND_SUPABASE_MIGRATIONS_APPLIED=YES bash /home/opc/update-1942.sh /home/opc/1942_FINAL_20261123.zip
```

Le script fait tout, dans cet ordre :

1. contrôles (archive valide, aucun secret dans l'archive, `.env` corrects) ;
2. extraction à côté de la production, copie de tes `.env` et de la base (bot arrêté quelques secondes) ;
3. bascule, puis installation, tests, banc d'essai des commandes, build et redémarrage PM2 ;
4. **retour automatique à l'ancienne version** si une étape échoue après la bascule.

L'ancienne version reste intacte dans `/home/opc/her-v5-production.prev-<date>`. Supprime-la après quelques jours de bon fonctionnement.

### Retour arrière manuel (si un problème apparaît plus tard)

```bash
bash /home/opc/her-v5-production/scripts/rollback-1942.sh /home/opc/her-v5-production.prev-<date>
```

### Après la mise à jour : vérifier en 30 secondes

```bash
pm2 status
```

```bash
pm2 logs her-v5-bot --lines 50 --nostream
```

Dans Discord, tape `/sysp diagnostic sante` : tout doit être 🟢. Une alerte 🟠 « Synchronisation site » est normale pendant la première minute.

---

## Ce qui change pour les membres (à annoncer)

- `/pay` : refusés pour les comptes Discord de moins de 7 jours ou arrivés depuis moins de 3 jours. Plafond de 50 000 PND et de 20 transferts par 24 h.
- `/rep donner` : mêmes conditions d'ancienneté, 5 points maximum par 24 h.
- Le pile ou face fonctionne à nouveau, et respecte l'auto-exclusion du casino.
- Les giveaways sont vérifiables (`/giveaway verifier`).

## Ce qui change pour le staff

- Nouveaux diagnostics (lecture seule) : `/sysp diagnostic acl | sante | logs-couverture | matrice | economie`.
- `/warn` fonctionne à nouveau (il échouait à chaque fois).
- `/lockname proteger` protège enfin le pseudo (il **retirait** la protection).
- Les bannissements apparaissent maintenant dans les logs. Les alertes 🚨 de `logs-securite` signalent une permission dangereuse nouvellement accordée.
- Tickets : `/ticket assign`, `/ticket historique`.

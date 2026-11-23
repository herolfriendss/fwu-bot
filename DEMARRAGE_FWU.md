# FWU — Mise en route sur le VPS Oracle (à faire dès que tu as le PC)

Durée : environ 30 minutes. Tout se fait dans un terminal connecté au VPS (`ssh opc@ADRESSE_DU_VPS`).
**Ne colle jamais un token dans une conversation** : seulement dans les fichiers `.env` du VPS.

## Les fichiers à envoyer sur le VPS

| Fichier | Contenu |
|---|---|
| `FWU_20261123.zip` | FWU : le bot actuel et le site |
| `FWU-GUARD.zip` | le bot GUARD |
| `FWU-FDPDLAVOC.zip` | le bot FDPDLAVOC |
| `FWU-SUCK-ME.zip` | le bot SUCK ME |
| `FWU-LE-FISC.zip` | le bot LE FISC |

Depuis ton PC, dans le dossier où tu les as téléchargés :

```bash
scp FWU_20261123.zip FWU-GUARD.zip FWU-FDPDLAVOC.zip FWU-SUCK-ME.zip FWU-LE-FISC.zip opc@ADRESSE_DU_VPS:/home/opc/
```

## 1. Mettre FWU à jour (10 min)

```bash
cd /home/opc && python3 -c "import zipfile;open('update-1942.sh','wb').write(zipfile.ZipFile('FWU_20261123.zip').read('FWU/scripts/update-1942.sh'))"
```

```bash
PND_SUPABASE_MIGRATIONS_APPLIED=YES bash /home/opc/update-1942.sh /home/opc/FWU_20261123.zip
```

Attends `✅ Mise à jour terminée`. En cas d'échec, l'ancienne version revient toute seule.

## 2. Dossier de données partagé (1 commande, une seule fois)

```bash
bash /home/opc/her-v5-production/scripts/fwu-donnees-partagees.sh
```

FWU s'arrête quelques secondes, sa base est sauvegardée puis déplacée dans `/home/opc/fwu-data`, où les 5 bots la partageront.

## 3. Installer chaque bot (2 min par bot)

**Avant**, dans le portail développeur Discord, pour chaque application : onglet **Bot**, active **Server Members Intent** et **Message Content Intent**, copie le token, et invite le bot sur le serveur.

Dézippe les 4 bots :

```bash
mkdir -p /home/opc/fwu-bots && cd /home/opc/fwu-bots && for z in GUARD FDPDLAVOC SUCK-ME LE-FISC; do unzip -oq /home/opc/FWU-$z.zip; done
```

Puis, **pour chaque bot** (exemple avec GUARD ; remplace `guard` par `fdpdlavoc`, `suckme` ou `fisc`) :

```bash
bash /home/opc/fwu-bots/fwu-guard/installer.sh
```

La première fois, il te demande le token :

```bash
nano /home/opc/fwu-bots/fwu-guard/.env
```

Remplace `COLLER_ICI_…` par le token, enregistre (`Ctrl+O`, `Entrée`, `Ctrl+X`), puis relance la même commande `installer.sh`.
Il installe, démarre, vérifie que le bot tient, puis synchronise FWU.

## 4. Dans Discord

- Paramètres du serveur → Rôles : place **SUCK ME** juste sous ton rôle, et **GUARD** au-dessus des membres qu'il modère.
- `/sysp diagnostic bots` : les 5 bots doivent être 🟢.
- Les commandes slash peuvent mettre jusqu'à 1 h à apparaître partout.

## Si un bot pose problème

```bash
pm2 logs fwu-guard --lines 50 --nostream
```

Arrêt d'urgence : `pm2 stop fwu-guard`. FWU reprend son travail en moins d'une minute, puis relance `bash /home/opc/her-v5-production/scripts/fwu-synchroniser.sh` pour qu'il récupère aussi les commandes.

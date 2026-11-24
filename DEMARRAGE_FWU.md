# FWU — Mise en route sur le VPS Oracle (à faire dès que tu as le PC)

## La méthode rapide (recommandée) : 2 actions

**Avant**, dans le portail développeur Discord, pour GUARD, FDPDLAVOC, SUCK ME et LE FISC : onglet **Bot**, active **Server Members Intent** et **Message Content Intent**, et invite le bot sur ton serveur.

1. Dézippe `FWU_INSTALLATION_COMPLETE.zip` sur ton PC.
2. Dans le dossier `FWU-installation` :
   - **Windows** : clic droit sur `ENVOYER-SUR-LE-VPS.ps1` → **Exécuter avec PowerShell** ;
   - **Mac / Linux** : `bash ENVOYER-SUR-LE-VPS.sh`.

   Il te demande l'adresse IP du VPS et ta clé SSH Oracle, envoie tout, puis lance `TOUT-INSTALLER.sh` sur le VPS, qui :
   - met FWU à jour (retour arrière automatique en cas d'échec) ;
   - crée le dossier de données partagé ;
   - installe les 4 bots : pour chacun, **colle le token et appuie sur Entrée** (rien ne s'affiche, c'est normal ; Entrée seule = passer ce bot) ;
   - affiche le résultat.

Déjà connecté au VPS ? Après avoir envoyé le dossier : `bash /home/opc/FWU-installation/TOUT-INSTALLER.sh`. Relançable sans risque (réponds `n` à la mise à jour de FWU si elle est déjà faite).

Ensuite, passe directement à l'étape **4. Dans Discord** plus bas.

## Tout mettre à jour (FWU + site + 4 bots) depuis le Chromebook

1. Télécharge le zip du projet sur GitHub (Code → Download ZIP) et mets-le dans « Fichiers Linux ».
2. Dans le terminal :

```bash
cd ~ && Z=$(ls -t ~/*main*.zip | head -n 1) && unzip -oq "$Z" && P=$(dirname "$(dirname "$(ls -td ~/*/scripts/package-fwu-bots.py | head -n 1)")") && bash "$P/scripts/installation/FWU-MAJ-COMPLETE.sh" opc@ADRESSE_DU_VPS
```

## Mettre à jour les 4 bots plus tard (FWU non touché)

Depuis le dossier `FWU-installation` sur ton ordinateur :

```bash
bash METTRE-A-JOUR-BOTS.sh opc@ADRESSE_DU_VPS
```

Les tokens sont conservés. À la fin, l'état des processus s'affiche, avec un avertissement si un ancien bot tourne encore.

---

## La méthode manuelle (détail des mêmes étapes)

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

La première fois, il te demande le token : colle-le et appuie sur Entrée (rien ne s'affiche, c'est normal). Il est enregistré dans le `.env` du bot, protégé.
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

# Sauvegardes quotidiennes

Le script `~/fwu-sauvegarde.sh` (posé par `/maj`) sauvegarde chaque nuit, **sans arrêter les bots** :
- `economy.sqlite` (économie, SYS+, whitelist, laisses…) ;
- la base centrale PostgreSQL (sanctions, quotas, journaux).

Il garde **3 jours sur le VPS** (le disque est presque plein) et **14 jours hors du VPS**.
Le résultat s'affiche dans `/sysp diagnostic bots`, et la surveillance prévient si une sauvegarde échoue.

## Installation (à taper sur le VPS, une seule fois)

### 1. La copie hors du VPS (recommandé : stockage objet Oracle, 20 Go gratuits)
1. Console Oracle → **Stockage** → **Buckets** → créer un bucket privé `fwu-sauvegardes`.
2. Installer rclone : `sudo dnf install -y rclone` (ou `curl https://rclone.org/install.sh | sudo bash`).
3. `rclone config` → `n` (nouveau) → nom `oracle` → type **Oracle Cloud Infrastructure Object Storage** → suivre les questions (région, compartiment, authentification « instance principal » ou clé d'API).
4. Chiffrer les copies : `rclone config` → `n` → nom `fwu` → type **crypt** → remote `oracle:fwu-sauvegardes` → choisir un mot de passe et **le noter hors du VPS** (sans lui, les copies sont illisibles).
5. Indiquer la destination au script : `echo "fwu:" > ~/fwu-data/.sauvegarde-distante`

Tout autre stockage géré par rclone marche aussi (Backblaze B2, Google Drive…). Garde le chiffrement `crypt` : les sauvegardes contiennent des données de membres.

### 2. L'heure de la sauvegarde (chaque nuit à 4 h 17)
```
(crontab -l 2>/dev/null; echo "17 4 * * * bash $HOME/fwu-sauvegarde.sh") | crontab -
```

### 3. Essai tout de suite
```
bash ~/fwu-sauvegarde.sh; cat ~/fwu-data/sauvegarde-status.json; tail -n 15 ~/fwu-data/sauvegarde.log
```
`"ok":true` et `"offsite":true` : tout va bien. `rclone ls fwu:` montre les copies distantes.

## Restaurer (seulement en cas de perte)
1. `pm2 stop all`
2. Récupérer une copie : `rclone copy fwu:AAAA-MM-JJTHHMMZ ~/restauration`
3. SQLite : `gunzip -c ~/restauration/economy.sqlite.gz > <dossier des données>/economy.sqlite`
4. Base centrale : `pg_restore --clean --no-owner -d "<SHARED_DATABASE_URL>" ~/restauration/base-centrale.dump`
5. `pm2 start all`

Demande de l'aide avant une restauration : elle remplace les données actuelles.

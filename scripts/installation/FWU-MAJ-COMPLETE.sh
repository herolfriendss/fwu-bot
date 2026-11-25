#!/usr/bin/env bash
# FWU — mise à jour complète depuis ton ordinateur (Chromebook/Linux/Mac) :
# FWU + le site, puis GUARD, FDPDLAVOC, SUCK ME et LE FISC.
#
#   1. Télécharge le zip GitHub du projet (bouton Code -> Download ZIP) dans tes fichiers Linux.
#   2. Dézippe-le, puis :   bash <dossier>/scripts/installation/FWU-MAJ-COMPLETE.sh opc@ADRESSE_DU_VPS
#
# Les tokens et les .env restent sur le VPS : rien n'est redemandé, rien n'est affiché.
# En cas d'échec de FWU, l'ancienne version revient toute seule.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TARGET="${1:-}"
[[ -n "$TARGET" ]] || read -rp "Adresse du VPS (ex. opc@1.2.3.4) : " TARGET
[[ -f "$REPO/bot/index.js" && -f "$REPO/scripts/update-1942.sh" ]] || { echo "Lance ce script depuis le dossier dézippé du projet."; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> 1/3 Préparation de l'archive FWU"
(cd "$(dirname "$REPO")" && python3 -I - "$(basename "$REPO")" "$WORK/FWU-maj.zip" <<'PY'
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
skip_dirs = {"node_modules", ".git", "livraison", ".output", "dist"}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in skip_dirs and not (base.endswith("bot") and d == "data")]
        for name in files:
            if name == ".env" or name.endswith((".sqlite", ".sqlite-wal", ".sqlite-shm")):
                continue
            path = os.path.join(base, name)
            z.write(path, os.path.join("FWU", os.path.relpath(path, root)))
PY
)
python3 "$REPO/scripts/package-fwu-bots.py" "$WORK/bots" >/dev/null
cp "$HERE/METTRE-A-JOUR-BOTS.sh" "$WORK/bots/"

echo "==> 2/3 Mise à jour de FWU et du site sur le VPS (10 à 30 min, ne ferme pas la fenêtre)"
ssh "$TARGET" "mkdir -p /home/opc/FWU-installation"
scp "$WORK/FWU-maj.zip" "$REPO/scripts/update-1942.sh" "$TARGET:/home/opc/FWU-installation/"
ssh -t "$TARGET" "NODE_OPTIONS=--max-old-space-size=2048 PND_SUPABASE_MIGRATIONS_APPLIED=YES bash /home/opc/FWU-installation/update-1942.sh /home/opc/FWU-installation/FWU-maj.zip"

echo "==> 3/3 Mise à jour des 4 bots"
BOTS_OK=1
bash "$WORK/bots/METTRE-A-JOUR-BOTS.sh" "$TARGET" || BOTS_OK=0

echo "==> Mise à jour depuis Discord (/maj) : installation"
scp "$HERE/fwu-auto-update.sh" "$TARGET:/home/opc/fwu-auto-update.sh"
ssh "$TARGET" "chmod 700 /home/opc/fwu-auto-update.sh && mkdir -p /home/opc/fwu-data"
if ssh "$TARGET" "test -s /home/opc/fwu-data/.github-token"; then
  echo "Jeton GitHub déjà présent sur le VPS : /maj lancer est prêt."
else
  cat <<'INFO'
Pour que /maj marche sans ordinateur, le VPS a besoin d'un jeton GitHub EN LECTURE SEULE :
  github.com → Settings → Developer settings → Fine-grained tokens → Generate new token
  Repository access : Only select repositories → her-v3-
  Permissions : Contents → Read-only (rien d'autre) · Expiration : 1 an
Colle-le ci-dessous (rien ne s'affiche, c'est normal). Entrée vide = plus tard.
INFO
  read -rsp "Jeton GitHub : " GH_TOKEN || GH_TOKEN=""
  echo
  if [[ -n "$GH_TOKEN" ]]; then
    printf '%s' "$GH_TOKEN" | ssh "$TARGET" "umask 077 && cat > /home/opc/fwu-data/.github-token && chmod 600 /home/opc/fwu-data/.github-token"
    unset GH_TOKEN
    echo "Jeton enregistré sur le VPS (fichier privé). Désormais : /maj lancer sur Discord."
  else
    echo "Jeton non fourni : /maj lancer marchera après la prochaine mise à jour depuis l'ordinateur."
  fi
fi

if [[ "$BOTS_OK" != 1 ]]; then
  echo
  echo "⚠️  Au moins un bot n'a pas redémarré (voir plus haut). FWU, lui, est à jour."
  exit 1
fi

cat <<'MSG'

✅ Tout est à jour. Dans Discord (ferme et rouvre l'appli pour voir les nouvelles commandes) :
  • /sysp diagnostic bots : les 5 doivent être 🟢
  • Prochaines mises à jour, même sans PC : /maj lancer (puis /maj etat)
  • GUARD : /antinuke etat · /automod etat
  • FWU : /niveau voir · /niveau succes (salons créés automatiquement)
  • LE FISC : /impots etat · /pret etat
  • SUCK ME : /staff liste · /roletemp · /annonce
  • FDPDLAVOC : /dj · /playlist · /effet
MSG

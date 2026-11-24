#!/usr/bin/env bash
# FWU — mise à jour faite par le VPS lui-même (déclenchée par /maj lancer sur Discord, ou à la main).
# Télécharge la dernière version du dépôt GitHub privé avec le jeton en lecture seule
# rangé dans /home/opc/fwu-data/.github-token (chmod 600), puis met à jour FWU, le site et les 4 bots.
# Journal : /home/opc/fwu-data/maj.log · état : /home/opc/fwu-data/maj-status.json
set -uo pipefail
H="${FWU_HOME:-/home/opc}"
DATA="$H/fwu-data"
TOKEN_FILE="$DATA/.github-token"
LOG="$DATA/maj.log"
STATUS="$DATA/maj-status.json"
REPO_SLUG="${FWU_REPO_SLUG:-herolfriendss/her-v3-}"
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

status() { printf '{"state":"%s","step":"%s","at":%s}\n' "$1" "$2" "$(date +%s)" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"; }

exec 9>"$DATA/maj.lock"
if ! flock -n 9; then echo "Une mise à jour est déjà en cours."; exit 3; fi
exec >>"$LOG" 2>&1
echo
echo "===== Mise à jour FWU du $(date '+%d/%m/%Y %H:%M:%S') ====="
fail() { echo "❌ $1"; status failed "$1"; exit 1; }

[[ -s "$TOKEN_FILE" ]] || fail "Aucun jeton GitHub sur le VPS (relance FWU-MAJ-COMPLETE.sh une fois depuis un ordinateur)."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

status running "Téléchargement depuis GitHub"
echo "==> Téléchargement"
# The token goes through curl's stdin config, never on the command line.
printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '\r\n' < "$TOKEN_FILE")" \
  | curl -fsSL -K - -H "Accept: application/vnd.github+json" -o "$WORK/src.zip" "https://api.github.com/repos/$REPO_SLUG/zipball/main" \
  || fail "Téléchargement impossible (jeton expiré ou réseau)."
mkdir "$WORK/src" && unzip -q "$WORK/src.zip" -d "$WORK/src" || fail "Archive GitHub illisible."
REPO="$(find "$WORK/src" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[[ -f "$REPO/bot/index.js" && -f "$REPO/scripts/update-1942.sh" ]] || fail "Archive incomplète."
echo "Version : $(basename "$REPO")"

status running "Préparation des paquets"
echo "==> Préparation"
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
) || fail "Préparation de FWU impossible."
python3 -I "$REPO/scripts/package-fwu-bots.py" "$WORK/bots" || fail "Préparation des bots impossible."
mkdir -p "$H/FWU-installation" "$H/fwu-bots"
cp "$WORK/FWU-maj.zip" "$REPO/scripts/update-1942.sh" "$H/FWU-installation/"
cp "$WORK"/bots/FWU-*.zip "$H/FWU-installation/"
# Keep this updater itself current for the next run.
install -m 700 "$REPO/scripts/installation/fwu-auto-update.sh" "$H/fwu-auto-update.sh.new" && mv "$H/fwu-auto-update.sh.new" "$H/fwu-auto-update.sh"

if [[ "${FWU_UPDATE_DRY_RUN:-}" == "1" ]]; then echo "Essai à blanc : paquets prêts."; status done "Essai à blanc"; exit 0; fi

status running "Mise à jour de FWU et du site (10 à 30 min)"
echo "==> FWU + site"
NODE_OPTIONS=--max-old-space-size=2048 PND_SUPABASE_MIGRATIONS_APPLIED=YES \
  bash "$H/FWU-installation/update-1942.sh" "$H/FWU-installation/FWU-maj.zip" </dev/null \
  || fail "Mise à jour de FWU échouée (l'ancienne version a été remise)."

status running "Mise à jour des 4 bots"
echo "==> Bots"
cd "$H/fwu-bots" || fail "Dossier des bots introuvable."
for z in GUARD FDPDLAVOC SUCK-ME LE-FISC; do unzip -oq "$H/FWU-installation/FWU-$z.zip" || fail "Paquet $z illisible."; done
broken=""
for b in guard fdpdlavoc suckme fisc; do
  echo "--- $b"
  bash "$H/fwu-bots/fwu-$b/installer.sh" </dev/null || broken="$broken $b"
done
pm2 save >/dev/null 2>&1 || true
pm2 ls --no-color || true
[[ -z "$broken" ]] || fail "Bots en erreur :$broken"
echo "✅ Mise à jour terminée."
status done "Terminée ($(basename "$REPO"))"

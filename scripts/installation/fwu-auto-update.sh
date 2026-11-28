#!/usr/bin/env bash
# FWU — mise à jour faite par le VPS lui-même (déclenchée par /maj lancer sur Discord, ou à la main).
# Télécharge la dernière version du dépôt GitHub privé avec le jeton en lecture seule
# rangé dans /home/opc/fwu-data/.github-token (chmod 600), puis met à jour FWU, le site et les 4 bots.
# Journal : /home/opc/fwu-data/maj.log · état : /home/opc/fwu-data/maj-status.json
#
# Quelle version ? Des versions numérotées (v1.2.0), publiées sur GitHub depuis main :
#   • sans argument : la dernière version publiée (« Latest release ») ;
#   • avec un argument « v1.1.0 » : cette version précise (pour revenir en arrière) ;
#   • tant qu'aucune version n'est publiée : la branche main.
# Jamais de branche choisie par une variable : seul ce qui est fusionné dans main est installé.
# La version installée est notée dans /home/opc/fwu-data/version-installee.
set -uo pipefail
H="${FWU_HOME:-/home/opc}"
DATA="$H/fwu-data"
TOKEN_FILE="$DATA/.github-token"
LOG="$DATA/maj.log"
STATUS="$DATA/maj-status.json"
# Dépôt : herolfriendss/fwu-bot (ancien nom : her-v3-). Si FWU_REPO_SLUG n'est pas fixé, le premier
# nom accessible avec le jeton est retenu plus bas (le jeton peut viser l'ancien ou le nouveau nom).
REPO_SLUG="${FWU_REPO_SLUG:-}"
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

# Node 24 comes from nvm on this VPS, and a script launched in the background
# by the bot never reads the profile that puts nvm on the PATH. Without this,
# /usr/local/bin/node (v20) wins and the update refuses to start.
node_major() { "$1" -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null; }
if ! command -v node >/dev/null 2>&1 || [ "$(node_major node)" -lt 24 ] 2>/dev/null; then
  for candidate in "$HOME"/.nvm/versions/node/*/bin/node; do
    [ -x "$candidate" ] || continue
    if [ "$(node_major "$candidate")" -ge 24 ] 2>/dev/null; then
      PATH="$(dirname "$candidate"):$PATH"
      export PATH
      break
    fi
  done
fi
echo "Node utilisé : $(command -v node || echo introuvable) $(node -v 2>/dev/null)"

# The bot runs under PM2 with NODE_ENV=production, and this script inherits it.
# A build and a test run need the dev dependencies, so the update starts from a
# neutral environment instead of the bot's own.
unset NODE_ENV
# Le script peut être lancé par n'importe quel bot : son profil et son token ne doivent jamais passer
# aux processus relancés avec --update-env (FWU est devenu un second SUCK ME à cause de ça).
for _v in DISCORD_TOKEN PND_BOT_PROFILE PND_FWU_DELEGATED $(compgen -e | grep -E '^PND_[A-Z]+_(TOKEN|GUILD_IDS)$'); do unset "$_v"; done

# --auto : lancé périodiquement par SUCK ME (mise à jour automatique) ; ne fait rien si
# la version visée (commit de main ou version publiée) est déjà installée.
AUTO=""
if [[ "${1:-}" == "--auto" ]]; then AUTO="1"; shift; fi
WANTED="${1:-}"
if [[ -n "$WANTED" && ! "$WANTED" =~ ^v[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ ]]; then
  echo "Version invalide : $WANTED (format attendu : v1.2.0)."; exit 2
fi
INSTALLED_FILE="$DATA/version-installee"
COMMIT_FILE="$DATA/commit-installe"

status() { printf '{"state":"%s","step":"%s","at":%s}\n' "$1" "$2" "$(date +%s)" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"; }

exec 9>"$DATA/maj.lock"
if ! flock -n 9; then echo "Une mise à jour est déjà en cours."; exit 3; fi
# En mode automatique, un contrôle sans nouveauté n'écrit rien dans le journal.
if [[ -n "$AUTO" ]]; then exec >/dev/null 2>&1; fi
[[ -z "$AUTO" ]] && exec >>"$LOG" 2>&1
[[ -z "$AUTO" ]] && echo
[[ -z "$AUTO" ]] && echo "===== Mise à jour FWU du $(date '+%d/%m/%Y %H:%M:%S') ====="
LOGGED=""; [[ -z "$AUTO" ]] && LOGGED="1"
# En mode automatique, un échec est toujours journalisé (sinon /maj etat n'expliquerait rien).
log_auto() {
  if [[ -z "$LOGGED" ]]; then
    exec >>"$LOG" 2>&1; LOGGED="1"
    echo; echo "===== Contrôle automatique FWU du $(date '+%d/%m/%Y %H:%M:%S') ====="
  fi
}
fail() { log_auto; echo "❌ $1"; status failed "$1"; exit 1; }

[[ -s "$TOKEN_FILE" ]] || fail "Aucun jeton GitHub sur le VPS (relance FWU-MAJ-COMPLETE.sh une fois depuis un ordinateur)."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The token goes through curl's stdin config, never on the command line.
gh_api() { printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '\r\n' < "$TOKEN_FILE")" | curl -fsSL -K - -H "Accept: application/vnd.github+json" "$@"; }

if [[ -z "$REPO_SLUG" ]]; then
  for candidate in herolfriendss/fwu-bot herolfriendss/her-v3-; do
    if gh_api -o /dev/null "https://api.github.com/repos/$candidate" 2>/dev/null; then REPO_SLUG="$candidate"; break; fi
  done
  [[ -n "$REPO_SLUG" ]] || fail "Dépôt GitHub inaccessible avec le jeton (réseau ou jeton expiré)."
fi
[[ -z "$AUTO" ]] && status running "Recherche de la dernière version"
echo "==> Version"
if [[ -n "$WANTED" ]]; then
  REF="$WANTED"
  gh_api -o /dev/null "https://api.github.com/repos/$REPO_SLUG/git/ref/tags/$REF" || fail "Version $REF introuvable sur GitHub."
else
  latest_json="$(gh_api "https://api.github.com/repos/$REPO_SLUG/releases/latest" 2>/dev/null || true)"
  REF="$(printf '%s' "$latest_json" | python3 -I -c 'import json,sys,re
try: t=json.load(sys.stdin).get("tag_name","")
except Exception: t=""
print(t if re.fullmatch(r"v\d{1,4}\.\d{1,4}\.\d{1,4}", t or "") else "")')"
  if [[ -z "$REF" ]]; then
    REF="main"
    echo "Aucune version numérotée publiée : installation de main."
  fi
fi
INSTALLED="$(tr -d '[:space:]' < "$INSTALLED_FILE" 2>/dev/null || true)"
# Commit visé (main ou version publiée) : sert à ne réinstaller que s'il y a du nouveau.
TARGET_COMMIT="$(gh_api "https://api.github.com/repos/$REPO_SLUG/commits/$REF" 2>/dev/null | python3 -I -c 'import json,sys
try: print(json.load(sys.stdin).get("sha","")[:40])
except Exception: print("")' || true)"
INSTALLED_COMMIT="$(tr -d '[:space:]' < "$COMMIT_FILE" 2>/dev/null || true)"
if [[ -n "$AUTO" ]]; then
  if [[ -z "$TARGET_COMMIT" ]]; then
    # GitHub injoignable : rien n'est installé, rien n'est redémarré ; nouvel essai demain.
    log_auto; echo "⚠️ Commit de $REF illisible (réseau ou GitHub indisponible) : aucune mise à jour aujourd'hui."; exit 0
  fi
  [[ "$TARGET_COMMIT" == "$INSTALLED_COMMIT" ]] && exit 0
  # Du nouveau : à partir d'ici, tout est journalisé comme une mise à jour manuelle.
  exec >>"$LOG" 2>&1; LOGGED="1"
  echo
  echo "===== Mise à jour automatique FWU du $(date '+%d/%m/%Y %H:%M:%S') ====="
fi
echo "Installée : ${INSTALLED:-inconnue} · visée : $REF"
if [[ -z "$WANTED" && "$REF" != "main" && "$REF" == "$INSTALLED" ]]; then
  echo "✅ Déjà à jour ($REF)."
  status "done" "Déjà à jour ($REF)"
  exit 0
fi

status running "Téléchargement de $REF depuis GitHub"
echo "==> Téléchargement"
gh_api -o "$WORK/src.zip" "https://api.github.com/repos/$REPO_SLUG/zipball/$REF" \
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
# Sauvegarde et surveillance : fichiers posés à jour ; ils ne tournent que si Ryan a ajouté leur ligne cron (docs/SAUVEGARDES.md, docs/SURVEILLANCE.md).
for extra in fwu-sauvegarde.sh fwu-surveillance.mjs; do
  [[ -f "$REPO/scripts/installation/$extra" ]] && install -m 700 "$REPO/scripts/installation/$extra" "$H/$extra.new" && mv "$H/$extra.new" "$H/$extra"
done

if [[ "${FWU_UPDATE_DRY_RUN:-}" == "1" ]]; then echo "Essai à blanc : paquets prêts."; status "done" "Essai à blanc"; exit 0; fi

status running "Mise à jour de FWU et du site (10 à 30 min)"
echo "==> FWU + site"
NODE_OPTIONS=--max-old-space-size=2048 PND_SUPABASE_MIGRATIONS_APPLIED=YES \
  bash "$H/FWU-installation/update-1942.sh" "$H/FWU-installation/FWU-maj.zip" </dev/null \
  || fail "Mise à jour de FWU échouée (l'ancienne version a été remise)."

# Base centrale (quotas, sanctions, journaux) : installée une seule fois, sans question.
# Jamais bloquante : sans elle, seules les commandes de modération à quota sont refusées.
FWU_ENV_FILE="$H/her-v5-production/bot/.env"
if [[ -f "$FWU_ENV_FILE" ]] && ! grep -qE '^SHARED_DATABASE_URL=postgres' "$FWU_ENV_FILE"; then
  status running "Installation de la base centrale (une seule fois)"
  echo "==> Base centrale"
  if sudo -n true 2>/dev/null && sudo -n bash "$H/her-v5-production/deploy/oracle/install-shared-db.sh" "$FWU_ENV_FILE" </dev/null; then
    pm2 restart her-v5-bot --update-env >/dev/null 2>&1 || true
  else
    echo "⚠️ Base centrale non installée (sudo ou dnf indisponible) : relance sudo bash $H/her-v5-production/deploy/oracle/install-shared-db.sh"
  fi
fi
# Préfixes : un seul fichier pour les 6 bots, créé une fois, jamais écrasé.
SHARED_DIR="$(grep -E '^PND_DATA_DIR=' "$FWU_ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'[:space:]' || true)"
if [[ -n "$SHARED_DIR" && -d "$SHARED_DIR" && ! -f "$SHARED_DIR/bots.json" && -f "$H/her-v5-production/bot/config/bots.example.json" ]]; then
  install -m 600 "$H/her-v5-production/bot/config/bots.example.json" "$SHARED_DIR/bots.json"
  echo "Préfixes : GUARD +, FDPDLAVOC ;, SUCK ME =, LE FISC -, Invest + $ ($SHARED_DIR/bots.json)"
fi

status running "Mise à jour des 5 bots"
echo "==> Bots"
cd "$H/fwu-bots" || fail "Dossier des bots introuvable."
broken=""; rolled=""
# Chaque bot : copie de l'ancienne version, mise à jour, et retour arrière si son installateur échoue.
for pair in GUARD:guard FDPDLAVOC:fdpdlavoc SUCK-ME:suckme LE-FISC:fisc INVEST-PLUS:investplus; do
  z="${pair%%:*}"; b="${pair##*:}"
  echo "--- $b"
  bash "$REPO/scripts/installation/fwu-maj-un-bot.sh" "$H/FWU-installation/FWU-$z.zip" "$H/fwu-bots" "$b"
  case $? in
    0) ;;
    2) [[ "$b" == investplus ]] && echo "Invest + passé (pas de token, facultatif)." || broken="$broken $b(sans token)" ;;
    4) rolled="$rolled $b" ;;
    *) broken="$broken $b" ;;
  esac
done
pm2 save >/dev/null 2>&1 || true
pm2 ls --no-color || true
[[ -z "$rolled" ]] || fail "Ancienne version remise pour :$rolled${broken:+ · en erreur :$broken} (détails : /maj etat)"
[[ -z "$broken" ]] || fail "Bots en erreur :$broken"
printf '%s\n' "$REF" > "$INSTALLED_FILE"
[[ -n "$TARGET_COMMIT" ]] && printf '%s\n' "$TARGET_COMMIT" > "$COMMIT_FILE"
echo "✅ Mise à jour terminée."
status "done" "Terminée ($REF · $(basename "$REPO"))"

#!/usr/bin/env bash
# FWU — sauvegarde quotidienne des données partagées (proposition n°7 de l'Éclaireur).
#
# Sauvegarde, sans arrêter les bots :
#   • economy.sqlite (économie, SYS+, whitelist, laisses…) par copie « en ligne » de SQLite ;
#   • la base centrale PostgreSQL (sanctions, quotas, journaux) avec pg_dump.
# Puis envoie une copie HORS du VPS avec rclone (le disque du VPS est presque plein,
# et une copie sur le même disque ne protège pas d'une perte du VPS).
#
#   Copies gardées sur le VPS   : 3 jours (FWU_BACKUP_KEEP_LOCAL), pour économiser le disque.
#   Copies gardées hors du VPS  : 14 jours (FWU_BACKUP_KEEP_REMOTE).
#   Journal : ~/fwu-data/sauvegarde.log · état : ~/fwu-data/sauvegarde-status.json
#   (lu par /sysp diagnostic bots et par la surveillance).
#
# Installation (une fois, sur le VPS) : voir docs/SAUVEGARDES.md.
# Lecture seule pour les données : rien n'est modifié, aucun bot n'est arrêté.
set -uo pipefail
umask 077
H="${FWU_HOME:-/home/opc}"
DATA="$H/fwu-data"
LOG="$DATA/sauvegarde.log"
STATUS="$DATA/sauvegarde-status.json"
REMOTE_FILE="$DATA/.sauvegarde-distante"
LOCAL_DIR="${FWU_BACKUP_DIR:-$H/fwu-sauvegardes}"
KEEP_LOCAL="${FWU_BACKUP_KEEP_LOCAL:-3}"
KEEP_REMOTE="${FWU_BACKUP_KEEP_REMOTE:-14}"
ENV_FILE="${FWU_ENV_FILE:-$H/her-v5-production/bot/.env}"
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin:$H/.npm-global/bin:$H/bin"

mkdir -p "$DATA"
exec 9>"$DATA/sauvegarde.lock"
if ! flock -n 9; then echo "Une sauvegarde est déjà en cours."; exit 3; fi
exec >>"$LOG" 2>&1
echo
echo "===== Sauvegarde du $(date '+%d/%m/%Y %H:%M:%S') ====="

write_status() { # ok step size offsite
  printf '{"ok":%s,"step":"%s","size":%s,"offsite":%s,"at":%s}\n' "$1" "$2" "${3:-0}" "${4:-false}" "$(date +%s)" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}
fail() { echo "❌ $1"; write_status false "$1"; rm -rf "${DEST:-/nonexistent-fwu}"; exit 1; }

env_value() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' | tr -d '\r'; }

# Node >= 22 pour la copie en ligne de SQLite (nvm n'est pas sur le PATH de cron).
NODE="$(command -v node || true)"
node_major() { "$1" -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0; }
if [[ -z "$NODE" || "$(node_major "$NODE")" -lt 22 ]]; then
  for candidate in "$H"/.nvm/versions/node/*/bin/node; do
    [[ -x "$candidate" && "$(node_major "$candidate")" -ge 22 ]] && NODE="$candidate"
  done
fi

DATA_DIR="$(env_value PND_DATA_DIR)"; [[ -n "$DATA_DIR" ]] || DATA_DIR="$H/her-v5-production/bot/data"
SQLITE="$(env_value HER_DB_PATH)"; [[ -n "$SQLITE" ]] || SQLITE="$DATA_DIR/economy.sqlite"
PG_URL="$(env_value SHARED_DATABASE_URL)"
[[ -f "$SQLITE" ]] || fail "economy.sqlite introuvable ($SQLITE)."

# Place libre : il faut au moins 2 fois la taille de la base + 200 Mo.
need_kb=$(( $(du -k "$SQLITE" | cut -f1) * 2 + 200 * 1024 ))
mkdir -p "$LOCAL_DIR" && chmod 700 "$LOCAL_DIR"
free_kb=$(df -Pk "$LOCAL_DIR" | awk 'NR==2 {print $4}')
if [[ "${free_kb:-0}" -lt "$need_kb" ]]; then
  # Disque trop plein : on libère d'abord les plus vieilles copies locales, sauf la dernière.
  ls -1d "$LOCAL_DIR"/20* 2>/dev/null | sort | head -n -1 | xargs -r rm -rf
  free_kb=$(df -Pk "$LOCAL_DIR" | awk 'NR==2 {print $4}')
  [[ "${free_kb:-0}" -ge "$need_kb" ]] || fail "Disque plein : $((free_kb / 1024)) Mo libres, $((need_kb / 1024)) Mo nécessaires."
fi

STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
DEST="$LOCAL_DIR/$STAMP"
mkdir -p "$DEST"

echo "==> economy.sqlite"
if [[ -n "$NODE" ]]; then
  "$NODE" --no-warnings -e '
    const { DatabaseSync, backup } = require("node:sqlite");
    const src = new DatabaseSync(process.argv[1], { readOnly: true });
    backup(src, process.argv[2]).then(() => { src.close(); }).catch((e) => { console.error(e.message); process.exit(1); });
  ' "$SQLITE" "$DEST/economy.sqlite" || fail "Copie de economy.sqlite impossible."
elif command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$SQLITE" ".backup '$DEST/economy.sqlite'" || fail "Copie de economy.sqlite impossible."
else
  fail "Ni Node 22+ ni sqlite3 : copie de economy.sqlite impossible."
fi
gzip -9 "$DEST/economy.sqlite" || fail "Compression de economy.sqlite impossible."

if [[ "$PG_URL" == postgres* ]]; then
  echo "==> Base centrale (pg_dump)"
  command -v pg_dump >/dev/null 2>&1 || fail "pg_dump absent (sudo dnf install -y postgresql)."
  # L'adresse contient le mot de passe : passée par variables d'environnement, jamais sur la ligne de commande.
  eval "$(python3 -I - "$PG_URL" <<'PY'
import shlex, sys
from urllib.parse import urlsplit, unquote
u = urlsplit(sys.argv[1])
pairs = {"PGHOST": u.hostname or "localhost", "PGPORT": str(u.port or 5432), "PGUSER": unquote(u.username or ""),
         "PGPASSWORD": unquote(u.password or ""), "PGDATABASE": (u.path or "/").lstrip("/")}
for key, value in pairs.items():
    print(f"export {key}={shlex.quote(value)}")
PY
)" || fail "SHARED_DATABASE_URL illisible."
  pg_dump --format=custom --no-owner --file="$DEST/base-centrale.dump" || fail "pg_dump a échoué."
  unset PGPASSWORD
else
  echo "Base centrale non configurée : seule economy.sqlite est sauvegardée."
fi

SIZE_KB=$(du -sk "$DEST" | cut -f1)
echo "Taille : $((SIZE_KB / 1024)) Mo"

OFFSITE=false
REMOTE="$(tr -d '[:space:]' < "$REMOTE_FILE" 2>/dev/null || true)"
STEP="Réussie ($STAMP)"
if [[ -n "$REMOTE" ]]; then
  echo "==> Copie hors du VPS ($REMOTE)"
  command -v rclone >/dev/null 2>&1 || fail "rclone absent : copie hors du VPS impossible (voir docs/SAUVEGARDES.md)."
  rclone copy "$DEST" "$REMOTE/$STAMP" --quiet || fail "Copie hors du VPS échouée (rclone)."
  rclone delete "$REMOTE" --min-age "${KEEP_REMOTE}d" --quiet || echo "⚠️ Nettoyage des vieilles copies distantes impossible."
  rclone rmdirs "$REMOTE" --leave-root --quiet || true
  OFFSITE=true
else
  STEP="Réussie ($STAMP), mais SANS copie hors du VPS"
  echo "⚠️ Aucune copie hors du VPS : configure $REMOTE_FILE (docs/SAUVEGARDES.md)."
fi

# Copies locales : on garde les KEEP_LOCAL plus récentes.
ls -1d "$LOCAL_DIR"/20* 2>/dev/null | sort | head -n "-$KEEP_LOCAL" | xargs -r rm -rf
echo "✅ $STEP"
write_status true "$STEP" "$SIZE_KB" "$OFFSITE"

#!/usr/bin/env bash
# Backup the CURRENT live V5 release before replacing its source files.
# Stops only the V5 bot briefly so SQLite/WAL data is captured consistently.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
EXPECTED_ROOT="${PND_EXPECTED_ROOT:-/home/opc/her-v5-production}"
[[ "$ROOT" == "$EXPECTED_ROOT" ]] || { echo "Refus : racine $ROOT ; attendue $EXPECTED_ROOT" >&2; exit 1; }
[[ -f "$ROOT/bot/index.js" && -f "$ROOT/.env" && -f "$ROOT/bot/.env" ]] || { echo "Refus : projet ou fichiers .env absents." >&2; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo "PM2 absent." >&2; exit 1; }

pm2 jlist | ROOT_FOR_PM2="$ROOT" node --input-type=module -e '
let raw=""; for await (const c of process.stdin) raw+=c;
const rows=JSON.parse(raw); const root=process.env.ROOT_FOR_PM2;
const expectedCwd={"her-v5-web":root,"her-v5-bot":`${root}/bot`};
for (const name of ["her-v5-web","her-v5-bot"]) {
 const p=rows.find(x=>x.name===name && x.pm2_env?.status==="online");
 if (!p || p.pm2_env?.pm_cwd!==expectedCwd[name]) { console.error(`Processus ${name} absent, arrêté ou hors de ${expectedCwd[name]}.`); process.exit(2); }
}
'

BACKUP_BASE="${PND_BACKUP_DIR:-$HOME/pnd-v5-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_BASE/pre-update-$STAMP"
install -d -m 700 "$DEST"
chmod 600 "$ROOT/.env" "$ROOT/bot/.env"

restart_bot() {
  pm2 start her-v5-bot >/dev/null 2>&1 || true
}
trap restart_bot EXIT

echo "Arrêt bref de her-v5-bot pour figer SQLite/WAL..."
pm2 stop her-v5-bot >/dev/null

echo "Sauvegarde du code, des .env et des données..."
tar --exclude='./node_modules' --exclude='./bot/node_modules' --exclude='./.output' \
    --exclude='./.git' --exclude='./coverage' --exclude='./.vite' --exclude='./.nitro' \
    -czf "$DEST/pnd-v5-before-update.tar.gz" -C "$ROOT" .
chmod 600 "$DEST/pnd-v5-before-update.tar.gz"

restart_bot
trap - EXIT
for attempt in $(seq 1 15); do
  if pm2 jlist | node --input-type=module -e '
    let raw=""; for await (const c of process.stdin) raw+=c;
    const p=JSON.parse(raw).find(x=>x.name==="her-v5-bot");
    process.exit(p?.pm2_env?.status==="online" ? 0 : 1);
  '; then break; fi
  [[ "$attempt" -lt 15 ]] || { pm2 status; echo "Le bot n'est pas revenu online après la sauvegarde." >&2; exit 2; }
  sleep 2
done

echo "Sauvegarde pré-déploiement terminée : $DEST/pnd-v5-before-update.tar.gz"
echo "Bot redémarré. Aucun fichier du projet n'a été remplacé et aucun déploiement n'a été lancé."

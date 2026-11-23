#!/usr/bin/env bash
# 1942 — retour manuel à une version précédente conservée par update-1942.sh.
#
#   bash rollback-1942.sh /home/opc/her-v5-production.prev-20261123T120000Z
#
# La version actuelle est conservée dans <racine>.rolledback-<date>.
# ATTENTION : la base SQLite revient à l'état du moment de la mise à jour.
# Les données créées depuis (PND gagnés, tickets, etc.) restent dans le dossier
# .rolledback-<date> : à récupérer manuellement si nécessaire.
set -Eeuo pipefail
PREV="${1:-}"
ROOT="${PND_EXPECTED_ROOT:-/home/opc/her-v5-production}"
# FWU multi-bots : agit seulement sur les bots spécialisés déjà déclarés dans PM2
# (jamais de démarrage automatique d'un nouveau bot).
fwu_bots() {
  local action="$1" name
  for name in fwu-guard fwu-fdpdlavoc fwu-suckme fwu-fisc; do
    pm2 describe "$name" >/dev/null 2>&1 || continue
    if [[ "$action" == "stop" ]]; then
      pm2 stop "$name" >/dev/null 2>&1 || true
    else
      { [[ -f "$ROOT/ecosystem.fwu-bots.config.cjs" ]] && (cd "$ROOT" && pm2 startOrReload ecosystem.fwu-bots.config.cjs --only "$name" --update-env >/dev/null 2>&1); } || pm2 restart "$name" >/dev/null 2>&1 || true
    fi
  done
}

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
[[ -n "$PREV" && -f "$PREV/bot/index.js" && -d "$PREV/node_modules" && -f "$PREV/.output/server/index.mjs" ]] \
  || { echo "Utilisation : bash rollback-1942.sh <dossier .prev-...> (version complète avec node_modules et build)." >&2; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo "PM2 introuvable." >&2; exit 1; }
read -r -p "Revenir à $PREV ? La base reviendra à l'état de cette version. Taper OUI : " answer
[[ "$answer" == "OUI" ]] || { echo "Annulé."; exit 1; }
pm2 stop her-v5-bot >/dev/null 2>&1 || true
fwu_bots stop
mv "$ROOT" "${ROOT}.rolledback-${STAMP}"
mv "$PREV" "$ROOT"
cd "$ROOT"
pm2 startOrReload ecosystem.v5.config.cjs --update-env
fwu_bots reload
pm2 save
echo "Retour effectué. Version retirée conservée : ${ROOT}.rolledback-${STAMP}"

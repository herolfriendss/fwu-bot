#!/usr/bin/env bash
# FWU — UNE SEULE FOIS, avant d'installer les autres bots : déplace la base et les
# fichiers d'état de FWU dans un dossier partagé par les 5 bots (/home/opc/fwu-data).
#
#   bash /home/opc/her-v5-production/scripts/fwu-donnees-partagees.sh
#
# - Arrête FWU quelques secondes, déplace les fichiers, règle PND_DATA_DIR, redémarre FWU.
# - Sauvegarde d'abord tout bot/data dans /home/opc/fwu-data-sauvegarde-<date>.tar.gz.
# - Relançable : si c'est déjà fait, il ne touche à rien.
set -Eeuo pipefail

ROOT="${PND_EXPECTED_ROOT:-/home/opc/her-v5-production}"
SHARED="${PND_SHARED_DATA_DIR:-/home/opc/fwu-data}"
BOT_ENV="$ROOT/bot/.env"
fail() { printf '\nERREUR : %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }

command -v pm2 >/dev/null 2>&1 || fail "PM2 introuvable."
[[ -f "$BOT_ENV" ]] || fail "$BOT_ENV introuvable."
current="$(grep -E '^PND_DATA_DIR=' "$BOT_ENV" | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'[:space:]' || true)"
if [[ -n "$current" ]]; then
  printf 'Déjà fait : FWU utilise le dossier partagé %s. Rien à changer.\n' "$current"
  exit 0
fi

install -d -m 700 "$SHARED"
[[ -z "$(ls -A "$SHARED" 2>/dev/null)" ]] || fail "$SHARED n'est pas vide : vérifie son contenu avant de continuer (aucun fichier n'a été déplacé)."

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
info "Arrêt bref de FWU"
pm2 stop her-v5-bot >/dev/null 2>&1 || true
restart_fwu() { pm2 start her-v5-bot >/dev/null 2>&1 || true; }
trap 'restart_fwu' EXIT

if [[ -d "$ROOT/bot/data" ]] && [[ -n "$(ls -A "$ROOT/bot/data")" ]]; then
  info "Sauvegarde : /home/opc/fwu-data-sauvegarde-$STAMP.tar.gz"
  tar -czf "/home/opc/fwu-data-sauvegarde-$STAMP.tar.gz" -C "$ROOT/bot" data
  chmod 600 "/home/opc/fwu-data-sauvegarde-$STAMP.tar.gz"
  info "Déplacement des données vers $SHARED"
  cp -a "$ROOT/bot/data/." "$SHARED/"
  mv "$ROOT/bot/data" "$ROOT/bot/data.avant-partage-$STAMP"
fi
chmod 700 "$SHARED"

printf '\nPND_DATA_DIR=%s\n' "$SHARED" >> "$BOT_ENV"
chmod 600 "$BOT_ENV"
info "Redémarrage de FWU avec le dossier partagé"
pm2 restart her-v5-bot --update-env >/dev/null
trap - EXIT
pm2 save >/dev/null
printf '\n✅ FWU utilise maintenant %s. Ancien dossier gardé : %s/bot/data.avant-partage-%s (supprimable après vérification).\n' "$SHARED" "$ROOT" "$STAMP"

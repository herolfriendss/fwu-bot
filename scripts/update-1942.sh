#!/usr/bin/env bash
# 1942 — mise à jour de la production en UNE commande, avec retour arrière automatique.
#
#   bash update-1942.sh /chemin/vers/1942_XXXX.zip
#
# Étapes :
#  1. contrôles (racine attendue, archive valide, .env présents, PM2) ;
#  2. extraction de la nouvelle version dans un dossier à côté de la production ;
#  3. copie des .env, arrêt bref du bot, copie de bot/data (base figée) ;
#  4. bascule : production actuelle -> <racine>.prev-<date>, nouvelle version -> <racine> ;
#  5. déploiement (tests, banc d'essai, build, redémarrage PM2) ;
#  6. en cas d'échec à n'importe quelle étape après la bascule : retour automatique
#     à l'ancienne version (dossier intact avec ses dépendances et son build).
#
# Ne touche jamais aux .env ni aux données de l'ancienne version (gardées dans .prev-<date>).
set -Eeuo pipefail

ZIP="${1:-}"
ROOT="${PND_EXPECTED_ROOT:-/home/opc/her-v5-production}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NEW="${ROOT}.new-${STAMP}"
PREV="${ROOT}.prev-${STAMP}"
SWITCHED=0

fail() {
  printf '\nERREUR: %s\n' "$*" >&2
  # Before the switch nothing in production changed: remove the partial extraction.
  if [[ "$SWITCHED" == "0" && -n "${NEW:-}" ]]; then rm -rf "$NEW" "${NEW}.inner"; fi
  exit 1
}
info() { printf '\n==> %s\n' "$*"; }

[[ -n "$ZIP" && -f "$ZIP" ]] || fail "Utilisation : bash update-1942.sh /chemin/vers/archive.zip"
ZIP="$(cd "$(dirname "$ZIP")" && pwd -P)/$(basename "$ZIP")"
[[ -d "$ROOT" && -f "$ROOT/bot/index.js" ]] || fail "Production introuvable : $ROOT (variable PND_EXPECTED_ROOT pour un autre chemin)."
[[ -f "$ROOT/.env" && -f "$ROOT/bot/.env" ]] || fail "Les fichiers $ROOT/.env et $ROOT/bot/.env doivent exister."
command -v pm2 >/dev/null 2>&1 || fail "PM2 introuvable."
command -v python3 >/dev/null 2>&1 || fail "python3 introuvable (nécessaire pour extraire l'archive)."
[[ "${PND_SUPABASE_MIGRATIONS_APPLIED:-}" == "YES" ]] \
  || fail "Confirme l'état des migrations Supabase : relance avec PND_SUPABASE_MIGRATIONS_APPLIED=YES (voir MISE_EN_PRODUCTION.md)."

rollback() {
  local code=$?
  trap - ERR INT TERM
  if [[ "$SWITCHED" == "1" ]]; then
    printf '\n!!! Échec (code %s) : retour automatique à la version précédente.\n' "$code" >&2
    if [[ -d "$PREV" ]]; then
      mv "$ROOT" "${ROOT}.failed-${STAMP}" || true
      mv "$PREV" "$ROOT"
      (cd "$ROOT" && pm2 startOrReload ecosystem.v5.config.cjs --update-env >/dev/null 2>&1) || pm2 restart her-v5-bot her-v5-web || true
      printf 'Version précédente restaurée dans %s. Version en échec conservée dans %s.failed-%s pour analyse.\n' "$ROOT" "$ROOT" "$STAMP" >&2
    fi
  else
    pm2 start her-v5-bot >/dev/null 2>&1 || true
    rm -rf "$NEW"
    printf '\nAucune bascule effectuée : la production n'"'"'a pas changé.\n' >&2
  fi
  exit "$code"
}
trap rollback ERR INT TERM

info "Extraction de la nouvelle version dans $NEW"
python3 -I - "$ZIP" "$NEW" <<'PY'
import sys, zipfile, os
src, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as z:
    bad = z.testzip()
    if bad: sys.exit(f"Archive corrompue : {bad}")
    for name in z.namelist():
        norm = os.path.normpath(name)
        if norm.startswith("..") or os.path.isabs(norm): sys.exit(f"Chemin interdit dans l'archive : {name}")
    z.extractall(dest)
PY
# The archive may contain the project at its root or in a single top folder.
if [[ ! -f "$NEW/bot/index.js" ]]; then
  INNER="$(find "$NEW" -mindepth 2 -maxdepth 3 -path '*/bot/index.js' -print -quit | sed 's#/bot/index.js$##')"
  [[ -n "$INNER" ]] || fail "L'archive ne contient pas bot/index.js."
  TMP="${NEW}.inner"; mv "$INNER" "$TMP"; rm -rf "$NEW"; mv "$TMP" "$NEW"
fi
for forbidden in .env bot/.env; do
  [[ ! -f "$NEW/$forbidden" ]] || fail "L'archive contient $forbidden : refusé (les secrets ne doivent pas voyager dans une archive)."
done

info "Copie des fichiers de configuration privés"
install -m 600 "$ROOT/.env" "$NEW/.env"
install -m 600 "$ROOT/bot/.env" "$NEW/bot/.env"

info "Arrêt bref du bot pour figer la base SQLite"
pm2 stop her-v5-bot >/dev/null 2>&1 || true
if [[ -d "$ROOT/bot/data" ]]; then
  rm -rf "$NEW/bot/data"
  cp -a "$ROOT/bot/data" "$NEW/bot/data"
fi

info "Bascule des dossiers"
mv "$ROOT" "$PREV"
mv "$NEW" "$ROOT"
SWITCHED=1

info "Déploiement (dépendances, tests, banc d'essai, build, redémarrage)"
cd "$ROOT"
bash scripts/deploy-pnd-v5-oracle.sh

trap - ERR INT TERM
printf '\n✅ Mise à jour terminée.\n'
printf 'Ancienne version conservée : %s (supprimable après quelques jours de bon fonctionnement).\n' "$PREV"
printf 'Retour arrière manuel si besoin : bash %s/scripts/rollback-1942.sh %s\n' "$ROOT" "$PREV"

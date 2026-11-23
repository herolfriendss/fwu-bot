#!/usr/bin/env bash
# FWU — synchronise FWU avec les bots spécialisés en ligne (GUARD, FDPDLAVOC, SUCK ME, LE FISC).
# FWU retire de son application les commandes des bots en ligne et libère ainsi la place
# pour /afk, /dmall, /blacklist et /live. Lancé automatiquement par l'installateur de chaque bot.
#
#   bash /home/opc/her-v5-production/scripts/fwu-synchroniser.sh
set -Eeuo pipefail

ROOT="${PND_EXPECTED_ROOT:-/home/opc/her-v5-production}"
fail() { printf '\nERREUR : %s\n' "$*" >&2; exit 1; }
command -v pm2 >/dev/null 2>&1 || fail "PM2 introuvable."
[[ -f "$ROOT/bot/.env" && -f "$ROOT/.env" ]] || fail "Fichiers .env de FWU introuvables dans $ROOT."

ONLINE="$(pm2 jlist | node --input-type=module -e '
  let raw = ""; process.stdin.on("data", (c) => raw += c).on("end", () => {
    const names = ["guard", "fdpdlavoc", "suckme", "fisc"];
    const rows = JSON.parse(raw);
    console.log(names.filter((n) => rows.some((p) => p.name === `fwu-${n}` && p.pm2_env?.status === "online")).join(","));
  });')"
printf 'Bots spécialisés en ligne : %s\n' "${ONLINE:-aucun}"

for file in "$ROOT/bot/.env" "$ROOT/.env"; do
  if grep -qE '^PND_FWU_DELEGATED=' "$file"; then
    sed -i -E "s/^PND_FWU_DELEGATED=.*/PND_FWU_DELEGATED=$ONLINE/" "$file"
  else
    printf '\nPND_FWU_DELEGATED=%s\n' "$ONLINE" >> "$file"
  fi
  chmod 600 "$file"
done
pm2 restart her-v5-bot her-v5-web --update-env >/dev/null
pm2 save >/dev/null
printf '✅ FWU synchronisé (PND_FWU_DELEGATED=%s). Les commandes slash se mettent à jour dans Discord (jusqu’à 1 h).\n' "${ONLINE:-}"

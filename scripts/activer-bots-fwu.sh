#!/usr/bin/env bash
# FWU — active les bots spécialisés dont le token est renseigné dans bot/.env,
# puis les « synchronise » avec FWU (FWU leur laisse leurs commandes).
#
#   bash /home/opc/her-v5-production/scripts/activer-bots-fwu.sh
#
# - Ne lit ni n'affiche jamais la valeur d'un token.
# - Démarre seulement les bots dont le token est rempli (PND_GUARD_TOKEN, PND_FDPDLAVOC_TOKEN,
#   PND_SUCKME_TOKEN, PND_FISC_TOKEN), différent de celui de FWU.
# - Met à jour PND_FWU_DELEGATED dans .env et bot/.env, puis redémarre FWU et le site.
# - Relançable sans risque (ajouter un token plus tard puis relancer suffit).
set -Eeuo pipefail

ROOT="${PND_EXPECTED_ROOT:-/home/opc/her-v5-production}"
BOT_ENV="$ROOT/bot/.env"
WEB_ENV="$ROOT/.env"

fail() { printf '\nERREUR : %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }

command -v pm2 >/dev/null 2>&1 || fail "PM2 introuvable."
[[ -f "$BOT_ENV" ]] || fail "$BOT_ENV introuvable."
[[ -f "$WEB_ENV" ]] || fail "$WEB_ENV introuvable."
[[ -f "$ROOT/ecosystem.fwu-bots.config.cjs" ]] || fail "Cette version ne contient pas les bots FWU : fais d'abord la mise à jour (update-1942.sh)."
chmod 600 "$BOT_ENV" "$WEB_ENV"

# Valeur d'une variable du fichier .env, sans l'afficher.
env_value() {
  local key="$1"
  grep -E "^${key}=" "$BOT_ENV" | tail -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' | tr -d '[:space:]'
}

LEGACY="$(env_value DISCORD_TOKEN)"
declare -a READY=()
for profile in guard fdpdlavoc suckme fisc; do
  key="PND_$(printf '%s' "$profile" | tr '[:lower:]' '[:upper:]')_TOKEN"
  value="$(env_value "$key")"
  if [[ -z "$value" ]]; then
    printf '   %-10s : pas de token (%s vide) — ignoré\n' "$profile" "$key"
    continue
  fi
  [[ "$value" != "$LEGACY" ]] || fail "$key est identique au token de FWU (DISCORD_TOKEN) : il faut le token de l'autre application."
  printf '   %-10s : token présent\n' "$profile"
  READY+=("$profile")
done
[[ "${#READY[@]}" -gt 0 ]] || fail "Aucun token renseigné. Ajoute-les dans $BOT_ENV puis relance."

info "Démarrage des bots : ${READY[*]}"
cd "$ROOT"
for profile in "${READY[@]}"; do
  pm2 startOrReload ecosystem.fwu-bots.config.cjs --only "fwu-$profile" --update-env >/dev/null
done

info "Vérification qu'ils sont en ligne (jusqu'à 60 s)"
declare -a ONLINE=()
for attempt in $(seq 1 12); do
  sleep 5
  ONLINE=()
  for profile in "${READY[@]}"; do
    if pm2 jlist | node --input-type=module -e '
      let raw = ""; process.stdin.on("data", (c) => raw += c).on("end", () => {
        const row = JSON.parse(raw).find((p) => p.name === process.argv[1]);
        process.exit(row?.pm2_env?.status === "online" && (row.pm2_env.restart_time ?? 0) < 3 ? 0 : 1);
      });' "fwu-$profile"; then ONLINE+=("$profile"); fi
  done
  [[ "${#ONLINE[@]}" -eq "${#READY[@]}" ]] && break
done
if [[ "${#ONLINE[@]}" -ne "${#READY[@]}" ]]; then
  for profile in "${READY[@]}"; do
    [[ " ${ONLINE[*]} " == *" $profile "* ]] && continue
    printf '\n--- fwu-%s ne tient pas : dernières lignes ---\n' "$profile"
    pm2 logs "fwu-$profile" --lines 15 --nostream 2>/dev/null | grep -v -i token || true
    pm2 stop "fwu-$profile" >/dev/null 2>&1 || true
  done
  printf '\nCauses fréquentes : token faux, intents « Server Members » et « Message Content » non activés dans le portail Discord, bot pas invité sur le serveur.\n'
fi
[[ "${#ONLINE[@]}" -gt 0 ]] || fail "Aucun bot n'a démarré. FWU continue de tout faire, rien n'a changé."

# Synchronisation : FWU retire de son application les commandes des bots en ligne.
DELEGATED="$(IFS=,; printf '%s' "${ONLINE[*]}")"
info "Synchronisation avec FWU : PND_FWU_DELEGATED=$DELEGATED"
for file in "$BOT_ENV" "$WEB_ENV"; do
  if grep -qE '^PND_FWU_DELEGATED=' "$file"; then
    sed -i -E "s/^PND_FWU_DELEGATED=.*/PND_FWU_DELEGATED=$DELEGATED/" "$file"
  else
    printf '\nPND_FWU_DELEGATED=%s\n' "$DELEGATED" >> "$file"
  fi
done
pm2 restart her-v5-bot her-v5-web --update-env >/dev/null
pm2 save >/dev/null

printf '\n✅ Bots actifs : %s\n' "${ONLINE[*]}"
printf 'Les nouvelles commandes slash peuvent mettre jusqu’à 1 h à apparaître partout dans Discord.\n'
printf 'Vérifie dans Discord : /sysp diagnostic bots (tous 🟢) et la page Statut du site.\n'
printf 'Retour arrière d’un bot : pm2 stop fwu-<nom> (FWU reprend son travail en moins d’une minute).\n'

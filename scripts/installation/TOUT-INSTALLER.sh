#!/usr/bin/env bash
# FWU — installation complète en UNE commande, à lancer SUR LE VPS Oracle :
#
#   bash /home/opc/FWU-installation/TOUT-INSTALLER.sh
#
# 1. met FWU à jour (retour arrière automatique en cas d'échec) ;
# 2. crée le dossier de données partagé (une seule fois, sans risque si relancé) ;
# 3. installe la base centrale, les préfixes et synchronise les secrets de passerelle ;
#    la clé fournisseur IA reste côté site : aucune clé Claude n'est demandée ;
# 4. installe GUARD, FDPDLAVOC, SUCK ME, LE FISC et Invest + : chacun te demande son token
#    (saisie masquée, Entrée seule = passer ce bot) ;
# 5. affiche l'état final.
# Relançable sans risque : ce qui est déjà fait est conservé. Aucun token n'est affiché.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${PND_EXPECTED_ROOT:-/home/opc/her-v5-production}"
BOTS_DIR="${FWU_BOTS_DIR:-/home/opc/fwu-bots}"
step() { printf '\n\033[1m━━━ %s ━━━\033[0m\n' "$*"; }
fail() { printf '\nERREUR : %s\n' "$*" >&2; exit 1; }
ask() { local reply; read -rp "$1 [O/n] " reply || reply=""; [[ ! "$reply" =~ ^[nN] ]]; }

read_env_value() {
  python3 - "$1" "$2" <<'PY'
import pathlib, sys
path, key = pathlib.Path(sys.argv[1]), sys.argv[2]
value = ""
if path.is_file():
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith(key + "="):
            value = line.split("=", 1)[1].strip().strip("\"'")
print(value)
PY
}

write_env_value() {
  local file="$1" key="$2" value="$3"
  FWU_ENV_VALUE="$value" python3 - "$file" "$key" <<'PY'
import os, pathlib, sys, tempfile
path, key = pathlib.Path(sys.argv[1]), sys.argv[2]
value = os.environ["FWU_ENV_VALUE"]
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
out, written = [], False
for line in lines:
    if line.startswith(key + "="):
        if not written:
            out.append(key + "=" + value)
            written = True
    else:
        out.append(line)
if not written:
    out.append(key + "=" + value)
fd, temp_name = tempfile.mkstemp(prefix="." + path.name + ".", dir=str(path.parent))
with os.fdopen(fd, "w", encoding="utf-8") as stream:
    stream.write("\n".join(out) + "\n")
os.chmod(temp_name, 0o600)
os.replace(temp_name, path)
PY
  chmod 600 "$file"
}

is_configured() {
  [[ -n "$1" && "$1" != *REPLACE* ]]
}

sync_specialized_bot_env() {
  local bot="$1" env_file="$BOTS_DIR/fwu-$1/.env" key value
  [[ -f "$env_file" ]] || return 0
  for key in PND_DATA_DIR SITE_URL BOT_SYNC_SECRET PND_OWNER_DISCORD_ID SHARED_DATABASE_URL; do
    value="$(read_env_value "$ROOT/bot/.env" "$key")"
    [[ -n "$value" ]] && write_env_value "$env_file" "$key" "$value"
  done
  if pm2 describe "fwu-$bot" >/dev/null 2>&1; then
    pm2 restart "fwu-$bot" --update-env >/dev/null || return 1
  fi
}

FWU_ZIP="$(ls -1t "$HERE"/FWU_[0-9]*.zip 2>/dev/null | head -n 1)"
[[ -n "$FWU_ZIP" ]] || fail "FWU_<date>.zip introuvable à côté de ce script ($HERE)."
for z in GUARD FDPDLAVOC SUCK-ME LE-FISC INVEST-PLUS; do [[ -f "$HERE/FWU-$z.zip" ]] || fail "FWU-$z.zip introuvable dans $HERE."; done
[[ -t 0 ]] || fail "Lance ce script dans un terminal (ssh -t), il doit pouvoir te demander les tokens."
command -v python3 >/dev/null || fail "python3 introuvable."
command -v unzip >/dev/null || fail "unzip introuvable : sudo dnf install -y unzip"

cat <<MSG

FWU — installation des 6 bots sur ce VPS.
Avant de continuer, dans le portail développeur Discord (discord.com/developers/applications),
pour GUARD, FDPDLAVOC, SUCK ME, LE FISC et Invest + :
  • onglet Bot : active « Server Members Intent » et « Message Content Intent » ;
  • le bot est invité sur ton serveur ;
  • garde la page ouverte : tu copieras le token (Reset Token → Copy) quand il sera demandé.
MSG
read -rp "Appuie sur Entrée quand c'est prêt (Ctrl+C pour annuler)… " _ || exit 1

step "1/6 — Mise à jour de FWU ($(basename "$FWU_ZIP"))"
if ask "Mettre FWU à jour maintenant (environ 10 min, à faire au premier lancement) ?"; then
  python3 -c "import sys,zipfile;open(sys.argv[2],'wb').write(zipfile.ZipFile(sys.argv[1]).read('FWU/scripts/update-1942.sh'))" "$FWU_ZIP" "$HERE/update-1942.sh" \
    || fail "Impossible d'extraire update-1942.sh de $FWU_ZIP."
  PND_SUPABASE_MIGRATIONS_APPLIED=YES bash "$HERE/update-1942.sh" "$FWU_ZIP" \
    || fail "La mise à jour de FWU a échoué (l'ancienne version a été remise). Rien d'autre n'a été modifié."
else
  printf 'Mise à jour de FWU passée.\n'
fi

step "2/6 — Dossier de données partagé"
bash "$ROOT/scripts/fwu-donnees-partagees.sh" || fail "Création du dossier partagé impossible (FWU est-il bien à jour ?)."
SHARED_DIR="$(grep -E '^PND_DATA_DIR=' "$ROOT/bot/.env" | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'[:space:]' || true)"
[[ -n "$SHARED_DIR" ]] || fail "PND_DATA_DIR absent de $ROOT/bot/.env après la création du dossier partagé."

step "3/6 — Base centrale, préfixes et passerelle IA"
# Base PostgreSQL locale (mot de passe généré sur le VPS, jamais affiché). Relançable : ne refait rien si déjà prête.
sudo bash "$ROOT/deploy/oracle/install-shared-db.sh" "$ROOT/bot/.env" \
  || fail "Installation de la base centrale impossible (voir le message ci-dessus). FWU est à jour et fonctionne ; relance ce script après correction."
# Préfixes : un seul fichier pour les 6 bots, jamais écrasé ensuite.
if [[ ! -f "$SHARED_DIR/bots.json" ]]; then
  install -m 600 "$ROOT/bot/config/bots.example.json" "$SHARED_DIR/bots.json"
  printf 'Préfixes : GUARD +, FDPDLAVOC ;, SUCK ME =, LE FISC -, Invest + $  (modifiables dans %s/bots.json)\n' "$SHARED_DIR"
else
  printf 'Préfixes : fichier existant conservé (%s/bots.json).\n' "$SHARED_DIR"
fi
# La passerelle IA est facturée côté site. Aucun abonnement ni aucune clé Claude ne sont requis.
[[ -f "$ROOT/.env" && -f "$ROOT/bot/.env" ]] || fail "Les fichiers .env du site et du bot sont requis."
SITE_URL="$(read_env_value "$ROOT/bot/.env" SITE_URL)"
[[ "$SITE_URL" == https://* && "$SITE_URL" != *REPLACE* ]] || fail "Configure SITE_URL en HTTPS dans bot/.env avant l'installation."
OWNER_ID="$(read_env_value "$ROOT/bot/.env" PND_OWNER_DISCORD_ID)"
[[ "$OWNER_ID" =~ ^[0-9]{17,20}$ ]] || fail "Configure ton unique PND_OWNER_DISCORD_ID dans bot/.env."
WEB_SECRET="$(read_env_value "$ROOT/.env" BOT_SYNC_SECRET)"
BOT_SECRET="$(read_env_value "$ROOT/bot/.env" BOT_SYNC_SECRET)"
if is_configured "$WEB_SECRET" && is_configured "$BOT_SECRET" && [[ "$WEB_SECRET" != "$BOT_SECRET" ]]; then
  fail "BOT_SYNC_SECRET diffère entre .env et bot/.env ; corrige la valeur commune avant de continuer."
elif is_configured "$WEB_SECRET"; then
  BOT_SECRET="$WEB_SECRET"
elif is_configured "$BOT_SECRET"; then
  WEB_SECRET="$BOT_SECRET"
else
  command -v openssl >/dev/null 2>&1 || fail "openssl est requis pour générer BOT_SYNC_SECRET."
  BOT_SECRET="$(openssl rand -hex 32)" || fail "Génération de BOT_SYNC_SECRET impossible."
  WEB_SECRET="$BOT_SECRET"
fi
[[ \${#BOT_SECRET} -ge 32 ]] || fail "BOT_SYNC_SECRET doit contenir au moins 32 caractères."
write_env_value "$ROOT/.env" BOT_SYNC_SECRET "$BOT_SECRET"
write_env_value "$ROOT/bot/.env" BOT_SYNC_SECRET "$BOT_SECRET"
write_env_value "$ROOT/.env" PND_OWNER_DISCORD_ID "$OWNER_ID"
AI_PROVIDER_KEY="$(read_env_value "$ROOT/.env" LOVABLE_API_KEY)"
if ! is_configured "$AI_PROVIDER_KEY"; then AI_PROVIDER_KEY="$(read_env_value "$ROOT/.env" AI_GATEWAY_API_KEY)"; fi
if ! is_configured "$AI_PROVIDER_KEY"; then
  printf '⚠️ Aucune clé fournisseur IA détectée dans .env : les fonctions IA resteront indisponibles jusqu’à la configuration de LOVABLE_API_KEY ou AI_GATEWAY_API_KEY.\n'
else
  printf 'Passerelle IA : clé fournisseur présente côté site (jamais copiée dans les bots).\n'
fi
unset WEB_SECRET BOT_SECRET AI_PROVIDER_KEY
pm2 restart her-v5-bot --update-env >/dev/null || fail "Redémarrage de FWU impossible."
printf 'FWU redémarré avec la base centrale.\n'

step "4/6 — Installation des 5 bots spécialisés"
mkdir -p "$BOTS_DIR"
for z in GUARD FDPDLAVOC SUCK-ME LE-FISC INVEST-PLUS; do unzip -oq "$HERE/FWU-$z.zip" -d "$BOTS_DIR" || fail "Décompression de FWU-$z.zip impossible."; done
declare -A RESULT
SHARED_DATABASE_URL="$(read_env_value "$ROOT/bot/.env" SHARED_DATABASE_URL)"
[[ -n "$SHARED_DATABASE_URL" ]] || fail "SHARED_DATABASE_URL absent du bot principal après l'installation PostgreSQL."
for bot in guard fdpdlavoc suckme fisc investplus; do
  printf '\n\033[1m▶ %s\033[0m\n' "$bot"
  if bash "$BOTS_DIR/fwu-$bot/installer.sh"; then BOT_INSTALL_RC=0; else BOT_INSTALL_RC=$?; fi
  case "$BOT_INSTALL_RC" in
    0) RESULT[$bot]="🟢 installé" ;;
    2) RESULT[$bot]="⚪ passé (pas de token) — plus tard : bash $BOTS_DIR/fwu-$bot/installer.sh" ;;
    *) RESULT[$bot]="🔴 échec — voir le message ci-dessus, puis : bash $BOTS_DIR/fwu-$bot/installer.sh" ;;
  esac
  if [[ -f "$BOTS_DIR/fwu-$bot/.env" ]]; then
    sync_specialized_bot_env "$bot" || fail "Impossible de synchroniser l'environnement partagé de $bot."
    if pm2 describe "fwu-$bot" >/dev/null 2>&1; then RESULT[$bot]="🟢 en ligne, données et secrets partagés"; fi
  fi
done
unset SHARED_DATABASE_URL SITE_URL OWNER_ID

step "5/6 — Préparation de /maj (mise à jour autonome)"
if [[ -f "$HERE/fwu-auto-update.sh" ]]; then
  install -m 700 "$HERE/fwu-auto-update.sh" /home/opc/fwu-auto-update.sh
  mkdir -p /home/opc/fwu-data
  chmod 700 /home/opc/fwu-data
  if [[ ! -s /home/opc/fwu-data/.github-token ]]; then
    cat <<'INFO'
Pour activer /maj lancer directement depuis Discord, crée un jeton GitHub en lecture seule :
  GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
  Repository access : Only select repositories → her-v3-
  Permissions : Contents → Read-only (aucune autre permission).
Colle-le ci-dessous. La saisie est masquée ; Entrée seule = configurer plus tard.
INFO
    printf 'Jeton GitHub : '
    IFS= read -rs GH_TOKEN || GH_TOKEN=""
    printf '\n'
    if [[ -n "$GH_TOKEN" ]]; then
      if [[ "$GH_TOKEN" =~ ^(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})$ ]]; then
        ( umask 077; printf '%s' "$GH_TOKEN" > /home/opc/fwu-data/.github-token )
        chmod 600 /home/opc/fwu-data/.github-token
        echo "Jeton GitHub enregistré dans /home/opc/fwu-data/.github-token (lecture seule, jamais affiché)."
      else
        echo "Format de jeton GitHub non reconnu : /maj ne sera pas activé. Tu pourras relancer ce script après correction."
      fi
    else
      echo "Jeton non fourni : /maj etat fonctionnera, mais /maj lancer attendra la configuration du jeton."
    fi
    unset GH_TOKEN
  else
    echo "Jeton GitHub existant conservé ; /maj est prêt."
  fi
else
  echo "Script fwu-auto-update.sh absent du pack : /maj devra être configuré lors d'une mise à jour depuis un ordinateur."
fi

step "6/6 — Résultat"
printf 'FWU        : 🟢 (her-v5-bot / her-v5-web)\n'
for bot in guard fdpdlavoc suckme fisc investplus; do printf '%-10s : %s\n' "$bot" "${RESULT[$bot]}"; done
cat <<'MSG'

Dernières étapes, dans Discord :
  • Paramètres du serveur → Rôles : SUCK ME juste sous ton rôle (au-dessus du rôle 0 %), GUARD au-dessus des membres qu'il modère.
  • SUCK ME a besoin de : Rendre muet, Mettre en sourdine, Exclure temporairement, Bannir (rôle 0 % intouchable).
  • Paliers du staff (0 %, 1 %, 5 %, 10 %, 50 %) : à déclarer avec /quota palier (jamais déduits du nom d'un rôle).
  • /quota voir : quotas en vigueur · /sysp diagnostic bots : chaque bot installé doit être 🟢.
  • Préfixes : GUARD +ban · FDPDLAVOC ;mv · SUCK ME =afk · LE FISC -dice · Invest + $abo · FWU en commandes slash.
  • Les commandes slash peuvent mettre jusqu'à 1 h à apparaître partout.
Arrêt d'urgence d'un bot : pm2 stop fwu-<bot>  (FWU reprend ses événements ; ses commandes attendent son retour).
MSG

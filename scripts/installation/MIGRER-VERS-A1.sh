#!/usr/bin/env bash
# FWU — migration de l'ancien VPS vers la machine Ampere A1, lancée depuis TON ORDINATEUR
# (Chromebook / Linux / Mac), jamais depuis un VPS.
#
#   bash MIGRER-VERS-A1.sh verifier   # lecture seule : vérifie les 2 machines, affiche le plan
#   bash MIGRER-VERS-A1.sh migrer     # migration complète (relançable sans risque)
#   bash MIGRER-VERS-A1.sh retour     # retour arrière : arrête la nouvelle, rallume l'ancienne
#
# Déroulé de « migrer » :
#   1. prépare la nouvelle machine (Node 24, PM2, FFmpeg, yt-dlp, PostgreSQL 16) — bots toujours en ligne ;
#   2. arrête les 5 bots sur l'ancienne (le site reste allumé), sauvegarde base + données ;
#   3. copie tout vers la nouvelle (via cet ordinateur : aucune clé n'est posée sur les serveurs) ;
#   4. restaure la base centrale, les .env, les données ; réinstalle site + 5 bots ; démarrage au reboot ;
#   5. vérifie, puis retire les bots de l'ancienne (pour qu'ils ne redémarrent jamais en double).
# Aucun secret n'est affiché. L'ancienne machine n'est jamais effacée.
set -Eeuo pipefail

MODE="${1:-verifier}"
OLD="${FWU_OLD_IP:-82.70.239.240}"
NEW="${FWU_NEW_IP:-130.110.241.14}"
KEY="${FWU_SSH_KEY:-$HOME/ssh-key-2026-11-01.key}"
NODE_VERSION="v24.22.2"
PM2_VERSION="5.4.3"
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ConnectTimeout=20)

step() { printf '\n\033[1m━━━ %s ━━━\033[0m\n' "$*"; }
fail() { printf '\n❌ %s\n' "$*" >&2; exit 1; }
on_old() { ssh "${SSH_OPTS[@]}" "opc@$OLD" "$@"; }
on_new() { ssh "${SSH_OPTS[@]}" "opc@$NEW" "$@"; }

case "$MODE" in verifier|migrer|retour) ;; *) fail "Utilisation : bash $0 verifier|migrer|retour" ;; esac
[[ -f "$KEY" ]] || fail "Clé SSH introuvable : $KEY (variable FWU_SSH_KEY pour une autre)."
chmod 600 "$KEY"
if [[ -f /etc/os-release ]] && grep -q 'Oracle Linux' /etc/os-release && [[ "$(whoami)" == opc ]]; then
  fail "Ce script se lance depuis ton ORDINATEUR (randoinryan@penguin), pas depuis un VPS."
fi

# ── Retour arrière ─────────────────────────────────────────────────────────
if [[ "$MODE" == retour ]]; then
  step "Retour arrière : nouvelle machine arrêtée, ancienne rallumée"
  on_new "export PATH=/usr/local/bin:\$PATH; pm2 stop all >/dev/null 2>&1; pm2 save >/dev/null 2>&1; echo 'Nouvelle machine : processus arrêtés.'" || true
  on_old 'bash -s' <<'REMOTE'
set -e
for c in "$HOME"/.nvm/versions/node/*/bin; do [[ -x "$c/node" ]] && PATH="$c:$PATH"; done
cd ~/her-v5-production && pm2 startOrReload ecosystem.v5.config.cjs --update-env >/dev/null
for b in guard fdpdlavoc suckme fisc; do
  [[ -f ~/fwu-bots/fwu-$b/ecosystem.config.cjs ]] && (cd ~/fwu-bots/fwu-$b && pm2 startOrReload ecosystem.config.cjs --update-env >/dev/null)
done
pm2 save >/dev/null
pm2 ls --no-color
REMOTE
  printf '\n✅ Ancienne machine rallumée.\n'
  exit 0
fi

# ── Vérification (lecture seule) ───────────────────────────────────────────
step "Vérification des deux machines (rien n'est modifié)"
on_old true || fail "Connexion impossible à l'ancien VPS ($OLD)."
on_new true || fail "Connexion impossible à la nouvelle machine ($NEW). As-tu ajouté ssh-key-2026-11-01.key.pub à sa création ?"
ARCH="$(on_new uname -m)"
[[ "$ARCH" == aarch64 ]] || fail "La nouvelle machine n'est pas une Ampere A1 (architecture : $ARCH)."
on_new 'grep -q "^ID=\"ol\"" /etc/os-release && grep -q "^VERSION_ID=\"9" /etc/os-release' \
  || fail "La nouvelle machine doit être sous Oracle Linux 9."
on_new 'sudo -n true' || fail "sudo sans mot de passe indisponible sur la nouvelle machine."
NEW_MEM="$(on_new "awk '/MemTotal/ {print int(\$2/1048576)}' /proc/meminfo")"
NEW_DISK="$(on_new "df -BG --output=avail /home | tail -1 | tr -dc 0-9")"

INFO="$(on_old 'bash -s' <<'REMOTE'
ENV=~/her-v5-production/bot/.env
[[ -f $ENV && -f ~/her-v5-production/.env ]] || { echo "ERREUR=projet introuvable dans ~/her-v5-production"; exit 0; }
val() { grep -E "^$1=" "$2" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'[:space:]'; }
site="$(val SITE_URL "$ENV")"
rest="${site#*://}"; hostport="${rest%%/*}"
echo "SITE_HOST=${hostport%%:*}"
[[ "$hostport" == *:* ]] && echo "SITE_PORT=${hostport##*:}" || echo "SITE_PORT="
echo "NGINX=$(systemctl is-active nginx 2>/dev/null || echo inactive)"
echo "CERTS=$(sudo -n ls /etc/letsencrypt/live 2>/dev/null | grep -v README | tr '\n' ' ')"
echo "SHARED_DB=$(grep -cE '^SHARED_DATABASE_URL=postgres' "$ENV")"
echo "PG_DUMP=$(command -v pg_dump >/dev/null && echo oui || echo non)"
echo "DATA_DIR=$(val PND_DATA_DIR "$ENV")"
echo "SIZE=$(du -sh --exclude=node_modules ~/her-v5-production ~/fwu-bots ~/fwu-data 2>/dev/null | awk '{print $1}' | tr '\n' ' ')"
echo "BOTS=$(ls -d ~/fwu-bots/fwu-* 2>/dev/null | xargs -rn1 basename | tr '\n' ' ')"
REMOTE
)"
get() { printf '%s\n' "$INFO" | sed -n "s/^$1=//p" | head -n 1; }
[[ -z "$(get ERREUR)" ]] || fail "Ancien VPS : $(get ERREUR)."
SITE_HOST="$(get SITE_HOST)"; SITE_PORT="$(get SITE_PORT)"; NGINX="$(get NGINX)"; CERTS="$(get CERTS)"
SHARED_DB="$(get SHARED_DB)"; DATA_DIR="$(get DATA_DIR)"
[[ "$DATA_DIR" == /home/opc/fwu-data ]] || fail "Dossier de données inattendu ($DATA_DIR) : migration automatique non prévue pour ce cas."
[[ "$SHARED_DB" == 0 || "$(get PG_DUMP)" == oui ]] || fail "pg_dump absent de l'ancien VPS : impossible de sauvegarder la base centrale."

case "$SITE_HOST" in
  127.0.0.1|localhost) SITE_KIND="local" ;;
  "$OLD") SITE_KIND="ip" ;;
  *[a-zA-Z]*) SITE_KIND="domaine" ;;
  *) SITE_KIND="autre" ;;
esac

cat <<PLAN

Ancien VPS   : $OLD
Nouvelle A1  : $NEW ($ARCH, ${NEW_MEM} Go de mémoire, ${NEW_DISK} Go libres)
Taille       : $(get SIZE)(projet, bots, données — sans node_modules)
Bots trouvés : $(get BOTS)
Base centrale: $([[ "$SHARED_DB" == 1 ]] && echo "oui (sera copiée)" || echo "non configurée")
Site         : $(case "$SITE_KIND" in
  local) echo "adresse locale (127.0.0.1) : rien à changer" ;;
  ip) echo "adresse IP de l'ancien VPS : remplacée automatiquement par $NEW" ;;
  domaine) echo "domaine $SITE_HOST : à faire pointer vers $NEW après la migration" ;;
  *) echo "$SITE_HOST : vérifie l'adresse après la migration" ;;
esac)
nginx        : $NGINX$([[ -n "$CERTS" ]] && echo " · certificats : $CERTS")

Pendant « migrer » : les 5 bots sont arrêtés environ 15 à 30 min (copie + installation),
le site reste en ligne sur l'ancien VPS. En cas de problème : bash $0 retour
PLAN

[[ "$MODE" == verifier ]] && { printf '\n✅ Vérification terminée. Pour migrer : bash %s migrer\n' "$0"; exit 0; }

# ── 1. Préparation de la nouvelle machine (bots toujours en ligne) ─────────
step "1/5 — Préparation de la nouvelle machine (les bots tournent encore)"
OPEN_PORTS=""
[[ "$NGINX" == active ]] && OPEN_PORTS="http https"
[[ -n "$SITE_PORT" && "$SITE_PORT" != 80 && "$SITE_PORT" != 443 && "$SITE_KIND" != local ]] && OPEN_PORTS="$OPEN_PORTS port:$SITE_PORT"
on_new "bash -s -- '$NODE_VERSION' '$PM2_VERSION' '$OPEN_PORTS'" <<'REMOTE'
set -Eeuo pipefail
NODE_VERSION="$1"; PM2_VERSION="$2"; OPEN_PORTS="$3"
export PATH=/usr/local/bin:$PATH
echo "▶ Paquets système"
sudo dnf -y install tar xz unzip python3 python3-pip tmux >/dev/null
echo "▶ Node.js $NODE_VERSION (ARM64)"
if [[ "$(/usr/local/bin/node -v 2>/dev/null || true)" != "$NODE_VERSION" ]]; then
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-arm64.tar.xz" -o /tmp/node.tar.xz
  sudo tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --exclude='*/CHANGELOG.md' --exclude='*/README.md' --exclude='*/LICENSE'
  rm -f /tmp/node.tar.xz
fi
node -v
echo "▶ PM2 $PM2_VERSION"
command -v pm2 >/dev/null || sudo env PATH="$PATH" npm install -g "pm2@$PM2_VERSION" --no-audit --no-fund >/dev/null
echo "▶ FFmpeg et yt-dlp (musique)"
if ! command -v ffmpeg >/dev/null; then
  rm -rf /tmp/ffmpeg-* && curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz -o /tmp/ffmpeg.tar.xz \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp && sudo install -m 755 /tmp/ffmpeg-*-arm64-static/ffmpeg /tmp/ffmpeg-*-arm64-static/ffprobe /usr/local/bin/ \
    || echo "⚠️ FFmpeg non installé : la musique (FDPDLAVOC) ne fonctionnera pas tant qu'il manque."
  rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-*-arm64-static
fi
python3 -m pip install --user --upgrade --quiet yt-dlp || echo "⚠️ yt-dlp non installé."
echo "▶ PostgreSQL 16"
if ! command -v psql >/dev/null; then
  sudo dnf -y module enable postgresql:16 >/dev/null
  sudo dnf -y install postgresql-server postgresql >/dev/null
fi
[[ -n "$(sudo ls /var/lib/pgsql/data/PG_VERSION 2>/dev/null)" ]] || sudo postgresql-setup --initdb >/dev/null
sudo sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" /var/lib/pgsql/data/postgresql.conf
sudo grep -qE '^host\s+fwu\s+fwu\s+127\.0\.0\.1/32\s+scram-sha-256' /var/lib/pgsql/data/pg_hba.conf \
  || sudo sed -i '1i host    fwu    fwu    127.0.0.1/32    scram-sha-256' /var/lib/pgsql/data/pg_hba.conf
sudo systemctl enable --now postgresql >/dev/null 2>&1
sudo systemctl reload postgresql
if [[ -n "$OPEN_PORTS" ]] && systemctl is-active firewalld >/dev/null 2>&1; then
  echo "▶ Pare-feu : $OPEN_PORTS"
  for p in $OPEN_PORTS; do
    case "$p" in port:*) sudo firewall-cmd -q --permanent --add-port="${p#port:}/tcp" ;; *) sudo firewall-cmd -q --permanent --add-service="$p" ;; esac
  done
  sudo firewall-cmd -q --reload
fi
mkdir -p ~/fwu-migration
echo "✅ Nouvelle machine prête."
REMOTE

# ── 2. Sauvegarde sur l'ancienne machine (début de la coupure des bots) ────
step "2/5 — Arrêt des bots sur l'ancien VPS et sauvegarde (le site reste en ligne)"
on_old "bash -s -- '$NGINX'" <<'REMOTE'
set -Eeuo pipefail
NGINX="$1"
for c in "$HOME"/.nvm/versions/node/*/bin; do [[ -x "$c/node" ]] && PATH="$c:$PATH"; done
pm2 stop her-v5-bot fwu-guard fwu-fdpdlavoc fwu-suckme fwu-fisc >/dev/null 2>&1 || true
pm2 save >/dev/null 2>&1 || true
echo "Bots arrêtés sur l'ancien VPS."
mkdir -p ~/fwu-migration && rm -f ~/fwu-migration/*
URL="$(grep -E '^SHARED_DATABASE_URL=' ~/her-v5-production/bot/.env | tail -n 1 | cut -d= -f2- || true)"
if [[ "$URL" == postgres* ]]; then
  pg_dump --clean --if-exists --no-owner --no-privileges "$URL" > ~/fwu-migration/fwu.sql
  echo "Base centrale sauvegardée ($(du -h ~/fwu-migration/fwu.sql | cut -f1))."
fi
unset URL
extra=""; [[ -f ~/fwu-auto-update.sh ]] && extra="fwu-auto-update.sh"
tar -czf ~/fwu-migration/fwu.tgz -C "$HOME" --exclude=node_modules --exclude='her-v5-production/.output' \
  her-v5-production fwu-bots fwu-data $extra
chmod 600 ~/fwu-migration/*
echo "Données sauvegardées ($(du -h ~/fwu-migration/fwu.tgz | cut -f1))."
if [[ "$NGINX" == active ]]; then
  paths="etc/nginx/conf.d"; [[ -d /etc/letsencrypt ]] && paths="$paths etc/letsencrypt"
  sudo tar -czf ~/fwu-migration/nginx.tgz -C / $paths && sudo chown "$(id -u):$(id -g)" ~/fwu-migration/nginx.tgz && chmod 600 ~/fwu-migration/nginx.tgz
  echo "Configuration nginx et certificats sauvegardés."
fi
REMOTE

# ── 3. Copie (via cet ordinateur) ──────────────────────────────────────────
step "3/5 — Copie vers la nouvelle machine"
scp "${SSH_OPTS[@]}" -3 "opc@$OLD:fwu-migration/*" "opc@$NEW:fwu-migration/"
echo "Copie terminée."

# ── 4. Restauration et installation sur la nouvelle machine ────────────────
step "4/5 — Restauration et installation (10 à 20 min)"
on_new "bash -s -- '$OLD' '$NEW'" <<'REMOTE'
set -Eeuo pipefail
OLD="$1"; NEW="$2"
export PATH=/usr/local/bin:$PATH
cd "$HOME"
echo "▶ Données et configuration"
tar -xzf ~/fwu-migration/fwu.tgz -C "$HOME"
for f in her-v5-production/.env her-v5-production/bot/.env fwu-bots/fwu-*/.env; do
  [[ -f "$f" ]] || continue
  sed -i "s/$(printf '%s' "$OLD" | sed 's/\./\\./g')/$NEW/g" "$f"   # adresse de l'ancien VPS → nouvelle
  chmod 600 "$f"
done
# yt-dlp / FFmpeg : chemins de cette machine
YTDLP="$HOME/.local/bin/yt-dlp"
for f in her-v5-production/bot/.env fwu-bots/fwu-fdpdlavoc/.env; do
  [[ -f "$f" ]] || continue
  [[ -x "$YTDLP" ]] && { grep -q '^PND_YTDLP_PATH=' "$f" && sed -i "s#^PND_YTDLP_PATH=.*#PND_YTDLP_PATH=$YTDLP#" "$f" || echo "PND_YTDLP_PATH=$YTDLP" >> "$f"; }
  command -v ffmpeg >/dev/null && { grep -q '^PND_FFMPEG_PATH=' "$f" && sed -i "s#^PND_FFMPEG_PATH=.*#PND_FFMPEG_PATH=$(command -v ffmpeg)#" "$f" || echo "PND_FFMPEG_PATH=$(command -v ffmpeg)" >> "$f"; }
done

URL="$(grep -E '^SHARED_DATABASE_URL=' her-v5-production/bot/.env | tail -n 1 | cut -d= -f2- || true)"
if [[ "$URL" == postgres* && -f ~/fwu-migration/fwu.sql ]]; then
  echo "▶ Base centrale"
  eval "$(python3 -I -c 'import sys,urllib.parse as u;p=u.urlparse(sys.argv[1]);import shlex;print("DB_USER=%s DB_PASS=%s DB_NAME=%s"%(shlex.quote(p.username or ""),shlex.quote(u.unquote(p.password or "")),shlex.quote(p.path.lstrip("/"))))' "$URL")"
  [[ "$DB_USER" =~ ^[a-z_][a-z0-9_]*$ && "$DB_NAME" =~ ^[a-z_][a-z0-9_]*$ && "$DB_PASS" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "Adresse de base inattendue."; exit 1; }
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q >/dev/null <<SQL
SET password_encryption = 'scram-sha-256';
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SQL
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
  psql "$URL" -v ON_ERROR_STOP=1 -q -f ~/fwu-migration/fwu.sql >/dev/null
  echo "Base centrale restaurée."
  unset DB_PASS
fi
unset URL

if [[ -f ~/fwu-migration/nginx.tgz ]]; then
  echo "▶ nginx"
  sudo dnf -y install nginx >/dev/null
  sudo tar -xzf ~/fwu-migration/nginx.tgz -C /
  sudo setsebool -P httpd_can_network_connect 1 >/dev/null 2>&1 || true
  sudo nginx -t >/dev/null 2>&1 && sudo systemctl enable --now nginx >/dev/null 2>&1 && sudo systemctl reload nginx || echo "⚠️ nginx : configuration à vérifier (sudo nginx -t)."
fi

echo "▶ Site et FWU (dépendances, tests, build, démarrage)"
cd "$HOME/her-v5-production"
PND_SUPABASE_MIGRATIONS_APPLIED=YES bash scripts/deploy-pnd-v5-oracle.sh > ~/fwu-migration/deploy.log 2>&1 \
  || { tail -n 40 ~/fwu-migration/deploy.log; echo "Déploiement de FWU échoué (journal : ~/fwu-migration/deploy.log)."; exit 1; }
echo "FWU et le site sont en ligne."

echo "▶ Les 4 bots"
broken=""
for b in guard fdpdlavoc suckme fisc; do
  [[ -f "$HOME/fwu-bots/fwu-$b/installer.sh" ]] || continue
  bash "$HOME/fwu-bots/fwu-$b/installer.sh" </dev/null > ~/fwu-migration/install-$b.log 2>&1 || broken="$broken $b"
done
[[ -z "$broken" ]] || { echo "Bots en erreur :$broken (journaux : ~/fwu-migration/install-*.log)"; exit 1; }

echo "▶ Démarrage automatique au redémarrage du serveur"
sudo env PATH="$PATH" pm2 startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null
pm2 save >/dev/null
REMOTE

# ── 5. Vérification, puis retrait des bots de l'ancienne machine ───────────
step "5/5 — Vérification"
STATUS="$(on_new 'bash -s' <<'REMOTE'
export PATH=/usr/local/bin:$PATH
pm2 jlist 2>/dev/null | node -e '
let raw="";process.stdin.on("data",c=>raw+=c).on("end",()=>{
  const want=["her-v5-bot","her-v5-web","fwu-guard","fwu-fdpdlavoc","fwu-suckme","fwu-fisc"];
  const rows=JSON.parse(raw||"[]");
  for (const name of want){const p=rows.find(r=>r.name===name);console.log(`${name}=${p?.pm2_env?.status??"absent"}`);}
});'
sleep 15
for b in her-v5-bot fwu-guard fwu-fdpdlavoc fwu-suckme fwu-fisc; do
  echo "$b.db=$(pm2 logs "$b" --nostream --lines 200 2>/dev/null | grep -oE 'shared_db_(up|down|not_configured)' | tail -n 1)"
done
echo "web.http=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || echo 000)"
REMOTE
)"
printf '%s\n' "$STATUS" | sed 's/=/ : /'
if printf '%s\n' "$STATUS" | grep -qE '^(her-v5-bot|her-v5-web|fwu-[a-z]+)=(stopped|errored|absent)'; then
  fail "Un processus n'est pas en ligne sur la nouvelle machine. Rien n'est retiré de l'ancienne. Pour revenir en arrière : bash $0 retour"
fi

step "Retrait des bots de l'ancien VPS (pour qu'ils ne redémarrent jamais en double)"
on_old 'bash -s' <<'REMOTE'
for c in "$HOME"/.nvm/versions/node/*/bin; do [[ -x "$c/node" ]] && PATH="$c:$PATH"; done
pm2 delete her-v5-bot fwu-guard fwu-fdpdlavoc fwu-suckme fwu-fisc >/dev/null 2>&1 || true
pm2 save >/dev/null 2>&1 || true
echo "Ancien VPS : bots retirés (le site her-v5-web y reste allumé ; dossiers et données conservés)."
REMOTE

cat <<END

✅ Migration terminée : les 5 bots et le site tournent sur $NEW.
$(case "$SITE_KIND" in
  domaine) echo "👉 À faire : chez ton fournisseur de domaine, fais pointer $SITE_HOST (enregistrement A) vers $NEW.
   Ensuite, sur l'ancien VPS : pm2 stop her-v5-web && pm2 save" ;;
  ip) echo "👉 L'adresse du site est maintenant http://$NEW$([[ -n "$SITE_PORT" ]] && echo ":$SITE_PORT")/ (si tu utilises la connexion Discord du site,
   mets à jour l'adresse de redirection dans le portail développeur Discord). Ancien site : pm2 stop her-v5-web && pm2 save" ;;
  *) echo "👉 Ancien site devenu inutile : sur l'ancien VPS, pm2 stop her-v5-web && pm2 save" ;;
esac)
Retour arrière possible à tout moment : bash $0 retour
Pour te connecter à la nouvelle machine : ssh -i $KEY opc@$NEW
END

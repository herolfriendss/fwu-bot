#!/usr/bin/env bash
# FWU — installe la base centrale PostgreSQL sur le VPS Oracle (Oracle Linux 8/9).
#
#   sudo bash deploy/oracle/install-shared-db.sh /home/opc/her-v5-production/bot/.env
#
# - installe PostgreSQL, l'écoute reste limitée à 127.0.0.1 (les 5 bots sont sur ce VPS) ;
# - crée l'utilisateur et la base « fwu » avec un mot de passe aléatoire ;
# - écrit SHARED_DATABASE_URL dans le .env de FWU (chmod 600). Le mot de passe n'est
#   jamais affiché ni écrit ailleurs. Les 4 autres bots le reçoivent en relançant
#   leur installer.sh (recopie des réglages communs).
# - les tables sont créées par les bots eux-mêmes au démarrage (migrations versionnées).
# Ré-exécutable : ne recrée rien de ce qui existe, ne change pas un mot de passe déjà réglé.
set -euo pipefail

FWU_ENV="${1:-/home/opc/her-v5-production/bot/.env}"
DB_NAME="fwu"
DB_USER="fwu"

fail() { printf '❌ %s\n' "$1" >&2; exit 1; }
info() { printf '▶ %s\n' "$1"; }

[[ "$(id -u)" -eq 0 ]] || fail "Lance ce script avec sudo."
[[ -f "$FWU_ENV" ]] || fail "Fichier .env de FWU introuvable : $FWU_ENV"

if grep -qE '^SHARED_DATABASE_URL=postgres' "$FWU_ENV"; then
  info "SHARED_DATABASE_URL est déjà réglée dans $FWU_ENV : rien à faire."
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  info "Installation de PostgreSQL"
  dnf -y module enable postgresql:16 >/dev/null 2>&1 || true
  dnf -y install postgresql-server postgresql >/dev/null
fi
if [[ ! -s /var/lib/pgsql/data/PG_VERSION ]]; then
  info "Initialisation du cluster"
  postgresql-setup --initdb >/dev/null
fi
# Écoute locale uniquement ; authentification par mot de passe (scram-sha-256) en TCP local.
sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" /var/lib/pgsql/data/postgresql.conf
if ! grep -qE '^host\s+fwu\s+fwu\s+127\.0\.0\.1/32\s+scram-sha-256' /var/lib/pgsql/data/pg_hba.conf; then
  sed -i '1i host    fwu    fwu    127.0.0.1/32    scram-sha-256' /var/lib/pgsql/data/pg_hba.conf
fi
systemctl enable --now postgresql >/dev/null
systemctl reload postgresql

info "Création de l'utilisateur et de la base"
PASSWORD="$(openssl rand -hex 24)"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL >/dev/null
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} PASSWORD '${PASSWORD}';
  END IF;
END \$\$;
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"

umask 077
{
  printf '\n# Base centrale FWU (deploy/oracle/install-shared-db.sh, %s)\n' "$(date +%F)"
  printf 'SHARED_DATABASE_URL=postgres://%s:%s@127.0.0.1:5432/%s\n' "$DB_USER" "$PASSWORD" "$DB_NAME"
} >> "$FWU_ENV"
chmod 600 "$FWU_ENV"
unset PASSWORD

info "Vérification de la connexion"
URL="$(grep -E '^SHARED_DATABASE_URL=' "$FWU_ENV" | tail -n 1 | cut -d= -f2-)"
psql "$URL" -tAc 'SELECT 1' | grep -q 1 || fail "Connexion impossible : vérifie /var/lib/pgsql/data/pg_hba.conf."
unset URL

printf '\n✅ Base centrale prête. Ensuite :\n'
printf '   1. pm2 restart her-v5-bot   (FWU crée les tables au démarrage)\n'
printf '   2. relance installer.sh de chaque bot (GUARD, FDPDLAVOC, SUCK ME, LE FISC)\n'
printf '   3. sauvegarde quotidienne conseillée : pg_dump fwu > /home/opc/fwu-data/fwu-$(date +%%F).sql\n'

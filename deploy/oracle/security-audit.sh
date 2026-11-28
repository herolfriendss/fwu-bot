#!/usr/bin/env bash
# FWU — read-only VPS security inspection for Oracle Linux.
# Usage: bash deploy/oracle/security-audit.sh (run as the Unix user that owns PM2, usually opc)
# Override paths with FWU_HOME / FWU_PROJECT_DIR.
# This script never changes files, services, firewall rules, databases or PM2 state.
set -uo pipefail

HOME_DIR="${FWU_HOME:-/home/opc}"
PROJECT_DIR="${FWU_PROJECT_DIR:-$HOME_DIR/her-v5-production}"
BOT_DIR="$PROJECT_DIR/bot"
DATA_DIR="$HOME_DIR/fwu-data"
WARNINGS=0

section() { printf '\n===== %s =====\n' "$1"; }
info() { printf 'INFO  %s\n' "$1"; }
warn() { printf 'WARN  %s\n' "$1"; WARNINGS=$((WARNINGS + 1)); }
unknown() { printf 'N/A   %s\n' "$1"; }

section "Host identity"
printf 'Date UTC: '; date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || true
printf 'User: '; id 2>/dev/null || true
printf 'OS: '; . /etc/os-release 2>/dev/null; printf '%s %s\n' "${NAME:-unknown}" "${VERSION_ID:-unknown}"
printf 'Kernel: '; uname -r 2>/dev/null || true
printf 'SELinux: '
if command -v getenforce >/dev/null 2>&1; then getenforce; else unknown "getenforce is unavailable"; fi

section "Process and PM2 ownership"
ps -eo user=,comm= 2>/dev/null | awk '$2=="node" || $2=="PM2" || $2=="pm2" || $2=="postgres" {count[$1" "$2]++} END {for (k in count) printf "%-24s %d\n", k, count[k]}' | sort || true
if command -v pm2 >/dev/null 2>&1; then
  pm2 status 2>&1 || warn "PM2 is installed but its daemon/status could not be read for this user."
else
  warn "PM2 is not available in PATH for the current user."
fi

section "Listening TCP sockets"
if command -v ss >/dev/null 2>&1; then
  ss -ltnp 2>&1 || warn "Could not read listening sockets."
else
  unknown "ss command is unavailable"
fi

section "Host firewall"
if command -v firewall-cmd >/dev/null 2>&1; then
  state="$(firewall-cmd --state 2>/dev/null || true)"
  if [[ "$state" == "running" ]]; then
    info "firewalld is running."
    firewall-cmd --get-active-zones 2>&1 || true
    firewall-cmd --list-all 2>&1 || warn "firewalld is active but its rules could not be read."
  else
    warn "firewalld is not running (state: ${state:-unknown})."
    if command -v nft >/dev/null 2>&1; then
      info "Checking nftables directly because firewalld is not active."
      nft list ruleset 2>&1 | sed -n '1,100p' || warn "Could not read nftables rules (root may be required)."
    fi
  fi
elif command -v nft >/dev/null 2>&1; then
  info "firewalld is absent; nftables is available."
  nft list ruleset 2>&1 | sed -n '1,100p' || warn "Could not read nftables rules (root may be required)."
elif command -v iptables >/dev/null 2>&1; then
  warn "No firewalld/nft command detected; iptables INPUT rules:"
  iptables -S INPUT 2>&1 || true
else
  warn "No host firewall inspection tool found."
fi
info "Oracle Cloud Security Lists / NSGs are external to this host and must be checked in the OCI Console."

section "Effective SSH daemon settings"
SSHD=""
if command -v sshd >/dev/null 2>&1; then SSHD="$(command -v sshd)"; fi
if [[ -n "$SSHD" ]]; then
  SSH_OUTPUT="$("$SSHD" -T 2>/dev/null || sudo -n "$SSHD" -T 2>/dev/null || true)"
  if [[ -n "$SSH_OUTPUT" ]]; then
    printf '%s\n' "$SSH_OUTPUT" | awk '$1=="port" || $1=="permitrootlogin" || $1=="passwordauthentication" || $1=="pubkeyauthentication" || $1=="authenticationmethods" || $1=="maxauthtries" || $1=="x11forwarding" || $1=="allowusers" || $1=="allowgroups" || $1=="pubkeyacceptedalgorithms"'
    if grep -qi '^permitrootlogin yes$' <<<"$SSH_OUTPUT"; then warn "SSH permits direct root login."; fi
    if grep -qi '^passwordauthentication yes$' <<<"$SSH_OUTPUT"; then warn "SSH password authentication is enabled; verify this is intentional and protected."; fi
    if ! grep -qi '^pubkeyauthentication yes$' <<<"$SSH_OUTPUT"; then warn "SSH public-key authentication is not explicitly enabled."; fi
  else
    unknown "Could not read effective sshd configuration; run this script with sudo."
  fi
else
  unknown "sshd binary is not installed or not in PATH."
fi

section "Security-related services"
for service in firewalld fail2ban dnf-automatic.timer; do
  if systemctl list-unit-files "$service" --no-legend 2>/dev/null | grep -q "$service"; then
    printf '%-22s active=' "$service"
    systemctl is-active "$service" 2>/dev/null || true
    printf '%-22s enabled=' ""
    systemctl is-enabled "$service" 2>/dev/null || true
  else
    printf '%-22s not installed / no unit\n' "$service"
  fi
done

section "Pending security updates (read-only check)"
if command -v dnf >/dev/null 2>&1; then
  UPDATE_OUTPUT="$(dnf -q check-update --security 2>&1)"
  UPDATE_CODE=$?
  case "$UPDATE_CODE" in
    0) info "No pending security updates reported by DNF." ;;
    100) warn "DNF reports security updates available; review before applying."; printf '%s\\n' "$UPDATE_OUTPUT" | sed -n '1,30p' ;;
    *) warn "Could not check DNF security updates (exit $UPDATE_CODE)."; printf '%s\\n' "$UPDATE_OUTPUT" | sed -n '1,10p' ;;
  esac
else
  unknown "dnf is unavailable"
fi

section "Runtime versions and disk"
printf 'Node: '; command -v node >/dev/null 2>&1 && node --version || echo "not in PATH"
printf 'npm:  '; command -v npm >/dev/null 2>&1 && npm --version || echo "not in PATH"
printf 'Disk: '; df -h "$HOME_DIR" 2>/dev/null | tail -n 1 || df -h / | tail -n 1
printf 'Memory: '; free -h 2>/dev/null | awk '/^Mem:/ {print $3 " used / " $2 " total"}' || true

section "Sensitive file permissions (values are never displayed)"
check_mode() {
  file="$1"
  [[ -e "$file" ]] || return 0
  stat -c '%a %U:%G %n' "$file" 2>/dev/null || { warn "Could not stat $file"; return; }
  mode="$(stat -c '%a' "$file" 2>/dev/null || echo 777)"
  if [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 0077) != 0 )); then
    warn "$file is accessible to group or others (mode $mode)."
  fi
}
check_mode "$PROJECT_DIR/.env"
check_mode "$BOT_DIR/.env"
check_mode "$DATA_DIR/.github-token"
check_mode "$DATA_DIR/.alerte-webhook"
check_mode "$DATA_DIR/.sauvegarde-distante"
check_mode "$HOME_DIR/.config/rclone/rclone.conf"
if [[ -d "$HOME_DIR/fwu-bots" ]]; then
  while IFS= read -r -d '' file; do check_mode "$file"; done < <(find "$HOME_DIR/fwu-bots" -maxdepth 3 -type f -name .env -print0 2>/dev/null)
fi

section "Secret distribution (presence/counts only; no values or hashes)"
python3 - "$PROJECT_DIR/.env" "$BOT_DIR/.env" "$HOME_DIR/fwu-bots" <<'PY'
from pathlib import Path
import sys

root_env, bot_env, bots_root = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
paths = [root_env, bot_env]
if bots_root.is_dir():
    paths.extend(sorted(bots_root.glob("fwu-*/.env")))
values = {}
for path in paths:
    parsed = {}
    try:
        for raw in path.read_text(errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            parsed[key.strip()] = value.strip().strip("'").strip('"')
    except OSError:
        continue
    for key, value in parsed.items():
        if value and not value.startswith(("REPLACE_", "CHANGEME", "TODO")):
            values.setdefault(key, []).append(value)

for key in ("BOT_SYNC_SECRET", "WEBHOOK_ENCRYPTION_KEY", "SHARED_DATABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY", "SESSION_SECRET", "ANTHROPIC_API_KEY"):
    entries = values.get(key, [])
    if not entries:
        print(f"{key}: absent from inspected env files")
    else:
        distinct = len(set(entries))
        print(f"{key}: present in {len(entries)}/{len(paths)} env files; distinct configured values={distinct}")
        if key in ("BOT_SYNC_SECRET", "WEBHOOK_ENCRYPTION_KEY", "SHARED_DATABASE_URL") and len(entries) > 1 and distinct == 1:
            print(f"  REVIEW: same {key} value is shared by multiple processes.")
PY

section "Backup and monitoring status"
STATUS="$DATA_DIR/sauvegarde-status.json"
if [[ -s "$STATUS" ]]; then
  python3 - "$STATUS" <<'PY'
import json, sys, time
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    at = int(data.get("at") or 0)
    age_h = round(max(0, time.time() - at) / 3600, 1) if at else None
    print("last backup ok:", data.get("ok"))
    print("offsite copy:", data.get("offsite"))
    print("backup age hours:", age_h if age_h is not None else "unknown")
    print("step:", str(data.get("step") or "unknown")[:120])
except Exception as exc:
    print("Backup status unreadable:", type(exc).__name__)
PY
else
  warn "No backup status file found at $STATUS."
fi
[[ -s "$HOME_DIR/fwu-surveillance.mjs" ]] && info "External surveillance script is present." || warn "External surveillance script is missing."
if crontab -l 2>/dev/null | grep -E 'fwu-sauvegarde|fwu-surveillance' >/dev/null; then
  info "FWU backup/surveillance entries are present in this user's crontab."
else
  warn "No FWU backup/surveillance entry found in this user's crontab."
fi

section "Summary"
printf 'Warnings: %s\n' "$WARNINGS"
echo "Read-only inspection finished. No secrets were printed and no server state was changed."
echo "Important: inspect OCI Security Lists/NSGs separately; this host cannot prove cloud firewall policy."

#!/usr/bin/env bash
# Read-only Oracle Linux / PM2 / Node preflight. Does not change the server.
set -Eeuo pipefail
section(){ printf '\n===== %s =====\n' "$1"; }
section "OS"
cat /etc/os-release 2>/dev/null | grep -E '^(NAME|VERSION|PRETTY_NAME)=' || true
uname -a
section "CPU / architecture"
printf 'arch: '; uname -m
if command -v lscpu >/dev/null 2>&1; then lscpu | grep -E '^(Architecture|CPU\(s\)|Model name|Vendor ID):' || true; fi
section "Memory"
free -h 2>/dev/null || true
section "Disk"
df -hT /
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT 2>/dev/null || true
section "Runtime"
command -v node >/dev/null 2>&1 && node --version || echo "node: absent"
command -v npm >/dev/null 2>&1 && npm --version || echo "npm: absent"
command -v pm2 >/dev/null 2>&1 && pm2 --version || echo "pm2: absent"
section "PM2 processes"
if command -v pm2 >/dev/null 2>&1; then pm2 status; else echo "PM2 absent"; fi
section "Ports"
if command -v ss >/dev/null 2>&1; then ss -ltnp 2>/dev/null | grep -E ':(80|443|3000|3001|3002|3003|3004)\b' || true; fi
section "Project candidates"
for d in "$HOME/her-v5-production" "$HOME/PND_Assist_V5" "$HOME/pnd-assist-v5-installation" /home/opc/her-v5-production; do
  if [[ -d "$d" ]]; then
    printf '%s\n' "$d"
    [[ ! -f "$d/package.json" ]] || node -e "const p=require('$d/package.json'); console.log('  project:',p.name,'node:',p.engines?.node||'unspecified')" 2>/dev/null || true
  fi
done
section "OCI metadata (if available)"
if command -v curl >/dev/null 2>&1; then
  curl -fsS --max-time 2 -H 'Authorization: Bearer Oracle' http://169.254.169.254/opc/v2/instance/ 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("shape:",d.get("shape")); print("region:",d.get("region")); print("availabilityDomain:",d.get("availabilityDomain"))' 2>/dev/null \
    || echo "OCI metadata unavailable from this host/user; check shape in Oracle Console."
fi
section "End"
echo "Inspection only: no files, services, firewall rules, databases or PM2 processes were changed."

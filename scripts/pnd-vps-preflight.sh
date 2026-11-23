#!/usr/bin/env bash
# Read-only diagnostic for the PND Assist VPS. Does not print secrets or change services.
set -Eeuo pipefail

printf '\n=== PND VPS PREFLIGHT (read-only) ===\n'
printf 'Date: '; date -Is 2>/dev/null || date
printf 'Host: '; hostname 2>/dev/null || printf 'unknown\n'
printf 'OS: '; ( . /etc/os-release 2>/dev/null && printf '%s %s\n' "${PRETTY_NAME:-unknown}" "${VERSION_ID:-}" ) || uname -srm
printf 'Architecture: '; uname -m
printf 'Working directory: '; pwd

printf '\n=== PROJECT ===\n'
if [[ -f package.json ]]; then
  node -e 'try { const p=require("./package.json"); console.log(`package=${p.name ?? "unknown"} required_node=${p.engines?.node ?? "unspecified"}`) } catch { console.log("package.json unreadable") }' 2>/dev/null || true
else
  echo 'package.json absent in current directory (not project root)'
fi
for f in .env bot/.env; do
  [[ -f "$f" ]] && echo "$f: present (contents not displayed)" || echo "$f: absent"
done
if [[ -d bot/data ]]; then
  echo 'bot/data: present'
  find bot/data -maxdepth 1 -type f -printf '  %f (%s bytes)\n' 2>/dev/null | sort | head -30
else
  echo 'bot/data: absent'
fi

printf '\n=== RUNTIME ===\n'
node --version 2>&1 || true
npm --version 2>&1 || true
printf 'npm registry: '; npm config get registry 2>/dev/null || true
printf 'PM2: '; if command -v pm2 >/dev/null 2>&1; then pm2 --version 2>&1 | tail -1; else echo 'not installed / not in PATH'; fi

printf '\n=== PM2 PROCESSES (names/status only) ===\n'
if command -v pm2 >/dev/null 2>&1; then
  pm2 jlist 2>/dev/null | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try {
        const rows=JSON.parse(s);
        if (!rows.length) console.log("no PM2 processes");
        for (const p of rows) console.log(`${p.name ?? "?"}\t${p.pm2_env?.status ?? "?"}\tpid=${p.pid ?? 0}\tcwd=${p.pm2_env?.pm_cwd ?? "?"}`);
      } catch { console.log("PM2 process list unavailable"); }
    });
  ' || true
else
  echo 'PM2 unavailable'
fi

printf '\n=== DISK ===\n'
df -h . 2>/dev/null | tail -n +1 || true

printf '\n=== NPM REGISTRY CONNECTIVITY ===\n'
if command -v getent >/dev/null 2>&1; then
  getent hosts registry.npmjs.org | head -2 || echo 'DNS lookup failed for registry.npmjs.org'
fi
npm ping --fetch-retries=0 --fetch-timeout=10000 2>&1 || echo 'npm ping failed (network/DNS/proxy/TLS issue)'

printf '\n=== END — no files changed, no services restarted ===\n'

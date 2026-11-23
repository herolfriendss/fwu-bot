#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
REPORT="$ROOT/PND_V5_LOCAL_TEST_REPORT.txt"
: > "$REPORT"
exec > >(tee -a "$REPORT") 2>&1

fail() { echo; echo "BLOQUANT: $*" ; exit 1; }
section() { echo; echo "============================================================"; echo "$*"; echo "============================================================"; }

section "PND ASSIST V5 — PREPARATION ET RECETTE LOCALE"
echo "Dossier : $ROOT"
echo "Date : $(date -Is)"
echo "Machine : $(uname -a)"

command -v node >/dev/null 2>&1 || fail "Node.js absent. Installer Node.js 24 LTS."
command -v npm >/dev/null 2>&1 || fail "npm absent."
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
echo "Node : $(node --version)"
echo "npm  : $(npm --version)"
[ "$NODE_MAJOR" -ge 24 ] || fail "Node.js 24 minimum requis. Version détectée : $(node --version). Rien n'a été installé."

[ -f package-lock.json ] || fail "package-lock.json racine manquant."
[ -f bot/package-lock.json ] || fail "bot/package-lock.json manquant."
[ -f .env.example ] || echo "INFO: .env.example racine absent."
[ -f bot/.env.example ] || echo "INFO: bot/.env.example absent."

section "INSTALLATION DES DEPENDANCES RACINE"
npm ci --no-audit --no-fund

section "INSTALLATION DES DEPENDANCES BOT"
npm --prefix bot ci --no-audit --no-fund

section "TESTS BOT"
npm --prefix bot test

section "SYNTAXE JAVASCRIPT BOT"
find bot -type f -name '*.js' -not -path '*/node_modules/*' -print0 | xargs -0 -r -n1 node --check
echo "Syntaxe JavaScript : OK"

section "TESTS DASHBOARD"
npm test

section "LINT"
npm run lint

section "TYPESCRIPT"
if npm exec --no -- tsc --version >/dev/null 2>&1; then
  npm exec --no -- tsc --noEmit
else
  echo "INFO: aucun tsconfig/compilateur TypeScript exploitable détecté; étape ignorée."
fi

section "BUILD DASHBOARD"
npm run build

section "VERIFICATIONS DE CONFIGURATION (SANS AFFICHER LES SECRETS)"
for key in DISCORD_TOKEN SITE_URL BOT_SYNC_SECRET PND_OWNER_DISCORD_ID PND_COFOUNDER_DISCORD_IDS; do
  if grep -Eq "^${key}=.+" bot/.env 2>/dev/null; then
    echo "$key : présent dans bot/.env"
  else
    echo "$key : ABSENT ou vide dans bot/.env"
  fi
done
echo
echo "Aucun déploiement n'a été lancé."
echo "Les tests Discord réels nécessitent un serveur de test, un bot de test et les secrets locaux."
echo "Rapport enregistré dans : $REPORT"
section "RECETTE LOCALE TERMINEE"

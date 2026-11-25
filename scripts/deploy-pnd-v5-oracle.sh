#!/usr/bin/env bash
# PND Assist V5 deployment for the existing Oracle/Linux project directory.
# Run as the project owner (e.g. opc), never as a public/anonymous user.
# Requires a separately confirmed Supabase migration step before the first release.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"

fail() { printf 'ERREUR: %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }

[[ -f package.json && -f bot/index.js && -f package-lock.json && -f bot/package-lock.json ]] \
  || fail "Lance ce script depuis le projet PND Assist V5 complet (package.json et bot/index.js requis)."

EXPECTED_ROOT="${PND_EXPECTED_ROOT:-/home/opc/her-v5-production}"
[[ "$(pwd -P)" == "$EXPECTED_ROOT" ]] \
  || fail "Racine inattendue : $(pwd -P). La production attendue est $EXPECTED_ROOT. Pour une recette staging, ne lance pas ce script de production."
[[ -f .env && -f bot/.env ]] || fail "Fichiers .env manquants. Copie les deux .env.example et renseigne-les avant le déploiement."

# Node 24 is installed through nvm on the Oracle VPS, while /usr/local/bin
# still holds an older one. A script started without a terminal (the bot's own
# /maj) never loads the profile that puts nvm first, so look for a suitable
# Node ourselves before giving up.
node_major_of() { "$1" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0; }
NODE_MAJOR="$(command -v node >/dev/null 2>&1 && node_major_of node || echo 0)"
if (( NODE_MAJOR < 24 )); then
  for candidate in "$HOME"/.nvm/versions/node/*/bin/node; do
    [[ -x "$candidate" ]] || continue
    if (( $(node_major_of "$candidate") >= 24 )); then
      PATH="$(dirname "$candidate"):$PATH"
      export PATH
      NODE_MAJOR="$(node_major_of node)"
      echo "Node 24 trouvé via nvm : $(dirname "$candidate")"
      break
    fi
  done
fi
(( NODE_MAJOR >= 24 )) || fail "Node.js 24 minimum requis (version actuelle : $(node --version 2>/dev/null || echo absente))."
command -v npm >/dev/null 2>&1 || fail "npm est introuvable."

# Confirm migrations explicitly; they are applied in Supabase SQL Editor, never by this script.
[[ "${PND_SUPABASE_MIGRATIONS_APPLIED:-}" == "YES" ]] \
  || fail "Après avoir appliqué les migrations supabase/migrations dans Supabase, relance avec PND_SUPABASE_MIGRATIONS_APPLIED=YES."

# Validate configuration without printing any secret values.
node --input-type=module <<'NODE'
import fs from 'node:fs';
const parse = (file) => {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
};
const web = parse('.env');
const bot = parse('bot/.env');
const requiredWeb = [
  'VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET','DISCORD_OAUTH_REDIRECT_URI','DISCORD_BOT_TOKEN',
  'PND_OWNER_DISCORD_ID','SESSION_SECRET','BOT_SYNC_SECRET',
];
const requiredBot = ['DISCORD_TOKEN','SITE_URL','BOT_SYNC_SECRET','V4_ALLOWED_GUILD_IDS','PND_OWNER_DISCORD_ID','WEBHOOK_ENCRYPTION_KEY'];
const placeholder = /^(?:REPLACE_|YOUR_|OWNER_DISCORD_ID|sb_(?:publishable|secret)_REPLACE|https:\/\/(?:YOUR_|REPLACE))/i;
const missing = [
  ...requiredWeb.filter(k => !web[k] || placeholder.test(web[k])).map(k => `.env:${k}`),
  ...requiredBot.filter(k => !bot[k] || placeholder.test(bot[k])).map(k => `bot/.env:${k}`),
];
if (missing.length) { console.error(`Configuration incomplète : ${missing.join(', ')}`); process.exit(2); }
if (web.SESSION_SECRET.length < 32 || web.BOT_SYNC_SECRET.length < 32 || bot.BOT_SYNC_SECRET.length < 32 || web.SESSION_SECRET === web.BOT_SYNC_SECRET) {
  console.error('SESSION_SECRET et BOT_SYNC_SECRET doivent contenir au moins 32 caractères et être différents.'); process.exit(2);
}
if (web.BOT_SYNC_SECRET !== bot.BOT_SYNC_SECRET) { console.error('BOT_SYNC_SECRET doit être identique dans .env et bot/.env.'); process.exit(2); }
if (web.DISCORD_INTERACTIONS_PUBLIC_KEY) { console.error('Laisse DISCORD_INTERACTIONS_PUBLIC_KEY vide : le bot Oracle traite les interactions via sa passerelle.'); process.exit(2); }
if (web.VITE_SUPABASE_PUBLISHABLE_KEY !== web.SUPABASE_PUBLISHABLE_KEY) { console.error('VITE_SUPABASE_PUBLISHABLE_KEY et SUPABASE_PUBLISHABLE_KEY doivent être identiques.'); process.exit(2); }
if (web.DISCORD_BOT_TOKEN !== bot.DISCORD_TOKEN) { console.error('DISCORD_BOT_TOKEN et DISCORD_TOKEN doivent être le même token de bot.'); process.exit(2); }
// Single-owner policy (bot/owner-config.js refuses the same cases at startup).
if (web.PND_OWNER_DISCORD_ID !== bot.PND_OWNER_DISCORD_ID) { console.error('PND_OWNER_DISCORD_ID doit être identique dans .env et bot/.env.'); process.exit(2); }
if (web.PND_OWNER_DISCORD_IDS || bot.PND_OWNER_DISCORD_IDS) { console.error('PND_OWNER_DISCORD_IDS (pluriel) est interdit : un seul PND_OWNER_DISCORD_ID.'); process.exit(2); }
const owner = web.PND_OWNER_DISCORD_ID.trim();
if (!/^\d{5,25}$/.test(owner)) { console.error('PND_OWNER_DISCORD_ID doit être un seul identifiant Discord numérique.'); process.exit(2); }
const cofounders = String(bot.PND_COFOUNDER_DISCORD_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
if (cofounders.includes(owner)) { console.error('Le propriétaire ne peut pas figurer dans PND_COFOUNDER_DISCORD_IDS (le bot refuserait de démarrer).'); process.exit(2); }
try {
  const site = new URL(bot.SITE_URL);
  const callback = new URL(web.DISCORD_OAUTH_REDIRECT_URI);
  if (site.protocol !== 'https:' || callback.protocol !== 'https:' || site.origin !== callback.origin) throw new Error();
} catch { console.error('SITE_URL et DISCORD_OAUTH_REDIRECT_URI doivent être des URL HTTPS valides.'); process.exit(2); }
if (!/^[0-9a-f]{64}$/i.test(bot.WEBHOOK_ENCRYPTION_KEY)) {
  console.error('WEBHOOK_ENCRYPTION_KEY doit contenir exactement 64 caractères hexadécimaux.'); process.exit(2);
}
if (String(bot.PND_MZ_ENABLED ?? 'false').toLowerCase() === 'true') {
  console.error('Sécurité : PND_MZ_ENABLED=true est interdit dans ce déploiement PND.'); process.exit(2);
}
const allowed = bot.V4_ALLOWED_GUILD_IDS.split(/[\s,;]+/).filter(Boolean);
const permitted = new Set(['1562643485981544559', '1570484435239833701']);
if (!allowed.includes('1562643485981544559') || allowed.some(id => !permitted.has(id))) {
  console.error('V4_ALLOWED_GUILD_IDS doit contenir le serveur PND et éventuellement le hub de logs, sans autre serveur.'); process.exit(2);
}
console.log('Configuration validée : propriétaires PND, secrets synchronisés, token bot partagé et allowlist PND uniquement.');
NODE

chmod 600 .env bot/.env

# Preserve private configuration and SQLite runtime data before installing anything.
BACKUP_BASE="${PND_BACKUP_DIR:-$HOME/pnd-v5-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_BASE/$STAMP"
install -d -m 700 "$BACKUP_DIR"
BACKUP_ITEMS=(.env bot/.env)
# Data folder: bot/data, or the shared FWU folder (PND_DATA_DIR in bot/.env) when several bots share it.
DATA_DIR="bot/data"
SHARED_DATA="$(grep -E '^PND_DATA_DIR=' bot/.env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'[:space:]' || true)"
[[ -z "$SHARED_DATA" ]] || DATA_DIR="$SHARED_DATA"
[[ ! -d "$DATA_DIR" ]] || BACKUP_ITEMS+=("$DATA_DIR")
# Consistent online copies of every SQLite database (VACUUM INTO), safe while the bots run.
if [[ -d "$DATA_DIR" ]]; then
  install -d -m 700 "$BACKUP_DIR/sqlite"
  BACKUP_SQLITE_DIR="$BACKUP_DIR/sqlite" DATA_DIR="$DATA_DIR" node --no-warnings --input-type=module <<'NODE'
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const out = process.env.BACKUP_SQLITE_DIR;
const dir = process.env.DATA_DIR;
for (const name of readdirSync(dir).filter((f) => f.endsWith('.sqlite'))) {
  const db = new DatabaseSync(join(dir, name));
  db.exec(`VACUUM INTO '${out}/${name.replace(/'/g, "''")}'`);
  db.close();
  console.log(`Copie cohérente SQLite : ${name}`);
}
NODE
fi
tar -czf "$BACKUP_DIR/pnd-v5-private-backup.tar.gz" "${BACKUP_ITEMS[@]}"
chmod 600 "$BACKUP_DIR/pnd-v5-private-backup.tar.gz"
printf 'Sauvegarde privée créée : %s/pnd-v5-private-backup.tar.gz\n' "$BACKUP_DIR"

info "Mémoire disponible pour la vérification et le build"
# Small VPS (1 GB): TypeScript and the build need ~1.5 GB. Add a swap file once if needed,
# and give Node a bigger heap for this script only (the bots keep their own limits).
MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
SWAP_MB="$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)"
if (( MEM_MB + SWAP_MB < 3500 )) && [[ ! -e /swapfile-fwu ]]; then
  if sudo -n true 2>/dev/null; then
    sudo dd if=/dev/zero of=/swapfile-fwu bs=1M count=4096 status=none \
      && sudo chmod 600 /swapfile-fwu && sudo mkswap /swapfile-fwu >/dev/null && sudo swapon /swapfile-fwu \
      && { grep -q '^/swapfile-fwu ' /etc/fstab || echo '/swapfile-fwu none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null; } \
      && echo "Fichier d'échange de 4 Go ajouté (/swapfile-fwu)." || echo "Ajout du fichier d'échange impossible : on continue."
  else
    echo "Mémoire faible (${MEM_MB} Mo) et sudo indisponible : pas de fichier d'échange ajouté."
  fi
fi
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=2048"
# --include=dev is explicit on purpose: this script runs the test suite, the
# type check and the build, which all live in devDependencies. Launched from
# the bot's own /maj, the process inherits NODE_ENV=production from PM2 and
# npm would otherwise skip them, failing later on "vitest: command not found".
info "Installation reproductible des dépendances (dashboard)"
npm ci --include=dev --no-audit --no-fund
info "Installation reproductible des dépendances (bot)"
npm --prefix bot ci --include=dev --no-audit --no-fund

info "Tests complets du bot"
npm --prefix bot test
info "Banc d'essai : toutes les commandes slash et préfixe"
npm --prefix bot run smoke
# Petit VPS (moins de 1,8 Go) : la vérification TypeScript et le build demandent ~1,5 Go et
# peuvent durer des heures en mémoire d'échange. L'archive peut alors livrer le site déjà
# vérifié et construit (.output + .output/PREBUILT) : réutilisé SEULEMENT si l'empreinte
# des sources est identique à celle de cette archive ; sinon, vérification et build normaux.
PREBUILT_OK=0
if [[ -s .output/server/index.mjs && -s .output/PREBUILT ]] && (( MEM_MB < 1800 )); then
  expected="$(sed -n 's/^fingerprint=//p' .output/PREBUILT)"
  actual="$(python3 -I scripts/source-fingerprint.py . 2>/dev/null || true)"
  if [[ -n "$expected" && "$expected" == "$actual" ]]; then
    PREBUILT_OK=1
    echo "Site déjà vérifié et construit livré avec l'archive (empreinte identique) : TypeScript et build sautés (mémoire : ${MEM_MB} Mo)."
  else
    echo "Site livré non conforme aux sources : vérification et build complets."
  fi
fi
info "Lint (informatif : ~10 000 écarts de formatage Prettier préexistants, non bloquant)"
if (( PREBUILT_OK )); then
  echo "Lint sauté sur ce petit serveur (informatif seulement)."
else
  npm run lint >/dev/null 2>&1 && echo "Lint propre." || echo "Lint : écarts présents (formatage). Non bloquant."
fi
info "Contrôle du catalogue de commandes (100 maximum, aucun doublon)"
npm --prefix bot run audit:commands
if (( PREBUILT_OK )); then
  info "Tests dashboard"
  echo "Sautés sur ce petit serveur : le site livré a été testé et construit avant l'envoi (empreinte identique)."
else
  info "Tests dashboard"
  npm test
fi
if (( ! PREBUILT_OK )); then
  info "Vérification TypeScript"
  ./node_modules/.bin/tsc --noEmit
fi
info "Regénération du paquet bot isolé"
npm run package:bot
if (( ! PREBUILT_OK )); then
  info "Build de production du dashboard"
  npm run build
fi
[[ -s .output/server/index.mjs ]] || fail "Build terminé sans produire .output/server/index.mjs."

if ! command -v pm2 >/dev/null 2>&1; then
  info "Installation PM2 dans l'environnement Node courant"
  npm install --global pm2 --no-audit --no-fund
fi
command -v pm2 >/dev/null 2>&1 || fail "PM2 n'est pas disponible dans le PATH après installation."

unset NODE_OPTIONS
info "Activation de la configuration PM2 V5"
# Ne jamais supprimer les processus V4 historiques. Vérifier que les processus
# V5 existants pointent déjà vers cette racine avant de les recharger.
pm2 jlist | ROOT_FOR_PM2="$ROOT" node --input-type=module -e '
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const rows = JSON.parse(raw);
const expected = process.env.ROOT_FOR_PM2;
// ecosystem.v5.config.cjs: the web runs from the root, the bot from bot/.
const expectedCwd = { "her-v5-web": expected, "her-v5-bot": `${expected}/bot` };
for (const name of ["her-v5-web", "her-v5-bot"]) {
  const current = rows.find((p) => p.name === name);
  if (current && current.pm2_env?.pm_cwd !== expectedCwd[name]) {
    console.error(`${name} existe déjà avec cwd=${current.pm2_env?.pm_cwd}; attendu=${expectedCwd[name]}. Arrêt préventif.`);
    process.exit(2);
  }
}
console.log("Processus V5 existants compatibles avec la racine cible.");
' 
pm2 startOrReload ecosystem.v5.config.cjs --update-env

info "Contrôle des processus V5"
for attempt in $(seq 1 20); do
  if pm2 jlist | node --input-type=module -e '
    let raw=""; for await (const chunk of process.stdin) raw += chunk;
    const rows = JSON.parse(raw);
    const names = new Set(rows.filter(p => p.pm2_env?.status === "online").map(p => p.name));
    process.exit(names.has("her-v5-web") && names.has("her-v5-bot") ? 0 : 1);
  '; then break; fi
  [[ "$attempt" -lt 20 ]] || { pm2 status; pm2 logs --lines 60 --nostream; fail "Les deux processus PM2 V5 ne sont pas en ligne."; }
  sleep 2
done

info "Contrôle HTTP local du dashboard"
node --input-type=module <<'NODE'
let last = 'aucune réponse';
for (let i = 0; i < 25; i++) {
  try {
    const response = await fetch('http://127.0.0.1:3000/', { redirect: 'manual', signal: AbortSignal.timeout(3000) });
    if (response.status >= 200 && response.status < 400) {
      console.log(`Dashboard HTTP ${response.status} sur 127.0.0.1:3000`);
      process.exit(0);
    }
    last = `HTTP ${response.status}`;
  } catch (error) { last = error instanceof Error ? error.message : String(error); }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
console.error(`Dashboard non disponible après redémarrage : ${last}`);
process.exit(1);
NODE
pm2 save

printf '\nDéploiement V5 local terminé.\n'
printf 'Processus : her-v5-web et her-v5-bot\n'
printf 'Sauvegarde : %s\n' "$BACKUP_DIR/pnd-v5-private-backup.tar.gz"
printf 'À faire une seule fois pour la persistance au redémarrage système : exécuter la commande affichée par « pm2 startup ».\n'
printf 'Vérification : pm2 status && pm2 logs her-v5-bot --lines 80\n'

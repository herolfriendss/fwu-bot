#!/usr/bin/env bash
set -euo pipefail
TARGET="$HOME/her-v2-test/bot"
SOURCE="$(cd "$(dirname "$0")" && pwd)/bot"
if [[ ! -d "$TARGET" ]]; then echo "Dossier de test absent: $TARGET"; exit 1; fi
mkdir -p "$TARGET/systems/sysplus"
mkdir -p "$TARGET/music"
cp "$SOURCE/index.js" "$TARGET/index.js"
cp "$SOURCE/voice-commands.js" "$TARGET/voice-commands.js"
cp "$SOURCE/voice-permissions.js" "$TARGET/voice-permissions.js"
cp "$SOURCE/dog-commands.js" "$TARGET/dog-commands.js"
cp "$SOURCE/music/music.js" "$TARGET/music/music.js"
cp "$SOURCE/music/music-policy.js" "$TARGET/music/music-policy.js"
cp "$SOURCE/systems/sysplus/"*.js "$TARGET/systems/sysplus/"
cp "$SOURCE/package.json" "$TARGET/package.json"
cd "$TARGET"
npm install
node --check index.js
node --check voice-commands.js
node --check voice-permissions.js
node --check dog-commands.js
node --check music/music.js
node --check music/music-policy.js
node --check systems/sysplus/commands.js
node --check systems/sysplus/permissions.js
node --test systems/sysplus/permissions.test.js
echo "SYS+ copié et testé dans $TARGET. Aucun processus PM2 n'a été modifié."

#!/usr/bin/env bash
set -euo pipefail

command -v node >/dev/null || { echo "Node.js 24+ est requis." >&2; exit 1; }
node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 24) { console.error("Node.js 24+ requis, version actuelle: " + process.version); process.exit(1); }'
command -v ffmpeg >/dev/null || { echo "FFmpeg est requis pour PND Music." >&2; exit 1; }
python3 -m pip install --user --upgrade yt-dlp
YTDLP_BIN="$(python3 -c 'import site,os; print(os.path.join(site.USER_BASE,"bin","yt-dlp"))')"
"$YTDLP_BIN" --version
ffmpeg -version | head -n 1
printf '\nAjoute ces variables à bot/.env si elles ne sont pas déjà configurées :\n'
printf 'PND_YTDLP_PATH=%s\n' "$YTDLP_BIN"
printf 'PND_FFMPEG_PATH=%s\n' "$(command -v ffmpeg)"

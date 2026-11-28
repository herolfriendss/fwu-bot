#!/usr/bin/env bash
set -euo pipefail

command -v node >/dev/null || { echo "Node.js 24+ est requis." >&2; exit 1; }
node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 24) { console.error("Node.js 24+ requis, version actuelle: " + process.version); process.exit(1); }'
command -v ffmpeg >/dev/null || { echo "FFmpeg est requis pour PND Music." >&2; exit 1; }
python3 -m pip install --user --upgrade yt-dlp
YTDLP_BIN="$(python3 -c 'import site,os; print(os.path.join(site.USER_BASE,"bin","yt-dlp"))')"
"$YTDLP_BIN" --version
ffmpeg -version | head -n 1
if ! ffmpeg -hide_banner -encoders 2>/dev/null | grep 'libopus' >/dev/null; then
  echo "FFmpeg doit inclure l'encodeur libopus." >&2
  exit 1
fi
command -v espeak-ng >/dev/null || command -v piper >/dev/null || echo "Facultatif : installe espeak-ng (sudo apt-get install -y espeak-ng) pour la lecture vocale /lecture." >&2
printf '\nAjoute ces variables à bot/.env si elles ne sont pas déjà configurées :\n'
printf 'PND_YTDLP_PATH=%s\n' "$YTDLP_BIN"
printf 'PND_FFMPEG_PATH=%s\n' "$(command -v ffmpeg)"

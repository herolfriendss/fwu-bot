import { spawn } from "node:child_process";
import { normalizeAudioHost } from "./audio-source-policy.js";

const TRUSTED_MEDIA_SUFFIXES = ["googlevideo.com", "youtube.com", "sndcdn.com", "soundcloud.com"];
const TRUSTED_PAGE_HOSTS = new Set(["youtube.com", "www.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be", "soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"]);

function isTrustedMediaHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/\.$/, "");
  return TRUSTED_MEDIA_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function normalizeMusicQuery(input) {
  const value = String(input ?? "").trim();
  if (!value || value.length > 500) throw new Error("Indique un lien YouTube/SoundCloud ou un titre de 1 à 500 caractères.");
  if (/^https?:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw new Error("Lien musical invalide."); }
    if (url.protocol !== "https:" || !TRUSTED_PAGE_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password) {
      throw new Error("Source non prise en charge. Utilise un lien YouTube ou SoundCloud sécurisé.");
    }
    return url.toString();
  }
  return `ytsearch1:${value}`;
}

export async function resolveMusicInput(input, options = {}) {
  const query = options.rawSearch ? String(input) : normalizeMusicQuery(input);
  const spawnProcess = options.spawn ?? spawn;
  const binary = options.ytDlpPath ?? process.env.PND_YTDLP_PATH ?? "yt-dlp";
  const timeoutMs = options.timeoutMs ?? 25_000;
  const maxOutputBytes = options.maxOutputBytes ?? 2_000_000;
  const args = ["--dump-single-json", "--no-warnings", "--no-playlist", "--no-call-home", "--format", "bestaudio/best", "--", query];

  const result = await new Promise((resolve, reject) => {
    let child;
    try { child = spawnProcess(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); }
    catch { reject(new Error("Le moteur yt-dlp est indisponible. Installe yt-dlp sur le serveur du bot.")); return; }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("La recherche musicale a dépassé le délai autorisé.")); }, timeoutMs);
    timer.unref?.();
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout) > maxOutputBytes) { child.kill("SIGKILL"); finish(new Error("La réponse du moteur musical est trop volumineuse.")); }
    });
    child.stderr.on("data", (chunk) => { if (stderr.length < 8_000) stderr += chunk.toString("utf8"); });
    child.once("error", (error) => finish(new Error(error.code === "ENOENT" ? "yt-dlp n'est pas installé sur le serveur du bot." : "Impossible de démarrer le moteur musical.")));
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error(/private|unavailable|age-restricted/i.test(stderr) ? "Cette vidéo est privée, indisponible ou soumise à une restriction." : "Impossible de récupérer ce morceau. Vérifie le lien ou réessaie plus tard."));
      try { finish(null, JSON.parse(stdout)); } catch { finish(new Error("Le moteur musical a renvoyé une réponse invalide.")); }
    });
  });

  const excluded = options.exclude ?? new Set();
  const entry = Array.isArray(result.entries)
    ? result.entries.find((item) => (item?.url || item?.formats?.length) && !excluded.has(item.webpage_url) && !excluded.has(String(item.title ?? "").toLowerCase()))
    : result;
  if (!entry) throw new Error("Aucun résultat musical trouvé.");
  const mediaUrl = entry.url ?? entry.formats?.find((format) => format.acodec && format.acodec !== "none")?.url;
  if (!mediaUrl) throw new Error("Aucun flux audio exploitable n'a été trouvé.");
  let parsed;
  try { parsed = new URL(mediaUrl); } catch { throw new Error("Le flux audio retourné est invalide."); }
  if (parsed.protocol !== "https:" || !isTrustedMediaHost(parsed.hostname)) throw new Error("Le moteur a retourné une source audio non autorisée.");
  return {
    title: String(entry.title ?? "Titre inconnu").slice(0, 250),
    artist: String(entry.uploader ?? entry.artist ?? "").slice(0, 150),
    url: parsed.toString(),
    duration: Number.isFinite(Number(entry.duration)) ? Number(entry.duration) : 0,
    thumbnail: typeof entry.thumbnail === "string" && /^https:\/\//i.test(entry.thumbnail) ? entry.thumbnail : null,
    source: entry.extractor_key ?? "YouTube",
    webpageUrl: typeof entry.webpage_url === "string" ? entry.webpage_url : null,
    allowedMediaHost: normalizeAudioHost(parsed.hostname),
  };
}

/** Search query for a track similar to `track` (same artist first, else title words). */
export function autoplaySearch(track) {
  const clean = (text) => String(text ?? "").replace(/\(.*?\)|\[.*?\]|official|video|clip|lyrics|audio|paroles|hd|4k/gi, " ").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  const artist = clean(String(track?.artist ?? "").replace(/\s*-\s*topic\s*$/i, ""));
  const title = clean(track?.title).split(" ").slice(0, 4).join(" ");
  const seed = artist || title;
  if (!seed) return null;
  return `ytsearch6:${seed.slice(0, 120)} ${artist ? "mix" : "similaire"}`;
}

/** Parses yt-dlp's flat search output into at most `limit` safe results. Pure. */
export function parseSearchResults(json, limit = 5) {
  const entries = Array.isArray(json?.entries) ? json.entries : [];
  return entries.map((entry) => {
    const id = String(entry?.id ?? "");
    const url = /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
    return url ? {
      url,
      title: String(entry.title ?? "Sans titre").replace(/[\r\n]/g, " ").slice(0, 90),
      channel: String(entry.channel ?? entry.uploader ?? "").slice(0, 40),
      duration: Number.isFinite(Number(entry.duration)) ? Number(entry.duration) : null,
    } : null;
  }).filter(Boolean).slice(0, limit);
}

/** Searches YouTube for a title and returns up to 5 results (no download). */
export async function searchMusic(input, options = {}) {
  const value = String(input ?? "").trim();
  if (!value || value.length > 200 || /^https?:\/\//i.test(value)) throw new Error("Indique un titre à rechercher (1 à 200 caractères, pas un lien).");
  const spawnProcess = options.spawn ?? spawn;
  const binary = options.ytDlpPath ?? process.env.PND_YTDLP_PATH ?? "yt-dlp";
  const args = ["--dump-single-json", "--flat-playlist", "--no-warnings", "--no-call-home", "--", `ytsearch5:${value}`];
  const json = await new Promise((resolve, reject) => {
    let child;
    try { child = spawnProcess(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); }
    catch { reject(new Error("Le moteur yt-dlp est indisponible.")); return; }
    let stdout = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("La recherche a dépassé le délai autorisé.")); }, options.timeoutMs ?? 20_000);
    timer.unref?.();
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); if (stdout.length > 1_000_000) child.kill("SIGKILL"); });
    child.stderr.on("data", () => {});
    child.once("error", (error) => { clearTimeout(timer); reject(new Error(error.code === "ENOENT" ? "yt-dlp n'est pas installé sur le serveur du bot." : "Impossible de lancer la recherche.")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error("Recherche impossible pour le moment. Réessaie."));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Réponse de recherche invalide.")); }
    });
  });
  return parseSearchResults(json, 5);
}

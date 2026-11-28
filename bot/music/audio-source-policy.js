import { isIP } from "node:net";

export function normalizeAudioHost(input) {
  const value = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!value || value.includes("*") || value.includes("/") || value.includes("://")) {
    throw new Error("Indique un nom d’hôte exact, par exemple audio.example.org.");
  }
  const url = new URL(`https://${value}`);
  if (
    url.hostname !== value ||
    url.port ||
    url.pathname !== "/" ||
    url.hash ||
    isIP(url.hostname) ||
    !url.hostname.includes(".") ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local") ||
    url.hostname.endsWith(".internal")
  ) {
    throw new Error("Seul un nom DNS public exact est accepté, sans port ni joker.");
  }
  return url.hostname;
}

export function validateAudioUrl(input, allowedHosts = []) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    throw new Error("Indique une URL de flux audio HTTPS valide.");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hash ||
    isIP(url.hostname)
  ) {
    throw new Error(
      "La source doit être une URL HTTPS publique, sans identifiant ni port personnalisé.",
    );
  }

  const host = normalizeAudioHost(url.hostname);
  const allowed = new Set(allowedHosts.map(normalizeAudioHost));
  if (!allowed.has(host)) {
    throw new Error(
      `L’hôte ${host} n’est pas autorisé sur ce serveur. Un administrateur doit l’ajouter avec \`=radio host-add ${host}\`.`,
    );
  }
  return url;
}

export function isPublicIpv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  if (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && c <= 2))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  )
    return false;
  return true;
}

/** Keep only non-sensitive extractor headers needed by public media CDNs. */
export function sanitizeAudioRequestHeaders(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const allowed = new Set(["user-agent", "accept", "accept-language"]);
  const headers = {};
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = String(rawName).trim().toLowerCase();
    if (!allowed.has(name) || (typeof rawValue !== "string" && typeof rawValue !== "number")) continue;
    const value = String(rawValue).trim();
    if (!value || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) continue;
    headers[name] = value;
  }
  return headers;
}

export function isPlayableAudioContentType(value) {
  const type = String(value ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (type.includes("mpegurl") || type.includes("m3u") || type.includes("dash+xml")) return false;
  return type.startsWith("audio/") || type === "application/octet-stream";
}

/** `filter` is an ffmpeg audio filter chain from music-extras AUDIO_FILTERS (never user text). */
export function ffmpegOpusArgs(filter = null) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-protocol_whitelist",
    "pipe",
    "-i",
    "pipe:0",
    "-vn",
    ...(filter ? ["-af", filter] : []),
    "-c:a",
    "libopus",
    "-b:a",
    "96k",
    "-f",
    "ogg",
    "pipe:1",
  ];
}

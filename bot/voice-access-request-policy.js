export const VOICE_ACCESS_REQUEST_TTL = 24 * 60 * 60 * 1000;
const SNOWFLAKE = /^\d{5,25}$/;
const VOICE_CHAT_REQUEST_PERMISSIONS = (1n << 10n) | (1n << 11n) | (1n << 16n);

export function isDiscordSnowflake(value) {
  return typeof value === "string" && SNOWFLAKE.test(value);
}

export function parseVoiceChannelId(value) {
  const raw = String(value ?? "").trim();
  const mention = raw.match(/^<#(\d{5,25})>$/);
  const url = raw.match(/(?:channels\/\d+\/)(\d{5,25})/);
  const id = mention?.[1] ?? url?.[1] ?? raw;
  return SNOWFLAKE.test(id) ? id : null;
}

export function canRequestFromVoiceChat(permissionBitfield) {
  try {
    const bits = BigInt(permissionBitfield);
    return (bits & VOICE_CHAT_REQUEST_PERMISSIONS) === VOICE_CHAT_REQUEST_PERMISSIONS;
  } catch {
    return false;
  }
}

export function isVoiceAccessRequestExpired(createdAt, now = Date.now()) {
  return !Number.isFinite(createdAt) || now - createdAt > VOICE_ACCESS_REQUEST_TTL;
}

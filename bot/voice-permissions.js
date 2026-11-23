export const CONNECT = 1n << 20n;
export const MANAGE_CHANNELS = 1n << 4n;
export const ADMINISTRATOR = 1n << 3n;
export const MOVE_MEMBERS = 1n << 24n;

const VOICE_COMMANDS = new Set(["=panel", "=pv", "=access", "=unaccess"]);

export function canManageVoice(permissions) {
  try {
    const bits = BigInt(permissions);
    return (bits & (MANAGE_CHANNELS | ADMINISTRATOR)) !== 0n;
  } catch { return false; }
}

export function canUseVoiceCommand(rawCommand, permissions, memberRoleIds, access, isOwner = false, adminPlusRoleId = null, sysPlusRoleId = null) {
  // =unpv restores what =pv changed: same authorization.
  const command = rawCommand === "=unpv" ? "=pv" : rawCommand;
  if (!VOICE_COMMANDS.has(command)) return false;
  let bits;
  try { bits = BigInt(permissions); } catch { return false; }
  if (isOwner || (bits & ADMINISTRATOR) !== 0n) return true;
  if (sysPlusRoleId && memberRoleIds.includes(sysPlusRoleId)) return true;
  if (command === "=access" || command === "=unaccess") return canManageVoice(bits);

  // ADMIN+ can use the general panel and private toggle, but not individual
  // access-grant commands (=access / =unaccess).
  if (adminPlusRoleId && memberRoleIds.includes(adminPlusRoleId)) return true;

  const allowed = access?.[command === "=panel" ? "panelRoleIds" : "pvRoleIds"];
  if (allowed == null) return canManageVoice(bits);
  if (!Array.isArray(allowed)) return false;
  return memberRoleIds.some((id) => allowed.includes(id));
}

export function connectState(allow, deny) {
  return (BigInt(deny) & CONNECT) !== 0n ? false : (BigInt(allow) & CONNECT) !== 0n ? true : null;
}

// Lock every existing role AND member overwrite: @everyone alone is insufficient.
export function privateVoicePlan(overwrites, everyoneId, actorId, botId) {
  const targets = new Map(overwrites.map((o) => [o.id, { id: o.id, type: o.type, Connect: false }]));
  targets.set(everyoneId, { id: everyoneId, type: 0, Connect: false });
  targets.set(actorId, { id: actorId, type: 1, Connect: true });
  targets.set(botId, { id: botId, type: 1, Connect: true });
  return [...targets.values()];
}

export function restoreVoicePlan(current, original) {
  const targets = new Map(original.map((o) => [o.id, o]));
  for (const o of current) if (!targets.has(o.id)) targets.set(o.id, { id: o.id, type: o.type, allow: "0", deny: "0" });
  return [...targets.values()].map((o) => ({ id: o.id, type: o.type, Connect: connectState(o.allow, o.deny) }));
}

export function voiceCommand(content) {
  const name = content.trim().split(/\s+/)[0]?.toLowerCase();
  return ["=panel", "=pv", "=unpv", "=access", "=unaccess", "=demandevocal", "=menotte", "=unmenotte", "=menotteinfo", "=vocalpresence", "=anti-moove", "=anti-move", "=wakeup"].includes(name) ? (name === "=anti-move" ? "=anti-moove" : name) : null;
}

// Her? V4 — règles d’automatisation pures (aucun Discord/DB).
export const AUTOMATION_MIN_INTERVAL = 5;
export const AUTOMATION_MAX_INTERVAL = 10_080;
export const AUTOMATION_MAX_CONTENT = 2_000;

export function clampInterval(raw) {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value)) return AUTOMATION_MIN_INTERVAL;
  return Math.min(AUTOMATION_MAX_INTERVAL, Math.max(AUTOMATION_MIN_INTERVAL, value));
}

export function sanitizeAutomationContent(raw, max = AUTOMATION_MAX_CONTENT) {
  return String(raw ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

export function renderAutomation(template, { server = "le serveur", user = "membre" } = {}) {
  return String(template ?? "")
    .replaceAll("{server}", String(server))
    .replaceAll("{user}", String(user))
    .slice(0, AUTOMATION_MAX_CONTENT);
}

export function nextRunAt(now, intervalMinutes) {
  return now + clampInterval(intervalMinutes) * 60_000;
}

export function isDue(nextRun, now = Date.now()) {
  return Number.isFinite(Number(nextRun)) && Number(nextRun) <= now;
}

export function autoRolePlan(roleIds, { botPosition = 0, rolePositions = {}, memberRoleIds = [] } = {}) {
  const current = new Set(memberRoleIds);
  const applicable = [];
  const skipped = [];
  for (const roleId of [...new Set(Array.isArray(roleIds) ? roleIds : [])]) {
    if (current.has(roleId)) continue;
    const position = Number(rolePositions[roleId]);
    if (!Number.isFinite(position)) skipped.push({ roleId, reason: "missing" });
    else if (position >= botPosition) skipped.push({ roleId, reason: "hierarchy" });
    else applicable.push(roleId);
  }
  return { applicable, skipped };
}

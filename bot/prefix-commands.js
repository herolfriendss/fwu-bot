// Pure message-command logic shared with the panel's tests.
export function resolvePrefixCommand(commands, content, memberPermissions = "0") {
  const name = content.trim().split(/\s+/)[0]?.toLowerCase();
  if (!name?.startsWith("=")) return null;
  const command = commands.find((c) => `=${c.name}` === name);
  if (!command) return null;
  let allowed = command.permission === "0";
  try {
    const actual = BigInt(memberPermissions);
    const required = BigInt(command.permission);
    allowed ||= (actual & 8n) !== 0n || (actual & required) === required;
  } catch { /* Fail closed for restricted commands. */ }
  return { content: allowed ? command.response : "Tu n’as pas la permission d’utiliser cette commande.", allowed };
}

/** Normalize the requested "+" alias to the canonical "=" prefix. */
export function normalizePrefixAlias(content) {
  const value = String(content ?? "");
  return value.replace(/^(\\s*)\\+/, "$1=");
}

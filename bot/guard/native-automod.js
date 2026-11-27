// AutoMod natif de Discord : des règles appliquées par Discord lui-même, qui protègent
// le serveur même quand tous les bots sont tombés. /automod natif les crée une fois.
export const NATIVE_RULE_PREFIX = "Protection · ";

// Discord enum values (AutoModerationRuleTriggerType / EventType / ActionType).
const TRIGGER = { Keyword: 1, Spam: 3, MentionSpam: 5 };
const MESSAGE_SEND = 1;
const BLOCK = 1;

export const PHISHING_PATTERNS = Object.freeze([
  "(?:free|gratuit|offert)[^\\n]{0,15}nitro",
  "(?:dlscord|discorcl|disc0rd|discordgift|steamcommunnity|stearncommunity)\\.",
]);

/** Rule payloads to create, without those that already exist (matched by name). */
export function nativeRulePlan(existingNames = [], { exemptRoleIds = [] } = {}) {
  const exempt = { exemptRoles: exemptRoleIds.slice(0, 20) };
  const block = [{ type: BLOCK, metadata: { customMessage: "Message bloqué par la protection du serveur." } }];
  const rules = [
    { name: `${NATIVE_RULE_PREFIX}spam de mentions`, eventType: MESSAGE_SEND, triggerType: TRIGGER.MentionSpam, triggerMetadata: { mentionTotalLimit: 6, mentionRaidProtectionEnabled: true }, actions: block, enabled: true, ...exempt },
    { name: `${NATIVE_RULE_PREFIX}spam`, eventType: MESSAGE_SEND, triggerType: TRIGGER.Spam, actions: [{ type: BLOCK }], enabled: true, ...exempt },
    { name: `${NATIVE_RULE_PREFIX}phishing et faux Nitro`, eventType: MESSAGE_SEND, triggerType: TRIGGER.Keyword, triggerMetadata: { regexPatterns: [...PHISHING_PATTERNS] }, actions: block, enabled: true, ...exempt },
  ];
  const have = new Set(existingNames);
  return rules.filter((rule) => !have.has(rule.name));
}

/** Creates the missing rules. Returns { created, kept, failed } (names). */
export async function ensureNativeAutomod(guild, { exemptRoleIds = [], reason = "Protection native du serveur" } = {}) {
  const existing = await guild.autoModerationRules.fetch();
  const names = [...existing.values()].map((rule) => rule.name);
  const plan = nativeRulePlan(names, { exemptRoleIds });
  const created = [];
  const failed = [];
  for (const rule of plan) {
    try { await guild.autoModerationRules.create({ ...rule, reason }); created.push(rule.name); }
    catch { failed.push(rule.name); } // ex. one Spam / MentionSpam rule per server already exists under another name
  }
  return { created, kept: names.filter((name) => name.startsWith(NATIVE_RULE_PREFIX)), failed };
}

/** Lit et vérifie la configuration. Ne journalise jamais les secrets. */

const SNOWFLAKE = /^\d{17,20}$/;

function list(value) {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const errors = [];
  const need = (key) => {
    const v = String(env[key] ?? "").trim();
    if (!v) errors.push(`${key} manquant`);
    return v;
  };
  const id = (key) => {
    const v = need(key);
    if (v && !SNOWFLAKE.test(v)) errors.push(`${key} n'est pas un identifiant Discord valide`);
    return v;
  };

  const config = {
    discordToken: need("AGENTS_DISCORD_TOKEN"),
    guildId: id("AGENTS_GUILD_ID"),
    channelId: id("AGENTS_CHANNEL_ID"),
    ownerId: id("AGENTS_OWNER_ID"),
    readChannelIds: new Set(list(env.AGENTS_READ_CHANNEL_IDS)),
    watchedBotIds: new Set(list(env.AGENTS_WATCHED_BOT_IDS)),
    databaseUrl: need("AGENTS_DATABASE_URL"),
    anthropicKeyPresent: Boolean(String(env.ANTHROPIC_API_KEY ?? "").trim()),
    monthlyBudgetUsd: Number(env.AGENTS_MONTHLY_BUDGET_USD ?? 10),
    digestHour: Number(env.AGENTS_DIGEST_HOUR ?? 9),
    pseudonymSecret: need("AGENTS_PSEUDONYM_SECRET"),
    githubToken: String(env.AGENTS_GITHUB_TOKEN ?? "").trim(),
    githubRepo: String(env.AGENTS_GITHUB_REPO ?? "").trim(),
  };

  for (const cid of [...config.readChannelIds, ...config.watchedBotIds]) {
    if (!SNOWFLAKE.test(cid)) errors.push(`identifiant invalide dans les listes : ${cid}`);
  }
  if (config.readChannelIds.size === 0)
    errors.push("AGENTS_READ_CHANNEL_IDS est vide : indique au moins un salon public à lire");
  if (config.readChannelIds.has(config.channelId))
    errors.push("le salon #agents ne doit pas faire partie des salons lus");
  if (!Number.isFinite(config.monthlyBudgetUsd) || config.monthlyBudgetUsd <= 0)
    errors.push("AGENTS_MONTHLY_BUDGET_USD doit être un nombre positif");
  if (!Number.isInteger(config.digestHour) || config.digestHour < 0 || config.digestHour > 23)
    errors.push("AGENTS_DIGEST_HOUR doit être une heure entre 0 et 23");
  if (config.pseudonymSecret && config.pseudonymSecret.length < 32)
    errors.push("AGENTS_PSEUDONYM_SECRET doit faire au moins 32 caractères");
  if (config.githubToken && !/^[\w.-]+\/[\w.-]+$/.test(config.githubRepo))
    errors.push("AGENTS_GITHUB_REPO doit avoir la forme propriétaire/dépôt");

  return { config, errors };
}

import { ActivityType } from "discord.js";

export const PND_PRESENCE_INTERVAL_MS = 75_000;

const text = (value, fallback, max = 100) => {
  const cleaned = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  return (cleaned || fallback).slice(0, max);
};

/**
 * Activities supported by Discord bot accounts: name, state and type.
 * Rich Presence assets, timestamps and buttons belong to application/game
 * activities and are not available to a normal bot Gateway presence.
 */
export function buildPndPresenceProfiles(guild) {
  const guildName = text(guild?.name, "communauté PND", 48);
  const memberCount = Number(guild?.memberCount);
  const memberLabel = Number.isSafeInteger(memberCount) && memberCount > 0
    ? `${memberCount} membres sur PND`
    : "Communauté privée PND";

  return [
    {
      name: `PND Assist • ${guildName}`,
      type: ActivityType.Watching,
      state: "Sécurité · Modération · Vocal",
    },
    {
      name: memberLabel,
      type: ActivityType.Playing,
      state: "Bot privé du serveur PND",
    },
    {
      name: "/aide · /status · =",
      type: ActivityType.Listening,
      state: "Commandes slash & préfixées",
    },
    {
      name: "DOG · Protect · GuildGuard",
      type: ActivityType.Competing,
      state: "Protection du serveur PND",
    },
  ];
}

/** Rotates one truthful PND identity activity at a conservative interval. */
export function createPndPresenceController(client, getGuild) {
  let timer = null;
  let profileIndex = 0;

  function refresh() {
    if (!client?.isReady?.() || !client.user) return false;

    const guild = typeof getGuild === "function" ? getGuild() : null;
    const profiles = buildPndPresenceProfiles(guild);
    const activity = profiles[profileIndex % profiles.length];

    client.user.setPresence({
      status: "online",
      activities: [activity],
    });

    profileIndex = (profileIndex + 1) % profiles.length;
    return true;
  }

  return {
    refresh,
    start() {
      if (timer) return;
      refresh();
      timer = setInterval(refresh, PND_PRESENCE_INTERVAL_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

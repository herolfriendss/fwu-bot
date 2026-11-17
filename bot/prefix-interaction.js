// Adaptateur de préfixe vers le même gestionnaire que les commandes slash.
// Il fournit uniquement l'interface d'interaction nécessaire aux modules concernés.
function withoutEphemeral(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const { ephemeral: _ephemeral, flags: _flags, ...rest } = payload;
  return rest;
}

function readValue(values, name, required) {
  const value = values[name] ?? null;
  if (required && value == null) throw new Error(`Argument manquant : ${name}.`);
  return value;
}

export function createPrefixInteraction(message, commandName, subcommand, values = {}) {
  let replied = false;
  let deferred = false;

  const send = async (payload) => {
    replied = true;
    deferred = false;
    return message.reply(withoutEphemeral(payload));
  };

  return {
    id: message.id,
    commandName,
    guild: message.guild,
    guildId: message.guild?.id ?? null,
    channel: message.channel,
    channelId: message.channel?.id ?? null,
    member: message.member,
    memberPermissions: message.member?.permissions ?? null,
    user: message.author,
    isChatInputCommand: () => true,
    isButton: () => false,
    isRepliable: () => true,
    inGuild: () => Boolean(message.guild),
    get replied() { return replied; },
    get deferred() { return deferred; },
    options: {
      getSubcommand: () => subcommand,
      getString: (name, required = false) => readValue(values, name, required),
      getInteger: (name, required = false) => readValue(values, name, required),
      getUser: (name, required = false) => readValue(values, name, required),
      getRole: (name, required = false) => readValue(values, name, required),
      getChannel: (name, required = false) => readValue(values, name, required),
    },
    reply: send,
    followUp: send,
    deferReply: async () => { deferred = true; },
    editReply: send,
  };
}

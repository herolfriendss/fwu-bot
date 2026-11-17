// Her? V4 — pont entre les commandes slash et les gestionnaires préfixés existants.
//
// Objectif : ne jamais dupliquer la logique métier. Chaque commande slash est
// traduite en un contexte de message minimal (content + mentions + reply), puis
// transmise au gestionnaire historique (=balance, =dog, =play, …). Les deux
// interfaces partagent donc exactement les mêmes règles, soldes, permissions et
// fichiers de données. Les anciennes commandes restent disponibles pendant la
// transition, comme demandé pour la V4.
import { Collection, MessageFlags } from "discord.js";
import { handleEconomyMessage } from "./economy.js";
import { handleDogCommand } from "./dog-commands.js";
import { handleVoiceMessage } from "./voice-commands.js";
import { handleMusicMessage, handleRadioMessage } from "./music/music.js";
import { handleSocialMessage } from "./social.js";
import { handleCardsMessage } from "./cards.js";

const emptyMentions = () => ({ users: [], members: [], roles: [], channels: [] });

const collectionOf = (items) => {
  const collection = new Collection();
  for (const item of items) if (item?.id) collection.set(item.id, item);
  return collection;
};

function makeMessage(interaction, member, plan) {
  let replies = 0;
  const reply = (payload) => {
    const data = typeof payload === "string" ? { content: payload } : payload;
    // The slash interaction is always deferred before reaching this adapter.
    if (replies++ === 0) return interaction.editReply(data);
    return interaction.followUp({ ...data, ...(plan.ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
  };

  return {
    id: interaction.id,
    guild: interaction.guild,
    member,
    author: interaction.user,
    channel: interaction.channel,
    content: plan.content,
    mentions: {
      users: collectionOf(plan.mentions.users),
      members: collectionOf(plan.mentions.members),
      roles: collectionOf(plan.mentions.roles),
      channels: collectionOf(plan.mentions.channels),
    },
    reply,
  };
}

const userPlan = (content, user, extra = {}) => ({
  ...extra,
  content,
  mentions: { ...emptyMentions(), users: user ? [user] : [], members: user ? [user] : [] },
});

function buildPlan(interaction) {
  const name = interaction.commandName;
  const options = interaction.options;
  const mentions = emptyMentions();
  const rolePlan = (content, role, extra = {}) => ({ ...extra, content, mentions: { ...emptyMentions(), roles: [role] } });

  switch (name) {
    // ── Économie PND ────────────────────────────────────────────────────────
    case "balance": {
      const user = options.getUser("membre");
      if (!user) return { handler: "economy", content: "=balance", mentions };
      return userPlan(`=balance <@${user.id}>`, user, { handler: "economy" });
    }
    case "daily":
      return { handler: "economy", content: "=daily", mentions };
    case "work":
      return { handler: "economy", content: "=work", mentions };
    case "bank": {
      const subcommand = options.getSubcommand();
      if (subcommand === "solde") return { handler: "economy", content: "=bank solde", mentions };
      const amount = options.getInteger("montant", true);
      return { handler: "economy", content: `=bank ${subcommand} ${amount}`, mentions, ephemeral: true };
    }
    case "history":
      return { handler: "economy", content: "=history", mentions, ephemeral: true };
    case "rob": {
      const user = options.getUser("membre", true);
      return userPlan(`=rob <@${user.id}>`, user, { handler: "economy", ephemeral: true });
    }
    case "lottery": {
      const subcommand = options.getSubcommand();
      if (subcommand === "buy") return { handler: "economy", content: `=lottery buy ${options.getInteger("nombre", true)}`, mentions, ephemeral: true };
      if (subcommand === "draw") return { handler: "economy", content: "=lottery draw", mentions, ephemeral: true };
      return { handler: "economy", content: "=lottery info", mentions, ephemeral: true };
    }
    case "pay": {
      const user = options.getUser("membre", true);
      const amount = options.getInteger("montant", true);
      return userPlan(`=pay <@${user.id}> ${amount}`, user, { handler: "economy" });
    }
    case "leaderboard":
      return { handler: "economy", content: "=leaderboard", mentions };
    case "inventory":
      return { handler: "economy", content: "=inventory", mentions };
    case "shop": {
      const subcommand = options.getSubcommand();
      if (subcommand === "ajouter") {
        const role = options.getRole("role", true);
        const price = options.getInteger("prix", true);
        return rolePlan(`=shop add <@&${role.id}> ${price}`, role, { handler: "economy", ephemeral: true });
      }
      if (subcommand === "retirer") {
        const role = options.getRole("role", true);
        return rolePlan(`=shop remove <@&${role.id}>`, role, { handler: "economy", ephemeral: true });
      }
      return { handler: "economy", content: "=shop", mentions };
    }
    case "buy": {
      const role = options.getRole("role", true);
      return rolePlan(`=buy <@&${role.id}>`, role, { handler: "economy" });
    }
    case "pnd": {
      const subcommand = options.getSubcommand();
      const action = subcommand === "ajouter" ? "add" : subcommand === "retirer" ? "remove" : "set";
      const user = options.getUser("membre", true);
      const amount = options.getInteger("montant", true);
      return userPlan(`=pnd ${action} <@${user.id}> ${amount}`, user, { handler: "economy", ephemeral: true });
    }
    case "roulette": {
      const bet = options.getInteger("mise", true);
      const choice = options.getString("choix", true);
      return { handler: "economy", content: `=roulette ${bet} ${choice}`, mentions };
    }
    case "blackjack": {
      const bet = options.getInteger("mise", true);
      return { handler: "economy", content: `=blackjack ${bet}`, mentions };
    }

    // ── Social ───────────────────────────────────────────────────────────────
    case "profil": {
      const user = options.getUser("membre");
      if (!user) return { handler: "social", content: "=profil", mentions };
      return userPlan(`=profil <@${user.id}>`, user, { handler: "social" });
    }
    case "bio":
      return { handler: "social", content: `=bio ${options.getString("texte", true)}`, mentions, ephemeral: true };
    case "rep": {
      const user = options.getUser("membre", true);
      const reason = options.getString("raison");
      return userPlan(`=rep <@${user.id}>${reason ? ` ${reason}` : ""}`, user, { handler: "social" });
    }
    case "toprep":
      return { handler: "social", content: "=toprep", mentions };
    case "color":
      return { handler: "social", content: `=color ${options.getString("couleur", true)}`, mentions, ephemeral: true };

    // ── Cartes ───────────────────────────────────────────────────────────────
    case "cards": {
      const user = options.getUser("membre");
      if (!user) return { handler: "cards", content: "=cards", mentions };
      return userPlan(`=cards <@${user.id}>`, user, { handler: "cards" });
    }
    case "card":
      return { handler: "cards", content: `=card ${options.getString("carte", true)}`, mentions, ephemeral: true };
    case "pack":
      return { handler: "cards", content: "=pack", mentions };
    case "trade": {
      const subcommand = options.getSubcommand();
      if (subcommand === "proposer") {
        const user = options.getUser("membre", true);
        const offer = options.getString("offre", true);
        const request = options.getString("demande", true);
        return userPlan(`=trade propose <@${user.id}> ${offer} ${request}`, user, { handler: "cards" });
      }
      if (subcommand === "accepter") return { handler: "cards", content: `=trade accept ${options.getString("id", true)}`, mentions, ephemeral: true };
      if (subcommand === "annuler") return { handler: "cards", content: `=trade cancel ${options.getString("id", true)}`, mentions, ephemeral: true };
      return { handler: "cards", content: "=trades", mentions, ephemeral: true };
    }

    // ── DOG ─────────────────────────────────────────────────────────────────
    case "dog": {
      const user = options.getUser("membre", true);
      return userPlan(`=dog <@${user.id}>`, user, { handler: "dog", ephemeral: true });
    }
    case "undog": {
      const user = options.getUser("membre", true);
      return userPlan(`=undog <@${user.id}>`, user, { handler: "dog", ephemeral: true });
    }
    case "doginfo": {
      const user = options.getUser("membre", true);
      return userPlan(`=doginfo <@${user.id}>`, user, { handler: "dog", ephemeral: true });
    }

    // ── Vocal ───────────────────────────────────────────────────────────────
    case "access": {
      const user = options.getUser("membre", true);
      return userPlan(`=access <@${user.id}>`, user, { handler: "voice", ephemeral: true });
    }
    case "unaccess": {
      const user = options.getUser("membre", true);
      return userPlan(`=unaccess <@${user.id}>`, user, { handler: "voice", ephemeral: true });
    }
    case "pv":
      return { handler: "voice", content: "=pv", mentions, ephemeral: true };
    case "panel":
      return { handler: "voice", content: "=panel", mentions, ephemeral: true };

    // ── Musique ─────────────────────────────────────────────────────────────
    case "play":
      return { handler: "music", content: `=play ${options.getString("recherche", true)}`, mentions };
    case "pause":
      return { handler: "music", content: "=pause", mentions };
    case "resume":
      return { handler: "music", content: "=resume", mentions };
    case "skip":
      return { handler: "music", content: "=skip", mentions };
    case "stop":
      return { handler: "music", content: "=stop", mentions };
    case "queue":
      return { handler: "music", content: "=queue", mentions };
    case "nowplaying":
      return { handler: "music", content: "=nowplaying", mentions };
    case "volume":
      return { handler: "music", content: `=volume ${options.getInteger("niveau", true)}`, mentions };
    case "loop": {
      const mode = options.getString("mode");
      return { handler: "music", content: mode ? `=loop ${mode}` : "=loop", mentions };
    }
    case "shuffle":
      return { handler: "music", content: "=shuffle", mentions };
    case "clearqueue":
      return { handler: "music", content: "=clearqueue", mentions };
    case "remove":
      return { handler: "music", content: `=remove ${options.getInteger("position", true)}`, mentions };
    case "join":
      return { handler: "music", content: "=join", mentions };
    case "leave":
      return { handler: "music", content: "=leave", mentions };
    case "musicpanel":
      return { handler: "music", content: "=musicpanel", mentions };

    // ── Radio ───────────────────────────────────────────────────────────────
    case "radio": {
      const subcommand = options.getSubcommand();
      if (subcommand === "set") {
        const channel = options.getChannel("salon", true);
        const playlist = options.getString("playlist", true);
        return {
          handler: "radio",
          content: `=radio set <#${channel.id}> ${playlist}`,
          mentions: { ...emptyMentions(), channels: [channel] },
          ephemeral: true,
        };
      }
      return {
        handler: "radio",
        content: `=radio ${subcommand}`,
        mentions,
        ephemeral: subcommand !== "status",
      };
    }

    default:
      return null;
  }
}

/**
 * Traite une commande slash V4. Renvoie false si la commande n'appartient pas
 * à ce routeur, afin que les gestionnaires généraux (SYS+, aide, boutons…)
 * continuent de fonctionner.
 */
export async function handleV4SlashInteraction(interaction, guildSettings = null) {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return false;
  const plan = buildPlan(interaction);
  if (!plan) return false;

  await interaction.deferReply(plan.ephemeral ? { flags: MessageFlags.Ephemeral } : {});

  const member = await interaction.guild.members
    .fetch({ user: interaction.user.id, force: true })
    .catch(() => null);
  if (!member) {
    await interaction.editReply("❌ Je ne trouve pas ton profil sur ce serveur. Réessaie dans un instant.");
    return true;
  }

  const message = makeMessage(interaction, member, plan);
  try {
    let handled = false;
    if (plan.handler === "economy") handled = await handleEconomyMessage(message);
    else if (plan.handler === "dog") handled = await handleDogCommand(message, guildSettings?.sysPlus?.roleId);
    else if (plan.handler === "voice") handled = await handleVoiceMessage(message, guildSettings?.voiceAccess);
    else if (plan.handler === "music") handled = await handleMusicMessage(message);
    else if (plan.handler === "radio") handled = await handleRadioMessage(message);
    else if (plan.handler === "social") handled = await handleSocialMessage(message);
    else if (plan.handler === "cards") handled = await handleCardsMessage(message);

    if (!handled) await message.reply("Cette commande n’est pas disponible pour le moment.");
  } catch (error) {
    console.error("[bot] v4_slash_error:", error?.message ?? "Unknown error");
    await message.reply("❌ Une erreur est survenue pendant cette commande. Réessaie dans un instant.").catch(() => {});
  }
  return true;
}

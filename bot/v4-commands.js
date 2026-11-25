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
import { handleBusinessInvestmentMessage } from "./business-investments-commands.js";
import { handleCasinoMessage } from "./casino.js";
import { handleOrganizationMessage } from "./organization-commands.js";
import { handleStaffMemberHistoryMessage } from "./staff-audit.js";

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
    channel: interaction.channel ?? { id: interaction.channelId },
    client: interaction.client,
    content: plan.content,
    economyContract: plan.economyContract,
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

export function resolveLegacyCommandName(interaction) {
  if (interaction.commandName !== "music") return interaction.commandName;
  const group = interaction.options?.getSubcommandGroup?.(false);
  if (group !== "player") return interaction.commandName;
  const subcommand = interaction.options.getSubcommand(false);
  return subcommand === "panel" ? "musicpanel" : subcommand;
}

function buildPlan(interaction) {
  const name = resolveLegacyCommandName(interaction);
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
    case "job": {
      if (options.getSubcommandGroup(false) === "contract") {
        const action = options.getSubcommand();
        const payload = { action };
        if (action === "create") {
          payload.title = options.getString("titre", true);
          payload.description = options.getString("description", true);
          payload.reward = options.getInteger("recompense", true);
        } else if (action === "list") {
          payload.status = options.getString("etat") ?? "open";
        } else if (action === "submit") {
          payload.contractId = options.getInteger("id", true);
          payload.submission = options.getString("compte-rendu", true);
        } else {
          payload.contractId = options.getInteger("id", true);
        }
        return { handler: "economy", content: `=job contract ${action}`, mentions, ephemeral: true, economyContract: payload };
      }
      if (options.getSubcommandGroup(false) === "mission") {
        return {
          handler: "economy",
          content: `=mission ${options.getSubcommand()}`,
          mentions,
          ephemeral: true,
        };
      }
      const subcommand = options.getSubcommand();
      if (subcommand === "choose") return { handler: "economy", content: `=job choose ${options.getString("metier", true)}`, mentions, ephemeral: true };
      return { handler: "economy", content: `=job ${subcommand === "status" ? "status" : "list"}`, mentions, ephemeral: true };
    }
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
      if (options.getSubcommandGroup(false) === "market") {
        const action = options.getSubcommand();
        if (action === "sell") {
          const role = options.getRole("role", true);
          const price = options.getInteger("prix", true);
          return rolePlan(`=market sell <@&${role.id}> ${price}`, role, { handler: "economy", ephemeral: true });
        }
        if (action === "buy" || action === "cancel") {
          return { handler: "economy", content: `=market ${action} ${options.getInteger("id", true)}`, mentions, ephemeral: true };
        }
        return { handler: "economy", content: "=market list", mentions, ephemeral: true };
      }
      if (options.getSubcommandGroup(false) === "auction") {
        const action = options.getSubcommand();
        if (action === "create") {
          const role = options.getRole("role", true);
          const start = options.getInteger("prix-initial", true);
          const duration = options.getInteger("duree-minutes", true);
          return rolePlan(`=auction create <@&${role.id}> ${start} ${duration}`, role, { handler: "economy", ephemeral: true });
        }
        if (action === "bid") {
          const id = options.getInteger("id", true);
          const amount = options.getInteger("montant", true);
          return { handler: "economy", content: `=auction bid ${id} ${amount}`, mentions, ephemeral: true };
        }
        if (action === "cancel") return { handler: "economy", content: `=auction cancel ${options.getInteger("id", true)}`, mentions, ephemeral: true };
        return { handler: "economy", content: "=auction list", mentions, ephemeral: true };
      }
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
      if (subcommand === "historique") {
        const user = options.getUser("membre");
        return userPlan(`=pnd-history${user ? ` <@${user.id}>` : ""}`, user, { handler: "economy", ephemeral: true });
      }
      if (subcommand === "audit") return { handler: "economy", content: "=pnd-audit", mentions, ephemeral: true };
      const action = subcommand === "ajouter" ? "add" : subcommand === "retirer" ? "remove" : "set";
      const user = options.getUser("membre", true);
      const amount = options.getInteger("montant", true);
      return userPlan(`=pnd ${action} <@${user.id}> ${amount}`, user, { handler: "economy", ephemeral: true });
    }
    case "pnd-add":
    case "pnd-remove": {
      const user = options.getUser("membre", true);
      const amount = options.getInteger("montant", true);
      const action = name === "pnd-add" ? "add" : "remove";
      return userPlan(`=pnd ${action} <@${user.id}> ${amount}`, user, { handler: "economy", ephemeral: true });
    }
    case "pnd-history": {
      const user = options.getUser("membre");
      return userPlan(`=pnd-history${user ? ` <@${user.id}>` : ""}`, user, { handler: "economy", ephemeral: true });
    }
    case "pnd-audit":
      return { handler: "economy", content: "=pnd-audit", mentions, ephemeral: true };
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
      if (options.getSubcommand(false) === "historique") {
        const target = options.getUser("membre");
        return target
          ? userPlan(`=rep historique <@${target.id}>`, target, { handler: "social", ephemeral: true })
          : { handler: "social", content: "=rep historique", mentions, ephemeral: true };
      }
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
      const user = options.getUser("membre");
      if (!user) return { handler: "dog", content: "=doglist", mentions, ephemeral: true };
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
    case "anti-moove": {
      const subcommand = options.getSubcommand();
      const target = options.getUser("membre");
      const state = subcommand === "config" ? options.getString("etat") : null;
      const content = `=anti-moove ${subcommand}${state ? ` ${state}` : ""}${target ? ` <@${target.id}>` : ""}`;
      return target
        ? userPlan(content, target, { handler: "voice", ephemeral: true })
        : { handler: "voice", content, mentions, ephemeral: true };
    }
    case "menotte": {
      const user = options.getUser("membre", true);
      const duration = options.getInteger("duree_minutes");
      return userPlan(`=menotte <@${user.id}>${duration ? ` ${duration}m` : ""}`, user, { handler: "voice", ephemeral: true });
    }
    case "unmenotte": {
      const user = options.getUser("membre", true);
      return userPlan(`=unmenotte <@${user.id}>`, user, { handler: "voice", ephemeral: true });
    }
    case "menotteinfo": {
      const user = options.getUser("membre", true);
      return userPlan(`=menotteinfo <@${user.id}>`, user, { handler: "voice", ephemeral: true });
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
    case "pv": {
      const subcommand = options.getSubcommand(false) ?? "activer";
      const content = subcommand === "liste" ? "=pv liste" : subcommand === "retirer" ? "=unpv" : "=pv";
      return { handler: "voice", content, mentions, ephemeral: true };
    }
    case "vocal-panel":
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
        const source = options.getString("source", true);
        return {
          handler: "radio",
          content: `=radio set <#${channel.id}> ${source}`,
          mentions: { ...emptyMentions(), channels: [channel] },
          ephemeral: true,
        };
      }
      if (subcommand === "host-add" || subcommand === "host-remove") {
        const host = options.getString("hote", true);
        return { handler: "radio", content: `=radio ${subcommand} ${host}`, mentions, ephemeral: true };
      }
      return {
        handler: "radio",
        content: `=radio ${subcommand}`,
        mentions,
        ephemeral: subcommand !== "status",
      };
    }

    // ── Entreprises et investissements PND ──────────────────────────────────
    case "business": {
      const action = options.getSubcommand();
      if (action === "create") return { handler: "business", content: `=business create ${options.getString("nom", true)}`, mentions, ephemeral: true };
      if (action === "info") return { handler: "business", content: `=business info ${options.getString("id", true)}`, mentions, ephemeral: true };
      if (action === "hire" || action === "fire") {
        const user = options.getUser("membre", true);
        return userPlan(`=business ${action} ${options.getString("id", true)} <@${user.id}>`, user, { handler: "business", ephemeral: true });
      }
      if (action === "salary") {
        const user = options.getUser("membre", true);
        const salary = options.getInteger("montant", true);
        return userPlan(`=business salary ${options.getString("id", true)} <@${user.id}> ${salary}`, user, { handler: "business", ephemeral: true });
      }
      if (action === "deposit" || action === "withdraw") return { handler: "business", content: `=business ${action} ${options.getString("id", true)} ${options.getInteger("montant", true)}`, mentions, ephemeral: true };
      if (action === "payroll") return { handler: "business", content: `=business payroll ${options.getString("id", true)}`, mentions, ephemeral: true };
      return { handler: "business", content: "=business list", mentions, ephemeral: true };
    }
    case "invest": {
      const action = options.getSubcommand();
      if (action === "create") {
        const risk = options.getInteger("risque");
        return { handler: "business", content: `=invest create ${options.getInteger("montant", true)}${risk == null ? "" : ` ${risk}`}`, mentions, ephemeral: true };
      }
      if (action === "close") return { handler: "business", content: `=invest close ${options.getString("id", true)}`, mentions, ephemeral: true };
      if (action === "policy") return { handler: "business", content: `=invest policy ${options.getInteger("defaut", true)} ${options.getInteger("maximum", true)}`, mentions, ephemeral: true };
      if (action === "status") return { handler: "business", content: "=invest status", mentions, ephemeral: true };
      return { handler: "business", content: "=invest list", mentions, ephemeral: true };
    }
    // ── PND Casino (monnaie virtuelle uniquement) ───────────────────────────
    case "casino": {
      const action = options.getSubcommand();
      if (["roulette", "coinflip", "dice"].includes(action)) return { handler: "casino", content: `=casino ${action} ${options.getInteger("mise", true)} ${options.getString("choix", true)}`, mentions, ephemeral: true };
      if (action === "slots") return { handler: "casino", content: `=casino slots ${options.getInteger("mise", true)}`, mentions, ephemeral: true };
      if (action === "stats") return { handler: "casino", content: "=casino stats", mentions, ephemeral: true };
      if (action === "historique") return { handler: "casino", content: "=casino historique", mentions, ephemeral: true };
      if (action === "limites") return { handler: "casino", content: "=casino limites", mentions, ephemeral: true };
      if (action === "limite") return { handler: "casino", content: `=casino limite ${options.getInteger("montant", true)}`, mentions, ephemeral: true };
      if (action === "limite-off") return { handler: "casino", content: "=casino limite off", mentions, ephemeral: true };
      if (action === "pause") return { handler: "casino", content: `=casino pause ${options.getString("duree", true)}`, mentions, ephemeral: true };
      return { handler: "casino", content: "=casino aide", mentions, ephemeral: true };
    }
    // ── Communauté PND ───────────────────────────────────────────────────────
    case "pndevent": {
      const action = options.getSubcommand();
      if (action === "creer") return { handler: "organization", content: `=pndevent create ${options.getString("date", true)} | ${options.getString("titre", true)} | ${options.getString("description") ?? ""}`, mentions, ephemeral: true };
      if (action === "join" || action === "leave") return { handler: "organization", content: `=pndevent ${action} ${options.getInteger("id", true)}`, mentions, ephemeral: true };
      if (action === "cancel") return { handler: "organization", content: `=pndevent cancel ${options.getInteger("id", true)}`, mentions, ephemeral: true };
      return { handler: "organization", content: "=pndevent list", mentions, ephemeral: true };
    }
    case "academy": {
      const action = options.getSubcommand();
      if (action === "creer") return { handler: "organization", content: `=academy create ${options.getString("titre", true)} | ${options.getString("etapes", true)}`, mentions, ephemeral: true };
      if (action === "show") return { handler: "organization", content: `=academy show ${options.getString("id", true)}${options.getInteger("etape") == null ? "" : ` ${options.getInteger("etape")}`}`, mentions, ephemeral: true };
      if (action === "complete") return { handler: "organization", content: `=academy complete ${options.getString("id", true)} ${options.getInteger("etape", true)} | ${options.getString("reponses") ?? ""}`, mentions, ephemeral: true };
      if (action === "progress") return { handler: "organization", content: `=academy progress ${options.getString("id", true)}`, mentions, ephemeral: true };
      if (action === "quiz") return { handler: "organization", content: `=academy quiz ${options.getString("id", true)} ${options.getInteger("etape", true)} | ${options.getString("configuration", true)}`, mentions, ephemeral: true };
      return { handler: "organization", content: "=academy list", mentions, ephemeral: true };
    }
    case "award": {
      const action = options.getSubcommand();
      if (action === "creer") return { handler: "organization", content: `=award create ${options.getString("fin", true)} | ${options.getString("titre", true)} | ${options.getString("choix", true)}`, mentions, ephemeral: true };
      if (action === "vote") return { handler: "organization", content: `=award vote ${options.getString("id", true)} ${options.getInteger("option", true)}`, mentions, ephemeral: true };
      if (action === "close") return { handler: "organization", content: `=award close ${options.getString("id", true)}`, mentions, ephemeral: true };
      return { handler: "organization", content: "=award list", mentions, ephemeral: true };
    }
    case "story": {
      const action = options.getSubcommand();
      if (action === "creer") return { handler: "organization", content: `=story create ${options.getString("titre", true)} | ${options.getString("texte", true)}`, mentions, ephemeral: true };
      if (action === "approve" || action === "publish") return { handler: "organization", content: `=story ${action} ${options.getString("id", true)}`, mentions, ephemeral: true };
      return { handler: "organization", content: "=story list", mentions, ephemeral: true };
    }
    case "radar": {
      const from = options.getString("du");
      const to = options.getString("au");
      return { handler: "organization", content: `=radar${from ? ` ${from}` : ""}${to ? ` ${to}` : ""}`, mentions, ephemeral: true };
    }
    case "wrapped":
      return { handler: "organization", content: "=wrapped", mentions, ephemeral: true };
    case "vocalpresence":
      return { handler: "voice", content: `=vocalpresence ${options.getString("date", true)}`, mentions, ephemeral: true };
    case "staffhistory": {
      const user = options.getUser("membre", true);
      return { handler: "staffaudit", content: `=staffhistory <@${user.id}>`, mentions: { ...mentions, users: [user] }, ephemeral: true };
    }

    case "candidature": {
      const action = options.getSubcommand();
      if (action === "deposer") return { handler: "organization", content: `=candidature ${options.getString("reponses", true)}`, mentions, ephemeral: true };
      if (action === "questions") return { handler: "organization", content: `=candidatures questions ${options.getString("configuration", true)}`, mentions, ephemeral: true };
      if (action === "voir") return { handler: "organization", content: `=candidatures voir ${options.getString("id", true)}`, mentions, ephemeral: true };
      if (action === "review") return { handler: "organization", content: `=candidatures review ${options.getString("id", true)} ${options.getString("decision", true)} ${options.getString("note") ?? ""}`, mentions, ephemeral: true };
      if (action === "assign") return { handler: "organization", content: `=candidatures assign ${options.getString("id", true)} <@${options.getUser("responsable", true).id}>`, mentions, ephemeral: true };
      if (action === "entretien") {
        const channel = options.getChannel("salon");
        return { handler: "organization", content: `=candidatures entretien ${options.getString("id", true)} ${options.getString("date", true)} <@${options.getUser("evaluateur", true).id}>${channel ? ` <#${channel.id}>` : ""}`, mentions, ephemeral: true };
      }
      if (action === "evaluation") return { handler: "organization", content: `=candidatures evaluation ${options.getString("id", true)} ${options.getInteger("note", true)} | ${options.getString("commentaire") ?? ""}`, mentions, ephemeral: true };
      if (action === "annuler-entretien") return { handler: "organization", content: `=candidatures annuler-entretien ${options.getString("id", true)}`, mentions, ephemeral: true };
      if (action === "entretiens") return { handler: "organization", content: "=candidatures entretiens", mentions, ephemeral: true };
      return { handler: "organization", content: "=candidatures", mentions, ephemeral: true };
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
/**
 * Runs an existing message handler from a slash command (same rules, same data).
 * Used by modules whose slash entry point is outside this adapter.
 * `run(message)` must return true when it handled the command.
 */
export async function runPrefixFromSlash(interaction, content, run, { mentions = {}, ephemeral = true } = {}) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!member) {
    await interaction.editReply("❌ Je ne trouve pas ton profil sur ce serveur. Réessaie dans un instant.");
    return true;
  }
  const message = makeMessage(interaction, member, { content, ephemeral, mentions: { ...emptyMentions(), ...mentions } });
  try {
    if (!(await run(message))) await message.reply("Cette commande n’est pas disponible pour le moment.");
  } catch (error) {
    console.error("[bot] slash_bridge_error:", error?.message ?? "Unknown error");
    await interaction.editReply({ content: "❌ Une erreur est survenue pendant cette commande. Réessaie dans un instant." }).catch(() => {});
  }
  return true;
}

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
    if (plan.handler === "economy") handled = await handleEconomyMessage(message, guildSettings);
    else if (plan.handler === "dog") handled = await handleDogCommand(message, guildSettings);
    else if (plan.handler === "voice") handled = await handleVoiceMessage(message, guildSettings);
    else if (plan.handler === "music") handled = await handleMusicMessage(message);
    else if (plan.handler === "radio") handled = await handleRadioMessage(message);
    else if (plan.handler === "social") handled = await handleSocialMessage(message);
    else if (plan.handler === "cards") handled = await handleCardsMessage(message);
    else if (plan.handler === "business") handled = await handleBusinessInvestmentMessage(message);
    else if (plan.handler === "casino") handled = await handleCasinoMessage(message);
    else if (plan.handler === "organization") handled = await handleOrganizationMessage(message, { settings: { [interaction.guild.id]: guildSettings }, ownerIds: (process.env.PND_OWNER_DISCORD_ID ? [process.env.PND_OWNER_DISCORD_ID.trim()] : []) });
    else if (plan.handler === "staffaudit") handled = await handleStaffMemberHistoryMessage(message, { settings: { [interaction.guild.id]: guildSettings }, ownerIds: (process.env.PND_OWNER_DISCORD_ID ? [process.env.PND_OWNER_DISCORD_ID.trim()] : []) });

    if (!handled) await message.reply("Cette commande n’est pas disponible pour le moment.");
  } catch (error) {
    console.error("[bot] v4_slash_error:", error?.message ?? "Unknown error");
    // Late error: edit the existing reply instead of posting a second message under it.
    await interaction.editReply({ content: "❌ Une erreur est survenue pendant cette commande. Réessaie dans un instant." }).catch(() => {});
  }
  return true;
}

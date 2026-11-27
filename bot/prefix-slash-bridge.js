// FWU V2 — pont générique préfixe → slash.
//
// « +antinuke voir », « ;mvall #a #b », « -impots payer 100 »… : toute commande slash d'un bot
// fonctionne avec le préfixe de ce bot, sans réécrire chaque module. Le message est converti
// en interaction slash simulée (sous-commande, groupe et options lus dans le catalogue) puis
// remis au même chemin que les vraies commandes slash (gel du staff, hiérarchie, couche de
// réponses, handlers). Les réponses privées partent en message privé ; un formulaire
// (fenêtre de saisie) n'existe pas en préfixe : la commande slash est alors indiquée.
import { randomUUID } from "node:crypto";

const FREE_TEXT = new Set(["raison", "message", "texte", "description", "consignes", "contenu", "question", "titre"]);
const OPTION = Object.freeze({ SUB: 1, GROUP: 2, STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10, ATTACHMENT: 11 });

/** Découpe en mots en respectant les "guillemets". */
export function tokenize(text) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = re.exec(String(text ?? ""))) !== null) out.push(match[1] ?? match[2]);
  return out;
}

const id = (token, kind) => {
  const patterns = { user: /^<@!?(\d{17,20})>$/, role: /^<@&(\d{17,20})>$/, channel: /^<#(\d{17,20})>$/ };
  const m = patterns[kind].exec(token);
  if (m) return m[1];
  return /^\d{17,20}$/.test(token) ? token : null;
};

function parseValue(option, token, rest) {
  if (token === undefined) return { ok: false };
  switch (option.type) {
    case OPTION.STRING: {
      const value = option.__last ? rest : token;
      if (option.choices?.length) {
        const choice = option.choices.find((c) => String(c.value).toLowerCase() === token.toLowerCase() || String(c.name).toLowerCase() === token.toLowerCase());
        return choice ? { ok: true, value: String(choice.value), consumed: 1 } : { ok: false };
      }
      return { ok: true, value, consumed: option.__last ? Number.POSITIVE_INFINITY : 1 };
    }
    case OPTION.INTEGER:
    case OPTION.NUMBER: {
      const n = Number(token.replace(",", "."));
      if (!Number.isFinite(n) || (option.type === OPTION.INTEGER && !Number.isInteger(n))) return { ok: false };
      if (option.choices?.length && !option.choices.some((c) => Number(c.value) === n)) return { ok: false };
      return { ok: true, value: n, consumed: 1 };
    }
    case OPTION.BOOLEAN: {
      if (/^(oui|o|yes|true|vrai|on|1)$/i.test(token)) return { ok: true, value: true, consumed: 1 };
      if (/^(non|n|no|false|faux|off|0)$/i.test(token)) return { ok: true, value: false, consumed: 1 };
      return { ok: false };
    }
    case OPTION.USER: { const v = id(token, "user"); return v ? { ok: true, value: v, consumed: 1 } : { ok: false }; }
    case OPTION.ROLE: { const v = id(token, "role"); return v ? { ok: true, value: v, consumed: 1 } : { ok: false }; }
    case OPTION.CHANNEL: { const v = id(token, "channel"); return v ? { ok: true, value: v, consumed: 1 } : { ok: false }; }
    case OPTION.MENTIONABLE: { const v = id(token, "user") ?? id(token, "role"); return v ? { ok: true, value: v, consumed: 1 } : { ok: false }; }
    default: return { ok: false };
  }
}

function usage(prefix, path, options) {
  const args = options.map((o) => (o.required ? `<${o.name}>` : o.type === OPTION.STRING && !o.choices?.length ? `[${o.name}:…]` : `[${o.name}]`)).join(" ");
  return `⚠️ Utilisation : \`${prefix}${path}${args ? ` ${args}` : ""}\``;
}

/**
 * Lit « sous-commande arguments » selon la définition slash. Pur.
 * Retourne { path, subcommand, group, values: Map(name → valeur brute) } ou { error }.
 */
export function parseBridgedCommand(definition, argsText, { prefix = "=" } = {}) {
  let tokens = tokenize(argsText);
  let options = definition.options ?? [];
  let group = null;
  let subcommand = null;
  const pathParts = [definition.name];
  const groups = options.filter((o) => o.type === OPTION.GROUP);
  const subs = options.filter((o) => o.type === OPTION.SUB);
  if (groups.length || subs.length) {
    const first = (tokens[0] ?? "").toLowerCase();
    const g = groups.find((o) => o.name === first);
    if (g) {
      group = g.name; pathParts.push(g.name); tokens = tokens.slice(1);
      const second = (tokens[0] ?? "").toLowerCase();
      const s = (g.options ?? []).find((o) => o.name === second);
      if (!s) return { error: `⚠️ Sous-commandes : ${(g.options ?? []).map((o) => `\`${prefix}${definition.name} ${g.name} ${o.name}\``).join(", ")}` };
      subcommand = s.name; pathParts.push(s.name); tokens = tokens.slice(1); options = s.options ?? [];
    } else {
      const s = subs.find((o) => o.name === first);
      if (!s) return { error: `⚠️ Sous-commandes : ${[...subs, ...groups].map((o) => `\`${prefix}${definition.name} ${o.name}\``).join(", ").slice(0, 1800)}` };
      subcommand = s.name; pathParts.push(s.name); tokens = tokens.slice(1); options = s.options ?? [];
    }
  }
  const path = pathParts.join(" ");
  const values = new Map();
  // « nom:valeur » (comme en slash) fixe une option directement, à n'importe quelle place.
  const named = new Set();
  tokens = tokens.filter((token) => {
    const m = /^([a-z_]+):(.+)$/i.exec(token);
    const option = m && options.find((o) => o.name === m[1].toLowerCase());
    if (!option) return true;
    const parsed = parseValue({ ...option, __last: false }, m[2], m[2]);
    if (!parsed.ok) return true;
    values.set(option.name, parsed.value);
    named.add(option.name);
    return false;
  });
  // Texte libre : raison, message, texte… (sinon la dernière option texte) prend la fin de la ligne.
  const strings = options.filter((o) => o.type === OPTION.STRING && !o.choices?.length && !named.has(o.name));
  const freeText = strings.find((o) => FREE_TEXT.has(o.name)) ?? strings.at(-1) ?? null;
  let index = 0;
  for (const option of options) {
    if (option.type === OPTION.ATTACHMENT || named.has(option.name) || option === freeText) continue;
    // Une option texte facultative (autre que le texte libre) ne se remplit que par « nom:valeur ».
    if (option.type === OPTION.STRING && !option.choices?.length && !option.required) continue;
    const parsed = parseValue({ ...option, __last: false }, tokens[index], tokens.slice(index).join(" "));
    if (parsed.ok) {
      values.set(option.name, parsed.value);
      index += 1;
    } else if (option.required) {
      return { error: usage(prefix, path, options) };
    }
  }
  if (freeText) {
    const rest = tokens.slice(index).join(" ").trim();
    if (rest) values.set(freeText.name, rest);
    else if (freeText.required) return { error: usage(prefix, path, options) };
  }
  return { path, subcommand, group, values };
}

/** Construit l'interaction simulée à partir du message et de la lecture du catalogue. */
export function buildBridgedInteraction(message, definition, parsed, { client = message.client } = {}) {
  const guild = message.guild;
  const state = { reply: null };
  const v = parsed.values;
  const user = (name) => {
    const raw = v.get(name);
    if (!raw) return null;
    return message.mentions?.users?.get?.(raw) ?? client?.users?.cache?.get?.(raw) ?? { id: raw, bot: false, toString: () => `<@${raw}>` };
  };
  const required = (name, value) => {
    if (value === null || value === undefined) throw Object.assign(new Error(`Option manquante : ${name}`), { code: "BRIDGE_MISSING" });
    return value;
  };
  const get = (fn) => (name, isRequired = false) => { const value = fn(name); return isRequired ? required(name, value) : value ?? null; };
  const send = async (payload) => {
    const data = typeof payload === "string" ? { content: payload } : { ...(payload ?? {}) };
    const priv = data.ephemeral === true || (Number(data.flags ?? 0) & 64) === 64;
    delete data.ephemeral; delete data.flags; delete data.fetchReply; delete data.withResponse;
    if (priv) {
      const sent = await message.author.send(data).then(() => true).catch(() => false);
      state.reply = await message.reply({ content: sent ? "📬 Réponse envoyée en message privé." : "❌ Messages privés fermés : utilise la commande slash.", allowedMentions: { parse: [] } }).catch(() => null);
      return state.reply;
    }
    state.reply = state.reply?.edit ? await state.reply.edit(data).catch(() => null) ?? state.reply : await message.reply(data).catch(() => null);
    return state.reply;
  };
  const interaction = {
    __prefixBridge: true,
    id: randomUUID(),
    type: 2,
    commandType: 1,
    commandName: definition.name,
    user: message.author,
    member: message.member,
    guild,
    guildId: guild?.id ?? null,
    channel: message.channel,
    channelId: message.channelId ?? message.channel?.id,
    client,
    locale: "fr",
    createdTimestamp: Date.now(),
    deferred: false,
    replied: false,
    ephemeral: false,
    options: {
      data: [],
      getSubcommand: (isRequired = true) => (parsed.subcommand ?? (isRequired ? required("sous-commande", null) : null)),
      getSubcommandGroup: () => parsed.group ?? null,
      getString: get((name) => (v.has(name) ? String(v.get(name)) : null)),
      getInteger: get((name) => (v.has(name) ? Number(v.get(name)) : null)),
      getNumber: get((name) => (v.has(name) ? Number(v.get(name)) : null)),
      getBoolean: get((name) => (v.has(name) ? Boolean(v.get(name)) : null)),
      getUser: get(user),
      getMember: get((name) => { const raw = v.get(name); return raw ? guild?.members?.cache?.get?.(raw) ?? null : null; }),
      getRole: get((name) => { const raw = v.get(name); return raw ? guild?.roles?.cache?.get?.(raw) ?? null : null; }),
      getChannel: get((name) => { const raw = v.get(name); return raw ? guild?.channels?.cache?.get?.(raw) ?? null : null; }),
      getMentionable: get((name) => { const raw = v.get(name); return raw ? guild?.roles?.cache?.get?.(raw) ?? user(name) : null; }),
      getAttachment: get(() => message.attachments?.first?.() ?? null),
      getFocused: () => "",
    },
    inGuild: () => Boolean(guild),
    inCachedGuild: () => Boolean(guild),
    isRepliable: () => true,
    isCommand: () => true,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isAnySelectMenu: () => false,
    isUserSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isContextMenuCommand: () => false,
    async reply(payload) { interaction.replied = true; return send(payload); },
    async deferReply() { interaction.deferred = true; return null; },
    async editReply(payload) { interaction.replied = true; return send(payload); },
    async followUp(payload) { return send(payload); },
    async fetchReply() { return state.reply; },
    async deleteReply() { await state.reply?.delete?.().catch(() => {}); state.reply = null; },
    async showModal() {
      interaction.replied = true;
      return message.reply({ content: `📝 Cette étape demande un formulaire : utilise \`/${parsed.path}\`.`, allowedMentions: { parse: [] } }).catch(() => null);
    },
  };
  return interaction;
}

/**
 * Commande à préfixe sans traitement dédié : si c'est une commande slash du bot, elle est
 * relayée. `dispatch(interaction)` = le chemin interactionCreate. Retourne true si traitée.
 */
export const PREFIX_ALIASES = Object.freeze(Object.fromEntries(
  ["perroquet", "fantome", "mime", "clown", "robot", "bebe", "yoda", "chuchote", "sablier", "malediction",
    "sourdine-folle", "exil", "bouffon", "roulette-vocale", "patate", "tribunal", "interrogatoire", "taxe", "rancon", "cible"]
    .map((sub) => [sub, { root: "malus", sub }]),
));

export async function runPrefixAsSlash(message, { catalogue, ownsCommand, dispatch, prefix = "=" }) {
  const match = String(message?.content ?? "").trim().match(/^=([a-z0-9-]+)\b\s*([\s\S]*)$/i);
  if (!match) return false;
  let name = match[1].toLowerCase();
  let args = match[2];
  // Raccourcis : "+perroquet @x 10" = "/malus perroquet membre:@x minutes:10".
  if (PREFIX_ALIASES[name]) { args = `${PREFIX_ALIASES[name].sub} ${args}`.trim(); name = PREFIX_ALIASES[name].root; }
  if (!ownsCommand(name)) return false;
  const definition = catalogue.find((command) => command.name === name);
  if (!definition) return false;
  const parsed = parseBridgedCommand(definition, args, { prefix });
  if (parsed.error) {
    await message.reply({ content: parsed.error, allowedMentions: { parse: [] } }).catch(() => {});
    return true;
  }
  await dispatch(buildBridgedInteraction(message, definition, parsed));
  return true;
}

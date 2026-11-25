import { classifySignal, looksLikeBotError, pseudonymize, redact } from "./privacy.js";

/**
 * Collecte en mémoire, sans IA. Rien n'est lu en dehors des salons autorisés.
 * `flush()` rend ce qui doit être écrit en base, puis remet les compteurs à zéro.
 */

const PREFIXES = { "+": "GUARD", ";": "FDPDLAVOC", "=": "SUCK ME", "-": "LE FISC" };
export const MAX_EXCERPTS_PER_DAY = 200;

export function parisDay(date = new Date()) {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(date);
}

/** Repère une commande à préfixe (`+ban`, `;pv`…) et le bot concerné. */
export function detectPrefixCommand(text) {
  const m = /^([+;=-])([a-zA-Zàâçéèêëîïôûùüÿñ0-9_-]{2,32})(?:\s|$)/.exec(String(text ?? "").trim());
  if (!m) return null;
  return { bot: PREFIXES[m[1]], command: m[2].toLowerCase() };
}

export class Collector {
  constructor({ readChannelIds, watchedBotIds, pseudonymSecret, now = () => new Date() }) {
    this.readChannelIds = readChannelIds;
    this.watchedBotIds = watchedBotIds;
    this.secret = pseudonymSecret;
    this.now = now;
    this.reset();
    this.day = parisDay(this.now());
    this.authorsByChannel = new Map(); // cumul sur la journée (pour compter les membres distincts)
    this.excerptsToday = 0;
  }

  reset() {
    this.messages = new Map(); // `${day}|${channel}` -> nombre
    this.commands = new Map(); // `${day}|${bot}|${command}` -> { uses, errors }
    this.flow = new Map(); // day -> { joins, leaves }
    this.excerpts = [];
  }

  rollDay() {
    const today = parisDay(this.now());
    if (today !== this.day) {
      this.day = today;
      this.authorsByChannel = new Map();
      this.excerptsToday = 0;
    }
    return today;
  }

  /** `msg` : { guildMatches, channelId, authorId, authorIsBot, content, slashCommand } */
  onMessage(msg) {
    if (!msg.guildMatches || !this.readChannelIds.has(msg.channelId)) return;
    const day = this.rollDay();

    if (msg.authorIsBot) {
      if (!this.watchedBotIds.has(msg.authorId)) return;
      if (msg.slashCommand) this.bumpCommand(day, "FWU", msg.slashCommand, "uses");
      if (looksLikeBotError(msg.content)) {
        if (msg.slashCommand) this.bumpCommand(day, "FWU", msg.slashCommand, "errors");
        this.addExcerpt({ day, channelId: msg.channelId, kind: "erreur_bot", authorHash: null, content: msg.content });
      }
      return;
    }

    const key = `${day}|${msg.channelId}`;
    this.messages.set(key, (this.messages.get(key) ?? 0) + 1);
    const hash = pseudonymize(msg.authorId, this.secret);
    if (!this.authorsByChannel.has(msg.channelId)) this.authorsByChannel.set(msg.channelId, new Set());
    this.authorsByChannel.get(msg.channelId).add(hash);

    const cmd = detectPrefixCommand(msg.content);
    if (cmd) {
      this.bumpCommand(day, cmd.bot, cmd.command, "uses");
      return; // une commande n'est pas un extrait
    }
    const kind = classifySignal(msg.content);
    if (kind) this.addExcerpt({ day, channelId: msg.channelId, kind, authorHash: hash, content: msg.content });
  }

  onMemberFlow(guildMatches, type) {
    if (!guildMatches) return;
    const day = this.rollDay();
    const f = this.flow.get(day) ?? { joins: 0, leaves: 0 };
    f[type === "join" ? "joins" : "leaves"] += 1;
    this.flow.set(day, f);
  }

  bumpCommand(day, bot, command, field) {
    const key = `${day}|${bot}|${command}`;
    const c = this.commands.get(key) ?? { uses: 0, errors: 0 };
    c[field] += 1;
    this.commands.set(key, c);
  }

  addExcerpt({ day, channelId, kind, authorHash, content }) {
    if (this.excerptsToday >= MAX_EXCERPTS_PER_DAY) return;
    const clean = redact(content);
    if (!clean) return;
    this.excerptsToday += 1;
    this.excerpts.push({ day, channelId, kind, authorHash, content: clean });
  }

  flush() {
    const day = this.day;
    const out = {
      messages: [...this.messages].map(([k, count]) => {
        const [d, channelId] = k.split("|");
        return { day: d, channelId, count, authors: d === day ? (this.authorsByChannel.get(channelId)?.size ?? 0) : 0 };
      }),
      commands: [...this.commands].map(([k, v]) => {
        const [d, bot, command] = k.split("|");
        return { day: d, bot, command, ...v };
      }),
      flow: [...this.flow].map(([d, v]) => ({ day: d, ...v })),
      excerpts: this.excerpts,
    };
    this.reset();
    return out;
  }
}

// Smoke test of the whole slash catalogue: every command and subcommand goes
// through the same handler chain as index.js with simulated Discord objects.
// It reports programming errors only (TypeError / ReferenceError / "is not a
// function"...), not normal user-facing refusals. Run:
//   npm --prefix bot run smoke
// Uses a disposable SQLite database; never touches bot/data.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pnd-smoke-"));
process.env.HER_DB_PATH = join(dir, "smoke.sqlite");
process.env.PND_OWNER_DISCORD_ID = "900000000000000001";
process.env.PND_RANKALL_STEP_DELAY_MS = "0";
process.env.PND_WAKEUP_STEP_DELAY_MS = "0";

const GUILD_ID = "900000000000000100";
const OWNER = process.env.PND_OWNER_DISCORD_ID;
const OTHER = "900000000000000002";
const ROLE = "900000000000000200";
const CHANNEL = "900000000000000300";
const PROGRAMMING_ERROR =
  /is not a function|is not defined|Cannot read propert|Cannot destructure|is not iterable|undefined is not|null is not|Unexpected token|Invalid array length|Maximum call stack/;

// Deep stub: any property access or call returns another stub. Awaiting a stub
// resolves to undefined, iterating it yields nothing, it coerces to 0/"".
function stub(label = "stub") {
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === "then") return undefined;
      if (prop === Symbol.iterator) return function* () {};
      if (prop === Symbol.asyncIterator) return async function* () {};
      if (prop === Symbol.toPrimitive)
        return (hint) => (hint === "number" ? 0 : "");
      if (prop === "toString" || prop === "toJSON") return () => "";
      if (
        prop === "size" ||
        prop === "length" ||
        prop === "position" ||
        prop === "memberCount"
      )
        return 0;
      if (prop === "has" || prop === "some" || prop === "every")
        return () => false;
      if (prop === "filter" || prop === "map") return () => [];
      if (prop === "first" || prop === "get" || prop === "find")
        return () => undefined;
      return stub(`${label}.${String(prop)}`);
    },
    apply() {
      return stub(`${label}()`);
    },
  });
}

function withFallback(target, label) {
  return new Proxy(target, {
    get(t, prop) {
      return prop in t
        ? t[prop]
        : prop === "then"
          ? undefined
          : stub(`${label}.${String(prop)}`);
    },
  });
}

const collection = (entries = []) => {
  const map = new Map(entries);
  map.first = () => map.values().next().value;
  map.filter = (fn) => collection([...map].filter(([, v]) => fn(v)));
  map.map = (fn) => [...map.values()].map(fn);
  map.find = (fn) => [...map.values()].find(fn);
  map.some = (fn) => [...map.values()].some(fn);
  return map;
};

function makeRole(id = ROLE, position = 5) {
  return withFallback(
    {
      id,
      name: "Rôle test",
      position,
      managed: false,
      color: 0,
      hexColor: "#000000",
      permissions: withFallback(
        { bitfield: 0n, has: () => false, toArray: () => [] },
        "perm",
      ),
      members: collection(),
      comparePositionTo: (other) => position - (other?.position ?? 0),
      editable: true,
    },
    "role",
  );
}

let guild;
function makeMember(id, { admin = false, position = 10 } = {}) {
  const roles = collection([[ROLE, makeRole()]]);
  return withFallback(
    {
      id,
      user: withFallback(
        {
          id,
          bot: false,
          username: `user${id.slice(-3)}`,
          tag: `user${id.slice(-3)}#0`,
          createdTimestamp: Date.now() - 400 * 86_400_000,
          displayAvatarURL: () => "https://example.invalid/a.png",
        },
        "user",
      ),
      displayName: `Membre ${id.slice(-3)}`,
      nickname: null,
      joinedTimestamp: Date.now() - 100 * 86_400_000,
      joinedAt: new Date(Date.now() - 100 * 86_400_000),
      guild,
      permissions: withFallback(
        { has: () => admin, bitfield: admin ? 8n : 0n, toArray: () => [] },
        "perms",
      ),
      roles: withFallback(
        {
          cache: roles,
          highest: makeRole(ROLE, position),
          add: async () => {},
          remove: async () => {},
        },
        "memberRoles",
      ),
      voice: withFallback(
        { channelId: null, channel: null, setChannel: async () => {} },
        "voice",
      ),
      setNickname: async () => {},
      send: async () => ({}),
      timeout: async () => {},
      kick: async () => {},
      ban: async () => {},
      communicationDisabledUntilTimestamp: null,
      manageable: true,
      moderatable: true,
      kickable: true,
      bannable: true,
    },
    "member",
  );
}

function makeChannel() {
  return withFallback(
    {
      id: CHANNEL,
      name: "general",
      type: 0,
      guildId: GUILD_ID,
      parentId: null,
      isTextBased: () => true,
      isVoiceBased: () => false,
      send: async () =>
        withFallback(
          { id: "msg", edit: async () => ({}), react: async () => {} },
          "sent",
        ),
      messages: withFallback({ fetch: async () => collection() }, "messages"),
      permissionsFor: () =>
        withFallback({ has: () => true, bitfield: 0n }, "chPerms"),
      permissionOverwrites: withFallback(
        { cache: collection(), edit: async () => {}, delete: async () => {} },
        "ow",
      ),
      createWebhook: async () =>
        withFallback(
          { id: "wh", token: "t", url: "https://discord.invalid/wh" },
          "wh",
        ),
      fetchWebhooks: async () => collection(),
    },
    "channel",
  );
}

function makeGuild() {
  const channel = makeChannel();
  guild = withFallback(
    { id: GUILD_ID, name: "Serveur test", ownerId: OWNER, memberCount: 2 },
    "guild",
  );
  const members = collection();
  const ownerMember = makeMember(OWNER, { admin: true, position: 50 });
  const other = makeMember(OTHER, { position: 1 });
  members.set(OWNER, ownerMember);
  members.set(OTHER, other);
  const me = makeMember("900000000000000999", { admin: true, position: 99 });
  Object.assign(guild, {}); // keep fallback proxy
  const raw = {
    id: GUILD_ID,
    name: "Serveur test",
    ownerId: OWNER,
    memberCount: 2,
    members: withFallback(
      {
        cache: members,
        me,
        fetch: async (arg) =>
          arg && typeof arg === "object" && arg.user
            ? (members.get(arg.user) ?? null)
            : typeof arg === "string"
              ? (members.get(arg) ?? null)
              : members,
        fetchMe: async () => me,
      },
      "members",
    ),
    roles: withFallback(
      {
        cache: collection([
          [ROLE, makeRole()],
          [GUILD_ID, makeRole(GUILD_ID, 0)],
        ]),
        everyone: makeRole(GUILD_ID, 0),
        fetch: async (id) =>
          id ? makeRole(id) : collection([[ROLE, makeRole()]]),
        create: async () => makeRole("900000000000000201"),
      },
      "roles",
    ),
    channels: withFallback(
      {
        cache: collection([[CHANNEL, channel]]),
        fetch: async (id) => (id ? channel : collection([[CHANNEL, channel]])),
        create: async () => makeChannel(),
      },
      "channels",
    ),
    fetchAuditLogs: async () => ({ entries: collection() }),
    invites: withFallback({ fetch: async () => collection() }, "invites"),
    iconURL: () => null,
  };
  guild = withFallback(raw, "guild");
  for (const m of members.values()) m.guild = guild;
  me.guild = guild;
  return { guild, channel, ownerMember, other };
}

function optionValue(option) {
  if (option.choices?.length) return option.choices[0].value;
  switch (option.type) {
    case 3:
      return option.name === "duree"
        ? "10m"
        : option.name.includes("couleur")
          ? "#7c3aed"
          : option.name === "id"
            ? "abcd1234"
            : "test";
    case 4:
    case 10:
      return Math.max(option.min_value ?? 1, 10);
    case 5:
      return false;
    default:
      return null;
  }
}

function makeInteraction(command, leaf, group, ctx, userId) {
  const options = new Map(
    (leaf?.options ?? command.options?.filter((o) => o.type > 2) ?? []).map(
      (o) => [o.name, o],
    ),
  );
  const replies = [];
  const value = (name) =>
    options.has(name) ? optionValue(options.get(name)) : null;
  const interaction = {
    id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    commandName: command.name,
    guild: ctx.guild,
    guildId: GUILD_ID,
    channel: ctx.channel,
    channelId: CHANNEL,
    member: userId === OWNER ? ctx.ownerMember : ctx.other,
    user: (userId === OWNER ? ctx.ownerMember : ctx.other).user,
    client: withFallback(
      {
        user: withFallback({ id: "900000000000000999" }, "clientUser"),
        guilds: withFallback(
          {
            cache: collection([[GUILD_ID, ctx.guild]]),
            fetch: async () => ctx.guild,
          },
          "cg",
        ),
        channels: withFallback({ fetch: async () => ctx.channel }, "cc"),
        ws: { ping: 20 },
        isReady: () => true,
      },
      "client",
    ),
    deferred: false,
    replied: false,
    locale: "fr",
    createdTimestamp: Date.now(),
    inGuild: () => true,
    inCachedGuild: () => true,
    isRepliable: () => true,
    isChatInputCommand: () => true,
    isCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isAnySelectMenu: () => false,
    isModalSubmit: () => false,
    isMessageComponent: () => false,
    isAutocomplete: () => false,
    isContextMenuCommand: () => false,
    options: {
      getSubcommand: () => leaf?.name ?? null,
      getSubcommandGroup: () => group ?? null,
      getString: (n) => (value(n) == null ? null : String(value(n))),
      getInteger: (n) => value(n),
      getNumber: (n) => value(n),
      getBoolean: (n) => value(n),
      getUser: (n) => (options.has(n) ? ctx.other.user : null),
      getMember: (n) => (options.has(n) ? ctx.other : null),
      getRole: (n) => (options.has(n) ? makeRole() : null),
      getChannel: (n) => (options.has(n) ? ctx.channel : null),
      getMentionable: () => null,
      getAttachment: () => null,
      get: (n) => (options.has(n) ? { name: n, value: value(n) } : null),
      data: [],
    },
    reply: async (p) => {
      interaction.replied = true;
      replies.push(p);
      return withFallback({ id: "reply", edit: async () => ({}) }, "replyMsg");
    },
    deferReply: async () => {
      interaction.deferred = true;
    },
    deferUpdate: async () => {
      interaction.deferred = true;
    },
    editReply: async (p) => {
      replies.push(p);
      return withFallback({ id: "reply" }, "edited");
    },
    followUp: async (p) => {
      replies.push(p);
      return withFallback({ id: "f" }, "follow");
    },
    fetchReply: async () => withFallback({ id: "reply" }, "fetched"),
    showModal: async () => {},
    update: async (p) => {
      replies.push(p);
    },
    replies,
  };
  return interaction;
}

function leaves(command) {
  const out = [];
  const opts = command.options ?? [];
  const subs = opts.filter((o) => o.type === 1 || o.type === 2);
  if (!subs.length) return [{ leaf: null, group: null }];
  for (const o of subs) {
    if (o.type === 1) out.push({ leaf: o, group: null });
    else for (const s of o.options ?? []) out.push({ leaf: s, group: o.name });
  }
  return out;
}

const { SLASH_COMMANDS, EXTRA_SLASH_COMMANDS = [] } = await import("../../src/lib/slash-commands.ts");
const load = async (path, name) => (await import(path))[name];
const chain = [
  ["resume", await load("../resume.js", "handleResumeInteraction"), (i, s) => [i, s[GUILD_ID]]],
  ["dmall", await load("../dmall.js", "handleDmAllInteraction"), (i, s) => [i, s[GUILD_ID]]],
  ["undogall", await load("../dog-commands.js", "handleUndogAllInteraction"), (i, s) => [i, s[GUILD_ID]]],
  ["guard", await load("../guard/commands.js", "handleGuardInteraction"), (i, s) => [i, s[GUILD_ID]]],
  ["community", await load("../features/community.js", "handleCommunityInteraction"), (i, s) => [i, s[GUILD_ID]]],
  ["fisc", await load("../features/fisc.js", "handleFiscInteraction"), (i) => [i]],
  ["suckme", await load("../features/suckme.js", "handleSuckmeInteraction"), (i, s) => [i, s[GUILD_ID]]],
  ["music-extras", await load("../music/music.js", "handleMusicExtrasInteraction"), (i) => [i]],
  ["blacklist", await load("../blacklist.js", "handleBlacklistInteraction"), (i, s) => [i, s[GUILD_ID]]],
  ["live", await load("../live-commands.js", "handleLiveInteraction"), (i, s) => [i, s, { apiUrl: "http://127.0.0.1:9", secret: "x".repeat(32) }]],
  [
    "pnd-intelligence",
    await load("../pnd-intelligence.js", "handlePndIntelligenceInteraction"),
    (i, s) => [i, { settings: s, ownerIds: [OWNER] }],
  ],
  [
    "pack",
    await load("../systems/entitlements/commands.js", "handlePackInteraction"),
    (i) => [i, { configuredOwners: OWNER }],
  ],
  [
    "market",
    await load("../systems/marketplace/commands.js", "handleMarketInteraction"),
    (i) => [i, { roleId: null, configuredOwners: OWNER }],
  ],
  [
    "whitelist",
    await load(
      "../systems/sysplus/whitelist-commands.js",
      "handleWhitelistInteraction",
    ),
    (i, s) => [i, s, { audit: () => {} }],
  ],
  [
    "lockname",
    await load("../systems/lockname/commands.js", "handleLocknameInteraction"),
    (i, s) => [i, s[GUILD_ID]],
  ],
  [
    "waouf",
    await load("../systems/waouf/commands.js", "handleWaoufInteraction"),
    (i, s) => [i, s[GUILD_ID], () => {}],
  ],
  [
    "sysplus",
    await load("../systems/sysplus/commands.js", "handleSysPlusInteraction"),
    (i, s) => [
      i,
      s,
      {
        apiUrl: "http://127.0.0.1:9",
        secret: "x".repeat(32),
        record: () => {},
        audit: () => {},
      },
    ],
  ],
  [
    "custom-roles",
    await load(
      "../systems/sysplus/custom-roles.js",
      "handleCustomRolesInteraction",
    ),
    (i, s) => [i, s[GUILD_ID]],
  ],
  [
    "roles",
    await load("../role-commands.js", "handleRoleInteraction"),
    (i, s) => [i, s[GUILD_ID]],
  ],
  [
    "panel-setup",
    await load(
      "../systems/setup/panel-setup.js",
      "handlePanelSetupInteraction",
    ),
    (i, s) => [
      i,
      s,
      {
        apiUrl: "http://127.0.0.1:9",
        secret: "x".repeat(32),
        record: () => {},
      },
    ],
  ],
  [
    "guildguard",
    await load("../guild-guard-commands.js", "handleGuildGuardInteraction"),
    (i, s) => [
      i,
      s[GUILD_ID],
      {
        apiUrl: "http://127.0.0.1:9",
        secret: "x".repeat(32),
        record: () => {},
      },
    ],
  ],
  [
    "moderation",
    await load("../moderation.js", "handleModerationInteraction"),
    (i, s) => [i, s[GUILD_ID]],
  ],
  [
    "voice-v2",
    await load("../voice-v2.js", "handleVoiceV2Interaction"),
    (i, s) => [i, s[GUILD_ID]],
  ],
  [
    "games",
    await load("../games.js", "handleGamesInteraction"),
    (i, s) => [i, s[GUILD_ID], () => {}],
  ],
  [
    "knowledge",
    await load("../pnd-knowledge.js", "handleKnowledgeInteraction"),
    (i) => [i],
  ],
  [
    "tickets",
    await load("../tickets.js", "handleTicketsInteraction"),
    (i, s) => [
      i,
      s[GUILD_ID],
      {
        apiUrl: "http://127.0.0.1:9",
        secret: "x".repeat(32),
        record: () => {},
      },
    ],
  ],
  [
    "webhooks",
    await load("../webhooks.js", "handleWebhookInteraction"),
    (i, s) => [i, s[GUILD_ID], () => {}],
  ],
  [
    "automation",
    await load("../automation.js", "handleAutomationInteraction"),
    (i, s) => [
      i,
      s[GUILD_ID],
      {
        apiUrl: "http://127.0.0.1:9",
        secret: "x".repeat(32),
        record: () => {},
      },
    ],
  ],
  [
    "v4-router",
    await load("../v4-commands.js", "handleV4SlashInteraction"),
    (i, s) => [i, s[GUILD_ID]],
  ],
  [
    "economy",
    await load("../economy.js", "handleEconomyInteraction"),
    (i) => [i],
  ],
  [
    "voice",
    await load("../voice-commands.js", "handleVoiceInteraction"),
    (i, s) => [i, s[GUILD_ID]],
  ],
];

const settings = {
  [GUILD_ID]: {
    sysPlus: { roleId: ROLE },
    tickets: { enabled: true },
    logs: {},
  },
};
const findings = [];
const unhandled = [];
let runs = 0;
const originalError = console.error;
console.error = () => {};
process.on("unhandledRejection", (error) => {
  if (PROGRAMMING_ERROR.test(String(error?.message)))
    unhandled.push(String(error?.message).slice(0, 160));
});

for (const command of [...SLASH_COMMANDS, ...EXTRA_SLASH_COMMANDS]) {
  for (const { leaf, group } of leaves(command)) {
    for (const userId of [OWNER, OTHER]) {
      const ctx = makeGuild();
      const interaction = makeInteraction(command, leaf, group, ctx, userId);
      const path = [command.name, group, leaf?.name].filter(Boolean).join(" ");
      runs += 1;
      let handledBy = null;
      try {
        for (const [name, handler, args] of chain) {
          const result = await Promise.race([
            handler(...args(interaction, settings)),
            new Promise((resolve) =>
              setTimeout(() => resolve("timeout"), 3000),
            ),
          ]);
          if (result === "timeout") {
            handledBy = `${name} (timeout)`;
            break;
          }
          if (result) {
            handledBy = name;
            break;
          }
        }
      } catch (error) {
        if (
          PROGRAMMING_ERROR.test(String(error?.message)) ||
          error instanceof ReferenceError
        )
          findings.push({
            path,
            user: userId === OWNER ? "owner" : "membre",
            where: handledBy ?? "chaîne",
            error: String(error?.message).slice(0, 200),
            stack: String(error?.stack ?? "")
              .split("\n")
              .slice(1, 3)
              .join(" | ")
              .replace(/file:\/\/[^ ]*\/bot\//g, ""),
          });
        continue;
      }
      const text = JSON.stringify(interaction.replies);
      const match = text.match(PROGRAMMING_ERROR);
      if (match)
        findings.push({
          path,
          user: userId === OWNER ? "owner" : "membre",
          where: handledBy ?? "aucun",
          error: text.slice(Math.max(0, match.index - 80), match.index + 80),
        });
    }
  }
}

// ---- Prefix commands ("=...") through the messageCreate handler chain ----
const { readdirSync, readFileSync } = await import("node:fs");
const botDir = new URL("..", import.meta.url);
const sourceFiles = [
  ".",
  "systems/sysplus",
  "systems/lockname",
  "systems/waouf",
  "systems/setup",
  "systems/entitlements",
  "systems/creator",
  "systems/marketplace",
  "music",
].flatMap((d) =>
  readdirSync(new URL(`${d}/`, botDir))
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .map((f) => new URL(`${d}/${f}`, botDir)),
);
const prefixCommands = [
  ...new Set(
    sourceFiles.flatMap((file) =>
      [
        ...readFileSync(file, "utf8").matchAll(/"(=[a-z][a-z0-9-]{1,30})"/g),
      ].map((m) => m[1]),
    ),
  ),
].sort();
const API = {
  apiUrl: "http://127.0.0.1:9",
  secret: "x".repeat(32),
  record: () => {},
};
const messageChain = [
  ["resume", await load("../resume.js", "handleResumeMessage"), (m, s) => [m, s[GUILD_ID]]],
  ["dmall", await load("../dmall.js", "handleDmAllMessage"), (m, s) => [m, s[GUILD_ID]]],
  ["blacklist", await load("../blacklist.js", "handleBlacklistMessage"), (m, s) => [m, s[GUILD_ID]]],
  ["live", await load("../live-commands.js", "handleLiveMessage"), (m, s) => [m, s, API]],
  [
    "guardian",
    await load("../guardian-risk.js", "handleGuardianReviewMessage"),
    (m) => [m],
  ],
  [
    "staff-audit",
    await load("../staff-audit.js", "handleStaffMemberHistoryMessage"),
    (m, s) => [m, { settings: s, ownerIds: [OWNER] }],
  ],
  [
    "verification",
    await load(
      "../reaction-verification.js",
      "handleReactionVerificationCommand",
    ),
    (m) => [m],
  ],
  [
    "waouf",
    await load("../systems/waouf/commands.js", "handleWaoufMessage"),
    (m, s) => [m, s, () => {}],
  ],
  [
    "dog",
    await load("../dog-commands.js", "handleDogCommand"),
    (m, s) => [m, s[GUILD_ID]],
  ],
  [
    "lockname",
    await load("../systems/lockname/commands.js", "handleLocknameMessage"),
    (m, s) => [m, s[GUILD_ID]],
  ],
  [
    "knowledge",
    await load("../pnd-knowledge.js", "handleKnowledgeMessage"),
    (m) => [m],
  ],
  [
    "tickets",
    await load("../tickets.js", "handleTicketsMessage"),
    (m, s) => [m, s[GUILD_ID], API],
  ],
  [
    "custom-roles",
    await load(
      "../systems/sysplus/custom-roles.js",
      "handleCustomRolesMessage",
    ),
    (m, s) => [m, s[GUILD_ID]],
  ],
  [
    "roles",
    await load("../role-commands.js", "handleRoleMessage"),
    (m, s) => [m, s[GUILD_ID]],
  ],
  ["radio", await load("../music/music.js", "handleRadioMessage"), (m) => [m]],
  ["music", await load("../music/music.js", "handleMusicMessage"), (m) => [m]],
  [
    "voice",
    await load("../voice-commands.js", "handleVoiceMessage"),
    (m, s) => [m, s[GUILD_ID]],
  ],
  [
    "economy",
    await load("../economy.js", "handleEconomyMessage"),
    (m, s) => [m, s[GUILD_ID]],
  ],
  [
    "business",
    await load(
      "../business-investments-commands.js",
      "handleBusinessInvestmentMessage",
    ),
    (m) => [m],
  ],
  [
    "intelligence",
    await load("../pnd-intelligence.js", "handlePndIntelligenceMessage"),
    (m, s) => [m, { ...API, instructions: "", settings: s, ownerIds: [OWNER] }],
  ],
  [
    "autorules",
    await load(
      "../automation-rules-commands.js",
      "handleAutomationRulesMessage",
    ),
    (m) => [m],
  ],
  [
    "organization",
    await load("../organization-commands.js", "handleOrganizationMessage"),
    (m, s) => [m, { settings: s, ownerIds: [OWNER] }],
  ],
  ["social", await load("../social.js", "handleSocialMessage"), (m) => [m]],
  ["cards", await load("../cards.js", "handleCardsMessage"), (m) => [m]],
  [
    "games",
    await load("../games.js", "handleGamesMessage"),
    (m) => [m, () => {}],
  ],
  ["casino", await load("../casino.js", "handleCasinoMessage"), (m) => [m]],
  [
    "presence",
    await load("../voice-audit.js", "handleVoicePresenceMessage"),
    (m) => [m],
  ],
  [
    "automation",
    await load("../automation.js", "handleAutomationMessage"),
    (m, s) => [m, s[GUILD_ID], API],
  ],
  [
    "sysplus",
    await load("../systems/sysplus/commands.js", "handleSysPlusMessage"),
    (m, s) => [m, s[GUILD_ID], { ...API, audit: () => {} }],
  ],
];
let prefixRuns = 0;
let prefixHandled = 0;
const byHandler = {};
const unhandledPrefix = new Set();
const prefixOwners = {};
for (const command of prefixCommands) {
  for (const suffix of [
    "",
    " <@900000000000000002>",
    " list",
    " liste",
    " help",
    " <@900000000000000002> 100",
    " 100",
    " status",
    " <@&900000000000000200>",
  ]) {
    for (const userId of [OWNER, OTHER]) {
      const ctx = makeGuild();
      const author = userId === OWNER ? ctx.ownerMember : ctx.other;
      const replies = [];
      const content = `${command}${suffix}`;
      const message = withFallback(
        {
          id: `${Date.now()}`,
          content,
          guild: ctx.guild,
          guildId: GUILD_ID,
          channel: ctx.channel,
          channelId: CHANNEL,
          member: author,
          author: author.user,
          client: withFallback(
            {
              user: withFallback({ id: "900000000000000999" }, "cu"),
              guilds: withFallback(
                { cache: collection([[GUILD_ID, ctx.guild]]) },
                "cg",
              ),
            },
            "client",
          ),
          mentions: withFallback(
            {
              users: collection(
                suffix.includes("<@9") ? [[OTHER, ctx.other.user]] : [],
              ),
              members: collection(
                suffix.includes("<@9") ? [[OTHER, ctx.other]] : [],
              ),
              roles: collection(
                suffix.includes("<@&") ? [[ROLE, makeRole()]] : [],
              ),
              channels: collection(),
              everyone: false,
            },
            "mentions",
          ),
          reply: async (p) => {
            replies.push(p);
            return withFallback(
              {
                id: "r",
                edit: async (q) => {
                  replies.push(q);
                },
                delete: async () => {},
              },
              "replyMsg",
            );
          },
          delete: async () => {},
          react: async () => {},
          createdTimestamp: Date.now(),
        },
        "message",
      );
      prefixRuns += 1;
      let handledBy = null;
      try {
        for (const [name, handler, args] of messageChain) {
          const result = await Promise.race([
            handler(...args(message, settings)),
            new Promise((resolve) =>
              setTimeout(() => resolve("timeout"), 3000),
            ),
          ]);
          if (result === "timeout") {
            handledBy = `${name} (timeout)`;
            break;
          }
          if (result) {
            handledBy = name;
            break;
          }
        }
        if (handledBy) {
          (prefixOwners[command] ??= new Set()).add(handledBy);
          prefixHandled += 1;
          byHandler[handledBy] = (byHandler[handledBy] ?? 0) + 1;
        } else unhandledPrefix.add(command);
      } catch (error) {
        if (
          PROGRAMMING_ERROR.test(String(error?.message)) ||
          error instanceof ReferenceError
        )
          findings.push({
            path: content,
            user: userId === OWNER ? "owner" : "membre",
            where: handledBy ?? "chaîne",
            error: String(error?.message).slice(0, 200),
            stack: String(error?.stack ?? "")
              .split("\n")
              .slice(1, 3)
              .join(" | ")
              .replace(/file:\/\/[^ ]*\/bot\//g, ""),
          });
        continue;
      }
      const text = JSON.stringify(replies);
      const match = text.match(PROGRAMMING_ERROR);
      if (match)
        findings.push({
          path: content,
          user: userId === OWNER ? "owner" : "membre",
          where: handledBy ?? "aucun",
          error: text.slice(Math.max(0, match.index - 80), match.index + 80),
        });
    }
  }
}
runs += prefixRuns;
const coverage = {
  prefixRuns,
  prefixHandled,
  byHandler,
  prefixNeverHandled: [...unhandledPrefix].sort(),
};
console.error = originalError;
if (process.env.SMOKE_PREFIX_MAP) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.SMOKE_PREFIX_MAP, JSON.stringify(Object.fromEntries(Object.entries(prefixOwners).map(([k, v]) => [k, [...v].sort()])), null, 1));
}
await new Promise((resolve) => setTimeout(resolve, 200));
console.log(
  JSON.stringify(
    { runs, findings: findings.length, unhandled: [...new Set(unhandled)] },
    null,
    2,
  ),
);
if (process.env.SMOKE_VERBOSE) console.log(JSON.stringify(coverage));
for (const f of findings)
  console.log(
    `- [${f.user}] /${f.path} → ${f.where}: ${f.error}${f.stack ? `\n    ${f.stack}` : ""}`,
  );
rmSync(dir, { recursive: true, force: true });
process.exit(0);

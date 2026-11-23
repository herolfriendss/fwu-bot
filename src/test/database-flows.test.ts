// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// A disposable SQLite file keeps the integration checks away from the real
// bot/data/economy.sqlite. database.js reads HER_DB_PATH at import time.
const dir = mkdtempSync(join(tmpdir(), "her-v4-"));
const dbPath = join(dir, "economy.sqlite");
process.env["HER_DB_PATH"] = dbPath;

type Modules = {
  database: typeof import("../../bot/database.js");
  economy: typeof import("../../bot/economy.js");
  social: typeof import("../../bot/social.js");
  cards: typeof import("../../bot/cards.js");
};
let modules: Modules;

const G1 = "111111111111111111";
const G2 = "222222222222222222";
const U1 = "333333333333333333";
const U2 = "444444444444444444";

type FakeMessage = {
  guild: { id: string };
  member: { id: string; joinedTimestamp: number; permissions: { has: () => boolean }; roles: { cache: Map<string, unknown> } };
  author: { id: string; username: string; createdTimestamp: number };
  channel: { id: string };
  content: string;
  mentions: { users: { first: () => { id: string; bot: boolean } | null } };
  reply: (payload: unknown) => Promise<{ id: string }>;
  replies: unknown[];
};

function message(guildId: string, userId: string, content: string, mentions: string[] = []): FakeMessage {
  const replies: unknown[] = [];
  const users = mentions.map((id) => ({ id, bot: false }));
  return {
    guild: { id: guildId },
    // Established accounts: reputation and transfers refuse accounts/members younger than a few days.
    member: { id: userId, joinedTimestamp: Date.now() - 100 * 86_400_000, permissions: { has: () => false }, roles: { cache: new Map() } },
    author: { id: userId, username: `user-${userId.slice(-3)}`, createdTimestamp: Date.now() - 400 * 86_400_000 },
    channel: { id: "999999999999999999" },
    content,
    mentions: { users: { first: () => users[0] ?? null } },
    reply: async (payload: unknown) => {
      replies.push(payload);
      return { id: "reply" };
    },
    replies,
  };
}

function replyText(fake: FakeMessage): string {
  return fake.replies
    .map((payload) => {
      if (typeof payload === "string") return payload;
      const p = payload as { content?: string; embeds?: { data?: { title?: string; description?: string; fields?: { name: string; value: string }[] } }[] };
      const embeds = (p.embeds ?? []).map((embed) => {
        const data = embed.data ?? {};
        return [data.title ?? "", data.description ?? "", ...(data.fields ?? []).map((field) => `${field.name}: ${field.value}`)].join("\n");
      });
      return [p.content ?? "", ...embeds].join("\n");
    })
    .join("\n");
}

beforeAll(async () => {
  vi.resetModules();
  modules = {
    database: await import("../../bot/database.js"),
    economy: await import("../../bot/economy.js"),
    social: await import("../../bot/social.js"),
    cards: await import("../../bot/cards.js"),
  };
});

afterAll(() => {
  delete process.env["HER_DB_PATH"];
  rmSync(dir, { recursive: true, force: true });
});

describe("SQLite module flows", () => {
  it("shares the PND wallet with the card and social modules", () => {
    const start = modules.economy.grantPnd(G1, U1, 1_000, "test_seed");
    expect(start).toBe(1_000);
    expect(modules.economy.pndBalance(G1, U1)).toEqual({ balance: 1_000, bank: 0 });
  });

  it("supports nested transactions (pack purchase inside a module transaction)", () => {
    const total = modules.database.transaction(() => modules.economy.grantPnd(G1, U1, 25, "nested_reward"));
    expect(total).toBe(1_025);
    expect(modules.economy.pndBalance(G1, U1).balance).toBe(1_025);
  });

  it("opens a pack atomically and rolls back when PND is missing", async () => {
    const pack = message(G1, U1, "=pack");
    await modules.cards.handleCardsMessage(pack as never);
    expect(replyText(pack)).toContain("Pack ouvert");
    expect(modules.economy.pndBalance(G1, U1).balance).toBe(775);
    const owned = modules.database.db.prepare("SELECT COALESCE(SUM(quantity),0) AS count FROM user_cards WHERE guild_id=? AND user_id=?").get(G1, U1) as { count: number };
    expect(Number(owned.count)).toBe(3);

    const poor = message(G2, U1, "=pack");
    await modules.cards.handleCardsMessage(poor as never);
    expect(replyText(poor)).toContain("Solde PND insuffisant");
    expect(modules.economy.pndBalance(G2, U1).balance).toBe(0);
    const none = modules.database.db.prepare("SELECT COUNT(*) AS count FROM user_cards WHERE guild_id=?").get(G2) as { count: number };
    expect(Number(none.count)).toBe(0);
  });

  it("stores bios and colors in one profile row without corrupting the user id", async () => {
    const color = message(G1, U1, "=color #5865f2");
    await modules.social.handleSocialMessage(color as never);
    expect(replyText(color)).toContain("#5865f2");

    const bio = message(G1, U1, "=bio Développeur Her?");
    await modules.social.handleSocialMessage(bio as never);

    const row = modules.database.db.prepare("SELECT * FROM profiles WHERE guild_id=? AND user_id=?").get(G1, U1) as { user_id: string; bio: string; color: string };
    expect(row.user_id).toBe(U1);
    expect(row.bio).toBe("Développeur Her?");
    expect(row.color).toBe("#5865f2");

    const recolor = message(G1, U1, "=color #fff");
    await modules.social.handleSocialMessage(recolor as never);
    const updated = modules.database.db.prepare("SELECT bio,color FROM profiles WHERE guild_id=? AND user_id=?").get(G1, U1) as { bio: string; color: string };
    expect(updated.color).toBe("#ffffff");
    expect(updated.bio).toBe("Développeur Her?");
  });

  it("enforces the 24h reputation cooldown per target", async () => {
    const first = message(G1, U1, `=rep <@${U2}>`, [U2]);
    await modules.social.handleSocialMessage(first as never);
    expect(replyText(first)).toContain("réputation");

    const second = message(G1, U1, `=rep <@${U2}>`, [U2]);
    await modules.social.handleSocialMessage(second as never);
    expect(replyText(second)).toContain("Tu pourras redonner");

    const rows = modules.database.db.prepare("SELECT COUNT(*) AS count FROM reputation WHERE guild_id=? AND giver_id=? AND receiver_id=?").get(G1, U1, U2) as { count: number };
    expect(Number(rows.count)).toBe(1);
  });

  it("parses a slash-style trade mention and swaps ownership atomically", async () => {
    modules.database.db.prepare("DELETE FROM user_cards WHERE guild_id=? AND user_id IN (?,?)").run(G1, U1, U2);
    modules.database.db.prepare("INSERT INTO user_cards(guild_id,user_id,card_id,quantity,acquired_at) VALUES(?,?,?,1,?)").run(G1, U1, "dragon", Date.now());
    modules.database.db.prepare("INSERT INTO user_cards(guild_id,user_id,card_id,quantity,acquired_at) VALUES(?,?,?,1,?)").run(G1, U2, "chien", Date.now());

    const propose = message(G1, U1, `=trade propose <@${U2}> dragon chien`, [U2]);
    await modules.cards.handleCardsMessage(propose as never);
    expect(replyText(propose)).toContain("Échange");

    const trade = modules.database.db.prepare("SELECT * FROM card_trades WHERE guild_id=? AND from_id=? AND to_id=?").get(G1, U1, U2) as { trade_id: string; offer_card_id: string; request_card_id: string };
    expect(trade.offer_card_id).toBe("dragon");
    expect(trade.request_card_id).toBe("chien");

    const accept = message(G1, U2, `=trade accept ${trade.trade_id}`);
    await modules.cards.handleCardsMessage(accept as never);
    expect(replyText(accept)).toContain("accepté");

    const u1Dragon = modules.database.db.prepare("SELECT quantity FROM user_cards WHERE guild_id=? AND user_id=? AND card_id=?").get(G1, U1, "dragon");
    const u1Chien = modules.database.db.prepare("SELECT quantity FROM user_cards WHERE guild_id=? AND user_id=? AND card_id=?").get(G1, U1, "chien") as { quantity: number };
    expect(u1Dragon).toBeUndefined();
    expect(Number(u1Chien.quantity)).toBe(1);
  });

  it("isolates wallets, profiles and cards by guild", () => {
    modules.economy.grantPnd(G2, U1, 50, "isolation_seed");
    expect(modules.economy.pndBalance(G1, U1).balance).toBe(775);
    expect(modules.economy.pndBalance(G2, U1).balance).toBe(50);

    const g2Profile = modules.database.db.prepare("SELECT COUNT(*) AS count FROM profiles WHERE guild_id=?").get(G2) as { count: number };
    expect(Number(g2Profile.count)).toBe(0);
    const g2Cards = modules.database.db.prepare("SELECT COUNT(*) AS count FROM user_cards WHERE guild_id=?").get(G2) as { count: number };
    expect(Number(g2Cards.count)).toBe(0);
  });

  it("persists committed rows on disk for a restart", () => {
    const reopened = new DatabaseSync(dbPath);
    try {
      const wallet = reopened.prepare("SELECT balance FROM wallets WHERE guild_id=? AND user_id=?").get(G1, U1) as { balance: number };
      expect(Number(wallet.balance)).toBe(775);
      const profile = reopened.prepare("SELECT bio FROM profiles WHERE guild_id=? AND user_id=?").get(G1, U1) as { bio: string };
      expect(profile.bio).toBe("Développeur Her?");
      const cards = reopened.prepare("SELECT COUNT(*) AS count FROM user_cards WHERE guild_id=?").get(G1) as { count: number };
      expect(Number(cards.count)).toBeGreaterThan(0);
    } finally {
      reopened.close();
    }
  });

  it("keeps daily, work and bank flows inside the shared PND wallet", async () => {
    const balanceBefore = modules.economy.pndBalance(G1, U2).balance;
    const daily = message(G1, U2, "=daily");
    await modules.economy.handleEconomyMessage(daily as never);
    expect(replyText(daily)).toContain("Tu as reçu");
    const afterDaily = modules.economy.pndBalance(G1, U2).balance;
    expect(afterDaily).toBeGreaterThanOrEqual(balanceBefore + 100);

    const again = message(G1, U2, "=daily");
    await modules.economy.handleEconomyMessage(again as never);
    expect(replyText(again)).toContain("déjà récupéré");
    expect(modules.economy.pndBalance(G1, U2).balance).toBe(afterDaily);

    const work = message(G1, U2, "=work");
    await modules.economy.handleEconomyMessage(work as never);
    expect(replyText(work)).toContain("travaillé");
    const afterWork = modules.economy.pndBalance(G1, U2).balance;
    expect(afterWork).toBeGreaterThanOrEqual(afterDaily + 50);

    const repeatWork = message(G1, U2, "=work");
    await modules.economy.handleEconomyMessage(repeatWork as never);
    expect(replyText(repeatWork)).toContain("retravailler");
    expect(modules.economy.pndBalance(G1, U2).balance).toBe(afterWork);

    const deposit = message(G1, U2, "=bank deposit 100");
    await modules.economy.handleEconomyMessage(deposit as never);
    expect(replyText(deposit)).toContain("déposés");
    expect(modules.economy.pndBalance(G1, U2)).toEqual({ balance: afterWork - 100, bank: 100 });

    const withdraw = message(G1, U2, "=bank withdraw 50");
    await modules.economy.handleEconomyMessage(withdraw as never);
    expect(modules.economy.pndBalance(G1, U2)).toEqual({ balance: afterWork - 50, bank: 50 });

    const overdraft = message(G1, U2, "=bank withdraw 999999");
    await modules.economy.handleEconomyMessage(overdraft as never);
    expect(replyText(overdraft)).toContain("Banque PND insuffisante");
    expect(modules.economy.pndBalance(G1, U2)).toEqual({ balance: afterWork - 50, bank: 50 });
  });

  it("sells lottery tickets atomically and pays the winner from the pot", async () => {
    modules.economy.grantPnd(G1, U2, 500, "lottery_seed");
    const before = modules.economy.pndBalance(G1, U2).balance;
    const buy = message(G1, U2, "=lottery buy 2");
    await modules.economy.handleEconomyMessage(buy as never);
    expect(replyText(buy)).toContain("ticket(s) acheté(s)");
    expect(modules.economy.pndBalance(G1, U2).balance).toBe(before - 200);

    const draw = message(G1, U2, "=lottery draw");
    (draw.member.permissions as { has: () => boolean }).has = () => true;
    await modules.economy.handleEconomyMessage(draw as never);
    expect(replyText(draw)).toContain("remporte");
    expect(modules.economy.pndBalance(G1, U2).balance).toBe(before - 200 + 180);

    const noDraw = message(G1, U2, "=lottery draw");
    (noDraw.member.permissions as { has: () => boolean }).has = () => true;
    await modules.economy.handleEconomyMessage(noDraw as never);
    expect(replyText(noDraw)).toContain("Aucun tirage en cours");
  });

  it("refunds active blackjack games after a restart", () => {
    modules.economy.grantPnd(G2, U2, 1_000, "blackjack_seed");
    modules.database.db.prepare("INSERT INTO active_blackjack(game_id,guild_id,user_id,bet,player_cards,dealer_cards,created_at) VALUES(?,?,?,?,?,?,?)")
      .run("game-restart", G2, U2, 300, "[]", "[]", Date.now());
    expect(modules.economy.recoverBlackjackGames()).toBeUndefined();
    expect(modules.economy.pndBalance(G2, U2).balance).toBe(1_300);
    const remaining = modules.database.db.prepare("SELECT COUNT(*) AS count FROM active_blackjack WHERE guild_id=?").get(G2) as { count: number };
    expect(Number(remaining.count)).toBe(0);
  });

  it("builds a dashboard snapshot that matches the shared schema", async () => {
    const { economySnapshotSchema } = await import("@/lib/economy");
    modules.database.db.prepare("INSERT INTO shop_items(guild_id,role_id,price) VALUES(?,?,?)").run(G1, "555555555555555555", 500);
    const snapshot = modules.economy.economySnapshot(G1, {
      name: "Guild 1",
      members: { cache: new Map() },
      roles: { cache: new Map([["555555555555555555", { name: "VIP" }]]) },
    });
    const total = modules.database.db.prepare("SELECT COALESCE(SUM(balance + bank),0) AS total FROM wallets WHERE guild_id=?").get(G1) as { total: number };
    expect(snapshot.totalBalance).toBe(Number(total.total));
    expect(snapshot.topWallets.length).toBeLessThanOrEqual(10);
    expect(snapshot.topWallets[0]?.balance).toBeLessThanOrEqual(2_000_000_000_000);
    expect(snapshot.shopItems).toEqual([{ roleId: "555555555555555555", roleName: "VIP", price: 500 }]);
    expect(economySnapshotSchema.safeParse(snapshot).success).toBe(true);
  });
});

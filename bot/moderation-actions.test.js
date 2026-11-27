import test from "node:test";
import assert from "node:assert/strict";

test("ban proof: capture, link in proof or in reason; nothing otherwise", async () => {
  const { banProof } = await import("./moderation.js");
  assert.equal(banProof({ attachment: { url: "https://cdn.discordapp.com/x.png" } }), "https://cdn.discordapp.com/x.png");
  assert.equal(banProof({ proof: "voir https://discord.com/channels/1/2/3" }), "https://discord.com/channels/1/2/3");
  assert.equal(banProof({ reason: "spam https://discord.com/channels/1/2/3" }), "https://discord.com/channels/1/2/3");
  assert.equal(banProof({ proof: "insultes répétées en vocal ce soir" }), "insultes répétées en vocal ce soir");
  assert.equal(banProof({ proof: "court", reason: "spam" }), null);
});

test("an appeal cannot be reviewed by the moderator who issued the sanction", async () => {
  const { createSanctionAppeal, recordModerationCase, reviewModerationAppeal } = await import("./moderation.js");
  const recorded = recordModerationCase({ guildId: "ga", userId: "u", moderatorId: "mod", action: "ban", reason: "x" });
  const caseId = Number(recorded?.id ?? recorded?.caseId ?? recorded);
  const appealId = createSanctionAppeal("ga", "u", caseId, "Je conteste, c'était une erreur.");
  assert.throws(() => reviewModerationAppeal("ga", "mod", appealId, "accepted"), /autre membre du staff/);
  assert.equal(reviewModerationAppeal("ga", "other", appealId, "rejected").status, "rejected");
});

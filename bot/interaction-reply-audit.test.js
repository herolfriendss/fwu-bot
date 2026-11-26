import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  auditDirectory,
  findUnsafeCatchReplies,
} from "./scripts/audit-interaction-replies.mjs";

test("the detector flags a catch that replies after an acknowledgement", () => {
  assert.deepEqual(
    findUnsafeCatchReplies(
      "try {\n await interaction.deferReply();\n x();\n} catch (e) {\n await interaction.reply({});\n}",
    ),
    [1],
  );
  assert.deepEqual(
    findUnsafeCatchReplies(
      "try {\n await interaction.deferReply();\n} catch (e) {\n await respondInPlaceSafe(interaction, {});\n}",
    ),
    [],
  );
});

test("no handler of the bot replies twice from a catch block", () => {
  assert.deepEqual(
    auditDirectory(fileURLToPath(new URL(".", import.meta.url))),
    [],
  );
});

// FWU V2 — couche de réponses centrale : toute réponse passe par reply-layer.js.
test("every interaction and prefix reply goes through the central reply layer", async () => {
  const { readFileSync } = await import("node:fs");
  const index = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(index, /installReplyLayer\(interaction,/, "interactions wrapped");
  assert.match(index, /installMessageReplyLayer\(msg,/, "prefix replies wrapped");
  assert.match(index, /slashifyInteractionReplies\(interaction\);\s*\n\s*runAsActor/, "installed before any handler runs");
  assert.match(index, /prefixifyMessageReplies\(msg, OWN_PREFIX\);/, "installed for every own prefix command");
});

test("no sensitive command shows its details in public and no reply stays plain text", async () => {
  const { shapeReply, SENSITIVE_ACTIONS, isPlainText, PRIVATE_COMMANDS } = await import("./reply-layer.js");
  const details = { content: "✅ Fait pour <@300000000000000003>. Raison : spam. Durée : 7 j. Auteur : <@200000000000000002>.", ephemeral: true };
  for (const path of Object.keys(SENSITIVE_ACTIONS)) {
    const [commandName, ...rest] = path.split(" ");
    for (const surface of ["slash", "prefix"]) {
      const shaped = shapeReply(details, { bot: "guard", commandName, subcommand: rest.join(" ") || null, surface, initial: true, targetId: "300000000000000003", guildId: "1" });
      assert.doesNotMatch(JSON.stringify(shaped.payload), /Raison|Durée|Auteur|200000000000000002/, `${surface} ${path}`);
    }
  }
  const samples = ["Bonjour", "⛔ Non", "⚠️ Attention", "✅ Oui", { content: "Info", ephemeral: true }];
  for (const commandName of ["aide", "balance", "dog", "wakeup", "rank", ...PRIVATE_COMMANDS]) {
    for (const sample of samples) {
      const shaped = shapeReply(sample, { bot: "suckme", commandName, surface: "slash", initial: true });
      assert.equal(isPlainText(shaped.payload), false, `${commandName}: ${JSON.stringify(sample)}`);
    }
  }
});

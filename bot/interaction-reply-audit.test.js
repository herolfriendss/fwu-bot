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

import assert from "node:assert/strict";
import test from "node:test";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { payloadLimitViolations } from "./discord-payload-limits.js";

test("a payload within Discord limits has no violation, builders included", () => {
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("a:1").setLabel("OK").setStyle(ButtonStyle.Primary));
  const embed = new EmbedBuilder().setTitle("Titre").setDescription("x".repeat(4000)).addFields({ name: "n", value: "v" });
  assert.deepEqual(payloadLimitViolations({ content: "x".repeat(2000), embeds: [embed], components: [row] }), []);
  assert.deepEqual(payloadLimitViolations("court"), []);
  assert.deepEqual(payloadLimitViolations(null), []);
});

test("every limit Discord enforces is reported", () => {
  const field = { name: "n", value: "v".repeat(1025) };
  const violations = payloadLimitViolations({
    content: "x".repeat(2001),
    embeds: [
      { title: "t".repeat(257), description: "d".repeat(4097), footer: { text: "f".repeat(2049) }, fields: [...Array(26)].map(() => ({ name: "a", value: "b" })) },
      { fields: [field, { name: "", value: "x" }] },
      ...Array(9).fill({ description: "z" }),
    ],
    components: [
      { type: 1, components: [...Array(6)].map((_, i) => ({ type: 2, custom_id: i ? `b${i}` : "x".repeat(101), label: "l".repeat(81) })) },
      { type: 1, components: [{ type: 3, custom_id: "s", options: [...Array(26)].map((_, i) => ({ label: `o${i}`, value: `${i}` })) }, { type: 2, custom_id: "s" }] },
      ...Array(4).fill({ type: 1, components: [] }),
    ],
  });
  const text = violations.join("\n");
  for (const pattern of [/content 2001/, /footer 2049/, /11 embeds/, /title 257/, /description 4097/, /26 fields/, /value 1025/, /empty name/, /embeds total/, /6 rows/, /6 items/, /custom_id 101/, /label 81/, /26 options/, /duplicate custom_id s/]) {
    assert.match(text, pattern);
  }
});

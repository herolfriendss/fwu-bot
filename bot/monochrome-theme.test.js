import test from "node:test";
import assert from "node:assert/strict";
import { ButtonBuilder, ButtonStyle, EmbedBuilder, ActionRowBuilder, MessagePayload } from "discord.js";
import { MONO, isGray, toMonochrome, monochromeBody, installMonochromeTheme } from "./monochrome-theme.js";

test("any colour becomes a neutral grey, never 0 (Discord's 'no colour')", () => {
  for (const color of [0xef4444, 0x22c55e, 0x5865f2, 0xffffff, 0x000000, 0xf59e0b]) {
    const grey = toMonochrome(color);
    assert.ok(isGray(grey), color.toString(16));
    assert.ok(grey > 0);
  }
  assert.equal(toMonochrome(MONO.white), MONO.white);
  assert.equal(toMonochrome(null), null);
});

test("embeds and coloured buttons of an outgoing body turn black and white", () => {
  const body = {
    embeds: [{ color: 0xef4444, title: "x" }, { title: "sans couleur" }],
    components: [{ type: 1, components: [
      { type: 2, style: 1, label: "Primaire", custom_id: "a" },
      { type: 2, style: 3, label: "Succès", custom_id: "b" },
      { type: 2, style: 4, label: "Danger", custom_id: "c" },
      { type: 2, style: 5, label: "Lien", url: "https://example.com" },
      { type: 3, custom_id: "menu", options: [] },
    ] }],
  };
  monochromeBody(body);
  assert.ok(isGray(body.embeds[0].color));
  assert.equal(body.embeds[1].color, MONO.default, "uncoloured embeds get the theme colour");
  assert.deepEqual(body.components[0].components.slice(0, 3).map((b) => b.style), [2, 2, 2]);
  assert.equal(body.components[0].components[3].style, 5, "link buttons stay links");
});

test("installed on discord.js, every MessagePayload is themed", () => {
  installMonochromeTheme();
  const embed = new EmbedBuilder().setColor(0x22c55e).setTitle("Vert");
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ok").setLabel("OK").setStyle(ButtonStyle.Success));
  const target = { client: { options: {} }, constructor: { name: "TextChannel" } };
  const payload = new MessagePayload(target, { embeds: [embed], components: [row] }).resolveBody();
  assert.ok(isGray(payload.body.embeds[0].color));
  assert.equal(payload.body.components[0].components[0].style, ButtonStyle.Secondary);
});

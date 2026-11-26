import test from "node:test";
import assert from "node:assert/strict";
import { NAMED_COLORS, colorPickerComponents, colorPreviewEmbed, resolveColor } from "./role-colors.js";
import { normalizeCustomRoleColor } from "./custom-roles-policy.js";
import { monochromeBody } from "../../monochrome-theme.js";

test("25 named colours fit one Discord menu, plus a free colour button", () => {
  assert.equal(NAMED_COLORS.length, 25);
  assert.equal(new Set(NAMED_COLORS.map((c) => c.hex)).size, 25);
  const rows = colorPickerComponents("rolepanel:custom:colormenu:123456789012345678");
  assert.equal(rows[0].components[0].options.length, 25);
  assert.match(rows[1].components.at(-1).label, /Couleur libre/);
  for (const row of rows) for (const c of row.components) assert.ok(c.custom_id.length <= 100);
});

test("a colour name or a #RRGGBB code is accepted; anything else is refused", () => {
  assert.equal(resolveColor("rose pâle"), "#F8BBD0");
  assert.equal(resolveColor("Rose pale"), "#F8BBD0");
  assert.equal(resolveColor("ff66cc"), "#FF66CC");
  assert.equal(normalizeCustomRoleColor("Bleu ciel"), "#64B5F6");
  assert.throws(() => normalizeCustomRoleColor("arc-en-ciel"), /Couleur inconnue/);
});

test("selecting a colour shows an 'Apply' button and a live preview in the real colour (exempt from the black-and-white theme)", () => {
  const rows = colorPickerComponents("rolepanel:custom:colormenu:123456789012345678", { selected: "#E53935" });
  assert.match(rows[1].components[0].custom_id, /:apply:E53935$/);
  const body = { embeds: [colorPreviewEmbed("#E53935", "Mon rôle")] };
  monochromeBody(body);
  assert.equal(body.embeds[0].color, 0xe53935);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { HER_THEME_COLOR, HER_THEME_FOOTER, herLiveAlertImageUrl, herThemeImageUrl, themePanelEmbed } from "./theme.js";

test("Her? theme URL uses the public animated image on the configured HTTPS site", () => {
  const previous = process.env.SITE_URL;
  const previousImage = process.env.HER_THEME_IMAGE_URL;
  delete process.env.HER_THEME_IMAGE_URL;
  process.env.SITE_URL = "https://dashboard.example.test/";
  assert.equal(herThemeImageUrl(), "https://dashboard.example.test/media/her-v5-city-loop.gif");
  if (previous === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previous;
  if (previousImage === undefined) delete process.env.HER_THEME_IMAGE_URL; else process.env.HER_THEME_IMAGE_URL = previousImage;
});

test("Her? theme rejects insecure external image overrides", () => {
  const previous = process.env.HER_THEME_IMAGE_URL;
  process.env.HER_THEME_IMAGE_URL = "http://example.test/banner.gif";
  assert.equal(herThemeImageUrl(), null);
  if (previous === undefined) delete process.env.HER_THEME_IMAGE_URL; else process.env.HER_THEME_IMAGE_URL = previous;
});

test("LIVE alert image URLs use the generated animated Her? artwork per platform", () => {
  const previous = process.env.SITE_URL;
  process.env.SITE_URL = "https://dashboard.example.test";
  assert.equal(herLiveAlertImageUrl("youtube"), "https://dashboard.example.test/media/her-v5-live-alert-main.gif");
  assert.equal(herLiveAlertImageUrl("tiktok"), "https://dashboard.example.test/media/her-v5-live-alert-grid.gif");
  if (previous === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previous;
});

test("panel branding applies the violet accent and GIF only when animation is enabled", () => {
  const calls = [];
  const embed = {
    setColor(value) { calls.push(["color", value]); return this; },
    setImage(value) { calls.push(["image", value]); return this; },
    setFooter(value) { calls.push(["footer", value]); return this; },
  };
  const previous = process.env.SITE_URL;
  process.env.SITE_URL = "https://dashboard.example.test";
  themePanelEmbed(embed);
  assert.deepEqual(calls[0], ["color", HER_THEME_COLOR]);
  assert.deepEqual(calls[1], ["image", "https://dashboard.example.test/media/her-v5-city-loop.gif"]);
  // The main bot signs nothing: an empty footer is omitted (Discord rejects empty footer text).
  assert.equal(calls.some(([kind]) => kind === "footer"), Boolean(HER_THEME_FOOTER));
  calls.length = 0;
  themePanelEmbed(embed, { animated: false });
  assert.equal(calls.some(([kind]) => kind === "image"), false);
  if (previous === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previous;
});

test("the shared Her? animated city asset exists as an animated GIF", async () => {
  const path = fileURLToPath(new URL("../public/media/her-v5-city-loop.gif", import.meta.url));
  const bytes = await readFile(path);
  assert.equal(bytes.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.ok(bytes.length > 20_000);
});

test("both generated LIVE announcement banners are stored as animated GIF assets", async () => {
  for (const filename of ["her-v5-live-alert-main.gif", "her-v5-live-alert-grid.gif"]) {
    const path = fileURLToPath(new URL(`../public/media/${filename}`, import.meta.url));
    const bytes = await readFile(path);
    assert.ok(["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii")));
    assert.ok(bytes.length > 100_000);
  }
});

test("each dedicated bot signs with its own name only, owner can restyle without code", async () => {
  const { themeFooterFrom, themeColorFrom, themeColorForProfile } = await import("./theme.js");
  assert.equal(themeFooterFrom({}), "");
  assert.equal(themeFooterFrom({ PND_BOT_PROFILE: "guard" }), "GUARD");
  assert.equal(themeFooterFrom({ PND_BOT_PROFILE: "fisc" }), "LE FISC");
  assert.equal(themeFooterFrom({ PND_BOT_PROFILE: "suckme", PND_SUCKME_FOOTER: "SUCK ME" }), "SUCK ME");
  assert.equal(themeFooterFrom({ PND_SUCKME_FOOTER: "x" }), "", "le réglage d'un bot ne touche pas le bot principal");
  assert.equal(themeColorForProfile({ PND_BOT_PROFILE: "guard", PND_GUARD_COLOR: "#dc2626" }), 0xdc2626);
  assert.equal(themeColorForProfile({ PND_GUARD_COLOR: "#dc2626" }), 0xe21d2f);
  assert.equal(themeColorFrom("#22c55e"), 0x22c55e);
  assert.equal(themeColorFrom("nope"), 0xe21d2f);
  assert.equal(themeColorFrom(undefined), 0xe21d2f);
});

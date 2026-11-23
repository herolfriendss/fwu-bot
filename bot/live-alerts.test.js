import test from "node:test";
import assert from "node:assert/strict";
import { buildLiveAlertEmbed, parseFeed } from "./live-alerts.js";

test("parseFeed reads RSS items and decodes CDATA links", () => {
  const xml = `<rss><channel><item><title><![CDATA[Creator is LIVE now]]></title><link>https://youtube.com/watch?v=abc&amp;x=1</link><guid>abc</guid><pubDate>Wed, 12 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
  const [item] = parseFeed(xml);
  assert.equal(item.title, "Creator is LIVE now");
  assert.equal(item.link, "https://youtube.com/watch?v=abc&x=1");
  assert.equal(item.id, "abc");
});

test("parseFeed reads Atom entries with href links", () => {
  const xml = `<feed><entry><id>tag:example,2026:live-1</id><title>En direct maintenant</title><link rel="alternate" href="https://example.com/live"/><updated>2026-11-12T12:00:00Z</updated></entry></feed>`;
  const [item] = parseFeed(xml);
  assert.equal(item.id, "tag:example,2026:live-1");
  assert.equal(item.link, "https://example.com/live");
});

test("parseFeed rejects entries without an HTTPS destination", () => {
  assert.deepEqual(parseFeed(`<rss><item><title>LIVE</title><link>http://example.com</link><guid>x</guid></item></rss>`), []);
});

test("feed URL validation rejects local and private network targets", async () => {
  const { validatePublicFeedUrl } = await import("./live-alerts.js");
  await assert.rejects(validatePublicFeedUrl("http://example.com/feed"), /https_required/);
  await assert.rejects(validatePublicFeedUrl("https://127.0.0.1/feed"), /private_ip/);
  await assert.rejects(validatePublicFeedUrl("https://localhost/feed"), /private_host/);
  await assert.rejects(validatePublicFeedUrl("https://example.com/feed", async () => [{ address: "10.0.0.4" }]), /private_host/);
});

test("feed URL validation accepts a public HTTPS host", async () => {
  const { validatePublicFeedUrl } = await import("./live-alerts.js");
  const url = await validatePublicFeedUrl("https://feeds.example.org/live.xml", async () => [{ address: "8.8.8.8" }]);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "feeds.example.org");
});

test("LIVE announcement embeds use the Her? animation by default and can be static", () => {
  const previous = process.env.SITE_URL;
  process.env.SITE_URL = "https://dashboard.example.test";
  const creator = { displayName: "Créateur", platform: "youtube" };
  const item = { title: "Creator is LIVE now", link: "https://youtube.com/watch?v=abc" };
  const animated = buildLiveAlertEmbed(creator, item);
  assert.equal(animated.title, "🔴 Créateur est en LIVE !");
  assert.equal(animated.url, item.link);
  assert.equal(animated.image.url, "https://dashboard.example.test/media/her-v5-live-alert-main.gif");
  const still = buildLiveAlertEmbed(creator, item, false);
  assert.equal("image" in still, false);
  if (previous === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previous;
});

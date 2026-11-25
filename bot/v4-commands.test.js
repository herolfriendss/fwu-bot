import test from "node:test";
import assert from "node:assert/strict";
import { resolveLegacyCommandName } from "./v4-commands.js";

function musicInteraction(subcommand, group = "player") {
  return {
    commandName: "music",
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => subcommand,
    },
  };
}

test("the grouped music command preserves every legacy player route", () => {
  const routes = [
    ["play", "play"],
    ["pause", "pause"],
    ["resume", "resume"],
    ["skip", "skip"],
    ["stop", "stop"],
    ["queue", "queue"],
    ["nowplaying", "nowplaying"],
    ["volume", "volume"],
    ["loop", "loop"],
    ["shuffle", "shuffle"],
    ["clearqueue", "clearqueue"],
    ["remove", "remove"],
    ["join", "join"],
    ["leave", "leave"],
    ["panel", "musicpanel"],
  ];
  for (const [subcommand, expected] of routes) {
    assert.equal(resolveLegacyCommandName(musicInteraction(subcommand)), expected);
  }
});

test("unrelated roots and unknown music groups are not rewritten", () => {
  assert.equal(resolveLegacyCommandName({ commandName: "radio", options: {} }), "radio");
  assert.equal(resolveLegacyCommandName(musicInteraction("play", "unknown")), "music");
});

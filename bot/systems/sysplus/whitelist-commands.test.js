import test from "node:test";
import assert from "node:assert/strict";
import { handleWhitelistInteraction } from "./whitelist-commands.js";

function interaction({ actorId, ownerId, commandName = "whitelist-add", subcommand = "whitelist-add" }) {
  const replies = [];
  return {
    replies,
    isChatInputCommand: () => true,
    commandName,
    options: { getSubcommand: () => subcommand },
    user: { id: actorId },
    guild: {
      id: "guild",
      ownerId,
      fetchOwner: async () => ({ id: ownerId }),
      members: { fetch: async () => ({ id: actorId }) },
      roles: {
        fetch: async () => {
          throw new Error("should not fetch before owner check");
        },
      },
    },
    reply: async (payload) => replies.push(payload),
  };
}

test("WHITELIST interactions reject SYS+ and ADMIN+ before reading role configuration", async () => {
  const request = interaction({ actorId: "staff", ownerId: "owner" });
  const handled = await handleWhitelistInteraction(request, {});
  assert.equal(handled, true);
  assert.match(request.replies[0].content, /Seul le propriétaire/);
  assert.equal(request.replies[0].ephemeral, true);
});

test("WHITELIST actions remain available as /sysp subcommands", async () => {
  const request = interaction({ actorId: "staff", ownerId: "owner", commandName: "sysp", subcommand: "whitelist-add" });
  const handled = await handleWhitelistInteraction(request, {});
  assert.equal(handled, true);
  assert.match(request.replies[0].content, /Seul le propriétaire/);
});

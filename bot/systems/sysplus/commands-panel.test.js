import test from "node:test";
import assert from "node:assert/strict";
import { handleSysPlusMessage } from "./commands.js";

test("SYS+ panel lists implemented controls instead of stale development placeholders", async () => {
  let response;
  const member = {
    id: "sys-user",
    guild: { id: "guild-a", ownerId: "owner" },
    roles: { cache: { has: (roleId) => roleId === "sys-role" } },
  };
  const message = {
    content: "=sysp",
    guild: { id: "guild-a", name: "PND", client: null },
    member,
    author: { id: member.id },
    reply: async (payload) => { response = payload; },
  };

  assert.equal(await handleSysPlusMessage(message, { sysPlus: { roleId: "sys-role" } }, {}), true);
  const rendered = response.embeds[0].toJSON();
  const fields = rendered.fields.map(({ name, value }) => `${name}: ${value}`).join("\n");
  assert.match(fields, /\/sysp permissions` \/ `\/sysp permissions-edit`/);
  assert.match(fields, /\/sysp add` \/ `\/sysp remove`/);
  assert.match(fields, /WHITELIST/);
  assert.doesNotMatch(fields, /En développement|apparaîtront ici/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { containsSecretInput, handleHelpAssistantInteraction, hasUnknownCommandReference, redactPrivateText } from "./help-assistant.js";

function interaction({ guildId = "123456789012345678", userId = "222222222222222222", command = "ia", sub = "question", question = "Comment utiliser le guide ?" } = {}) {
  const calls = { replies: [], edits: [], deferred: [] };
  return {
    calls,
    guildId,
    user: { id: userId },
    commandName: command,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => sub,
      getString: () => question,
    },
    deferReply: async (options) => calls.deferred.push(options),
    editReply: async (payload) => calls.edits.push(payload),
    reply: async (payload) => calls.replies.push(payload),
  };
}

test("assistant ignores other commands and /ia subcommands", async () => {
  assert.equal(await handleHelpAssistantInteraction(interaction({ command: "quota" }), {}), false);
  assert.equal(await handleHelpAssistantInteraction(interaction({ sub: "memoire" }), {}), false);
});

test("assistant sends only question, public catalogue and guild knowledge; no user history", async () => {
  const current = interaction();
  let request;
  const handled = await handleHelpAssistantInteraction(current, {
    apiUrl: "https://example.invalid/api/public/bot-sync",
    secret: "server-secret",
    commands: [{ name: "guide", description: "Guide des permissions", usage: "/guide voir", bot: "suckme", prefix: "=" }],
    knowledge: [{ key: "guide", title: "Guide", content: "Consulte le panneau. token: abcdefghijklmnop user@example.com" }],
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ reply: "Utilise `/guide voir`." }) };
    },
  });
  assert.equal(handled, true);
  assert.deepEqual(current.calls.deferred, [{ ephemeral: true }]);
  assert.equal(current.calls.edits[0].content, "Utilise `/guide voir`.");
  assert.deepEqual(current.calls.edits[0].allowedMentions, { parse: [] });
  assert.equal(request.body.action, "ai-help-answer");
  assert.equal(request.body.prompt, "Comment utiliser le guide ?");
  assert.equal(request.body.guildId, current.guildId);
  assert.deepEqual(request.body.commands[0], { name: "guide", description: "Guide des permissions", usage: "/guide voir", bot: "suckme", prefix: "=" });
  assert.equal("userId" in request.body, false);
  assert.equal("author" in request.body, false);
  assert.equal("history" in request.body, false);
  assert.equal(request.body.knowledge[0].content, "[contenu masqué : information sensible détectée]");
});

test("assistant enforces three questions per minute per member", async () => {
  const guildId = "333333333333333333";
  const userId = "444444444444444444";
  let requests = 0;
  const options = {
    apiUrl: "https://example.invalid/api/public/bot-sync",
    secret: "server-secret",
    commands: [{ name: "aide" }],
    knowledge: [],
    fetchImpl: async () => { requests += 1; return { ok: true, json: async () => ({ reply: "Réponse." }) }; },
  };
  for (let i = 0; i < 3; i += 1) {
    const current = interaction({ guildId, userId });
    assert.equal(await handleHelpAssistantInteraction(current, options), true);
    assert.equal(current.calls.edits[0].content, "Réponse.");
  }
  const limited = interaction({ guildId, userId });
  assert.equal(await handleHelpAssistantInteraction(limited, options), true);
  assert.equal(requests, 3);
  assert.match(limited.calls.replies[0].content, /3 questions par minute/);
});

test("command reference validator rejects invented roots, subcommands and prefixes", () => {
  const commands = [
    { name: "aide", prefix: "=", paths: ["aide"] },
    { name: "ia", prefix: "=", paths: ["ia", "ia question", "ia memoire"] },
    { name: "ban", prefix: "+", paths: ["ban"] },
  ];
  assert.equal(hasUnknownCommandReference("Utilise `/aide`, `=ia question` ou `+ban membre: @id`.", commands), false);
  assert.equal(hasUnknownCommandReference("Utilise `/commande-inventee`.", commands), true);
  assert.equal(hasUnknownCommandReference("Utilise `=ia admin`.", commands), true);
  assert.equal(hasUnknownCommandReference("Utilise `!ban`.", commands), true);
});

test("assistant redacts identifiers and blocks secrets before contacting the model", async () => {
  assert.equal(containsSecretInput("token: abcdefghijklmnop"), true);
  assert.equal(containsSecretInput("question ordinaire sur les tickets"), false);
  const redacted = redactPrivateText("Contact user@example.com, mention <@123456789012345678>, IP 192.168.1.4, tel +33 6 12 34 56 78, erreur 2026-11-28 04:50.");
  assert.doesNotMatch(redacted, /user@example.com|123456789012345678|192\.168\.1\.4/);
  assert.match(redacted, /adresse e-mail masquée/);
  assert.match(redacted, /@membre/);
  assert.match(redacted, /2026-11-28 04:50/);
  assert.match(redacted, /numéro masqué/);

  const secretQuestion = interaction({ guildId: "555555555555555555", userId: "666666666666666666", question: "Voici mon token: abcdefghijklmnop" });
  let fetched = false;
  await handleHelpAssistantInteraction(secretQuestion, {
    apiUrl: "https://example.invalid/api/public/bot-sync",
    secret: "server-secret",
    fetchImpl: async () => { fetched = true; return { ok: true, json: async () => ({ reply: "no" }) }; },
  });
  assert.equal(fetched, false);
  assert.match(secretQuestion.calls.replies[0].content, /ne partage jamais de token/);
});

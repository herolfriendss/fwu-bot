import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSetupBoolean,
  parseSetupId,
  parseSetupModule,
  setupChangedKeys,
  setupFormFields,
  SETUP_MODULES,
} from "./policy.js";

test("parses supported boolean values and rejects ambiguous input", () => {
  assert.equal(parseSetupBoolean("oui"), true);
  assert.equal(parseSetupBoolean("OFF"), false);
  assert.throws(() => parseSetupBoolean("peut-être"), /oui ou non/);
});

test("accepts Discord role and channel mentions as well as raw IDs", () => {
  assert.equal(parseSetupId("<@&123456789012345>", "role"), "123456789012345");
  assert.equal(parseSetupId("<@&123456789012345>", "role"), "123456789012345");
  assert.equal(parseSetupId("<#123456789012345>", "textChannel"), "123456789012345");
  assert.equal(parseSetupId("not-an-id", "textChannel"), null);
});

test("bounds numeric inputs and validates enums and resource requirements", () => {
  assert.deepEqual(parseSetupModule("spam", {
    enabled: "oui", maxMessages: "8", perSeconds: "6", maxMentions: "4", timeoutMinutes: "10",
  }, { retainedFlag: true }), {
    enabled: true, maxMessages: 8, perSeconds: 6, maxMentions: 4, timeoutMinutes: 10, retainedFlag: true,
  });
  assert.throws(() => parseSetupModule("spam", {
    enabled: "oui", maxMessages: "8", perSeconds: "6", maxMentions: "99", timeoutMinutes: "10",
  }, {}), /entre 2 et 20/);
  assert.throws(
    () => parseSetupModule("tickets", { enabled: "oui", maxOpenPerUser: "6" }, {}),
    /entre 1 et 5/,
  );
  assert.throws(
    () =>
      parseSetupModule(
        "guildGuard",
        {
          enabled: "oui",
          minAccountAgeDays: "10",
          youngAccountAction: "ban",
          quarantineRoleId: "",
          logChannelId: "",
        },
        {},
      ),
    /doit valoir/,
  );
  assert.throws(
    () =>
      parseSetupModule(
        "verification",
        {
          enabled: "oui",
          roleId: "",
          channelId: "",
          minAccountAgeDays: "0",
          message: "Valide ton accès",
        },
        {},
      ),
    /demande un rôle/,
  );
});

test("preserves unedited module settings and normalizes role lists", () => {
  const result = parseSetupModule(
    "automation",
    {
      autoRoleIds: "<@&123456789012345>, 123456789012346",
      welcomeDm: "non",
      welcomeDmMessage: "Bienvenue sur {server}",
    },
    { unrelatedExistingSetting: true },
  );
  assert.deepEqual(result.autoRoleIds, ["123456789012345", "123456789012346"]);
  assert.equal(result.welcomeDm, false);
  assert.equal(result.unrelatedExistingSetting, true);
  assert.deepEqual(setupChangedKeys({}, result), Object.keys(result));
});

test("every setup module stays within Discord modal component limits", () => {
  // The modal shows every field except `enabled` (handled by its own button): 5 inputs at most.
  for (const [module, definition] of Object.entries(SETUP_MODULES)) {
    assert.ok(definition.fields.length >= 1);
    assert.ok(setupFormFields(module).length >= 1 && setupFormFields(module).length <= 5, module);
  }
});

test("the DOG module stores a bounded integer limit alongside unrelated guild settings", () => {
  assert.deepEqual(
    parseSetupModule("dog", { maxActiveLeashes: "5" }, { unrelatedExistingSetting: true }),
    { maxActiveLeashes: 5, unrelatedExistingSetting: true },
  );
  assert.deepEqual(parseSetupModule("dog", { maxActiveLeashes: " 7 " }, {}), { maxActiveLeashes: 7 });
  assert.deepEqual(parseSetupModule("dog", { maxActiveLeashes: "1" }, {}), { maxActiveLeashes: 1 });
  assert.deepEqual(parseSetupModule("dog", { maxActiveLeashes: "10" }, {}), { maxActiveLeashes: 10 });
});

test("the DOG module rejects out-of-range and non-integer limits", () => {
  for (const bad of ["0", "11", "-1", "3.5", "1e1", "", "abc"]) {
    assert.throws(
      () => parseSetupModule("dog", { maxActiveLeashes: bad }, {}),
      /entier|entre 1 et 10/,
      `valeur ${JSON.stringify(bad)}`,
    );
  }
});

test("the DOG module is registered with a single labelled field", () => {
  assert.equal(SETUP_MODULES.dog.label, "DOG — laisses par SYS+");
  assert.deepEqual(SETUP_MODULES.dog.fields.map((field) => field.key), ["maxActiveLeashes"]);
});

test("the DOG leash field declares its default of 3 for the form display", () => {
  const field = SETUP_MODULES.dog.fields.find((f) => f.key === "maxActiveLeashes");
  assert.equal(field.default, 3);
});

test("temporary voice: the empty-channel grace period is a bounded integer", () => {
  assert.equal(parseSetupModule("tempVoice", { emptyDeleteSeconds: "60" }, {}).emptyDeleteSeconds, 60);
  assert.throws(() => parseSetupModule("tempVoice", { emptyDeleteSeconds: "301" }, {}), /entre 0 et 300/);
  assert.throws(() => parseSetupModule("tempVoice", { emptyDeleteSeconds: "-1" }, {}), /nombre entier/);
});

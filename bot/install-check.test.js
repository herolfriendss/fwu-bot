import test from "node:test";
import assert from "node:assert/strict";
import { formatInstallationReport, resolveInstallationBotIds, suckMePlacementIssues, botPlacementIssues, REQUIRED_PERMISSIONS } from "./install-check.js";
import { BOT_PROFILE_IDS } from "./bot-runtime.js";
import { PermissionFlagsBits } from "discord.js";

test("SUCK ME : doit dominer les rôles 0 % et les laisses, juste sous le rôle de l'owner", () => {
  const roles = [
    { id: "owner", name: "Owner", position: 20, managed: false },
    { id: "staff", name: "Staff", position: 15, managed: false },
    { id: "zero", name: "Intouchable", position: 12, managed: false },
    { id: "leash", name: "En laisse (Ryan)", position: 3, managed: false },
  ];
  const issues = suckMePlacementIssues({ botTop: 10, roles, tier0RoleIds: new Set(["zero"]), ownerTop: 20 });
  assert.equal(issues.length, 2);
  assert.match(issues[0], /au-dessus de \*\*Intouchable\*\*/);
  assert.match(issues[1], /juste sous ton rôle.*2 rôle/);
  assert.deepEqual(suckMePlacementIssues({ botTop: 19, roles, tier0RoleIds: new Set(["zero"]), ownerTop: 20 }), []);
});

test("les six bots reçoivent le même socle opérationnel étendu sans Administrator", () => {
  const profiles = BOT_PROFILE_IDS.map((profile) => REQUIRED_PERMISSIONS[profile]);
  for (const permissions of profiles) {
    assert.ok(permissions.includes("ManageRoles"));
    assert.ok(permissions.includes("ManageChannels"));
    assert.ok(permissions.includes("BanMembers"));
    assert.ok(permissions.includes("ModerateMembers"));
    assert.ok(!permissions.includes("Administrator"));
    for (const name of permissions) {
      assert.notEqual(PermissionFlagsBits[name], undefined, `permission Discord inconnue: ${name}`);
    }
  }
  assert.ok(profiles.every((permissions) => JSON.stringify(permissions) === JSON.stringify(profiles[0])));
});

test("hiérarchie : chaque bot reste sous OWNER et au-dessus des rôles humains administrables", () => {
  const roles = [
    { id: "owner-role", name: "OWNER", position: 30, managed: false },
    { id: "staff", name: "Staff", position: 20, managed: false },
    { id: "member", name: "Membre", position: 5, managed: false },
    { id: "integration", name: "Bot role", position: 25, managed: true },
  ];
  assert.deepEqual(botPlacementIssues({
    botTop: 25,
    roles,
    ownerTop: 30,
    ownerRoleIds: new Set(["owner-role"]),
  }), []);
  assert.ok(botPlacementIssues({
    botTop: 15,
    roles,
    ownerTop: 30,
    ownerRoleIds: new Set(["owner-role"]),
  }).some((issue) => issue.includes("Staff")));
  assert.ok(botPlacementIssues({
    botTop: 30,
    roles,
    ownerTop: 30,
    ownerRoleIds: new Set(["owner-role"]),
  }).some((issue) => issue.includes("sous le rôle OWNER")));
});

test("rapport : bots principaux absents signalés, Invest + facultatif sans alarme", () => {
  const text = formatInstallationReport({
    bots: [
      { label: "FWU", present: true, missing: [], placement: [] },
      { label: "GUARD", present: true, missing: ["Bannir"], placement: [] },
      { label: "LE FISC", present: false, optional: false, missing: [], placement: [] },
      { label: "Invest +", present: false, optional: true, missing: [], placement: [] },
    ],
    extraLines: ["🟢 Base centrale : joignable."],
  });
  assert.match(text, /✅ \*\*FWU\*\*/);
  assert.match(text, /⚠️ \*\*GUARD\*\* :\n　• permission manquante : Bannir/);
  assert.match(text, /🟠 \*\*LE FISC\*\* : absent/);
  assert.match(text, /⚪ \*\*Invest \+\*\* : facultatif, non installé/);
  assert.match(text, /Paramètres du serveur → Rôles/);
  assert.ok(REQUIRED_PERMISSIONS.suckme.includes("MuteMembers"), "rôle 0 % intouchable : rendre muet requis");
});

test("une application principale absente demande une réinvitation, pas une correction de rôles", () => {
  const text = formatInstallationReport({
    bots: [
      { label: "FWU", present: true, missing: [], placement: [] },
      { label: "GUARD", present: false, optional: false, missing: [], placement: [] },
      { label: "Invest +", present: false, optional: true, missing: [], placement: [] },
    ],
  });
  assert.match(text, /Réinvite ou redémarre 1 application(?:\(s\))? principale(?:\(s\))? absente(?:\(s\))?/);
  assert.doesNotMatch(text, /Paramètres du serveur → Rôles/);
});

test("le diagnostic associe le client courant à son profil réel sans écraser FWU", () => {
  const ids = resolveInstallationBotIds(
    { fwu: "111111111111111111", guard: "222222222222222222" },
    "suckme",
    "333333333333333333",
  );
  assert.deepEqual(ids, {
    fwu: "111111111111111111",
    guard: "222222222222222222",
    suckme: "333333333333333333",
  });
});

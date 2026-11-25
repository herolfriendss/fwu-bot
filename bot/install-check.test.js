import test from "node:test";
import assert from "node:assert/strict";
import { formatInstallationReport, suckMePlacementIssues, REQUIRED_PERMISSIONS } from "./install-check.js";

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

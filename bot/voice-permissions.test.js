import test from "node:test";
import assert from "node:assert/strict";
import { canUseVoiceCommand, voiceCommand } from "./voice-permissions.js";

const MANAGE_CHANNELS = 1n << 4n;
const ADMINISTRATOR = 1n << 3n;

test("voice parser recognizes MENOTTE command family", () => {
  assert.equal(voiceCommand("=menotte @user"), "=menotte");
  assert.equal(voiceCommand("=unmenotte @user"), "=unmenotte");
  assert.equal(voiceCommand("=menotteinfo @user"), "=menotteinfo");
  assert.equal(voiceCommand("=demandevocal #salon"), "=demandevocal");
  assert.equal(voiceCommand("=vocalpresence 2026-11-16T20:00"), "=vocalpresence");
  assert.equal(voiceCommand("=wakeup @member #general"), "=wakeup");
  assert.equal(canUseVoiceCommand("=vocalpresence", 0n, ["sys"], null, false, null, "sys"), false);
  assert.equal(voiceCommand("=not-a-command"), null);
});

test("SYS+ can use all voice access commands without Discord administrator", () => {
  for (const command of ["=panel", "=pv", "=access", "=unaccess"]) {
    assert.equal(canUseVoiceCommand(command, 0n, ["sys"], null, false, null, "sys"), true);
  }
});

test("ADMIN+ can use panel and private toggle but not individual access commands", () => {
  assert.equal(canUseVoiceCommand("=panel", 0n, ["adminplus"], null, false, "adminplus"), true);
  assert.equal(canUseVoiceCommand("=pv", 0n, ["adminplus"], null, false, "adminplus"), true);
  assert.equal(canUseVoiceCommand("=access", 0n, ["adminplus"], null, false, "adminplus"), false);
  assert.equal(canUseVoiceCommand("=unaccess", 0n, ["adminplus"], null, false, "adminplus"), false);
});

test("legacy channel managers retain configured fallback access", () => {
  assert.equal(canUseVoiceCommand("=panel", MANAGE_CHANNELS, [], null), true);
  assert.equal(canUseVoiceCommand("=pv", ADMINISTRATOR, [], null), true);
  assert.equal(canUseVoiceCommand("=pv", 0n, [], null), false);
});

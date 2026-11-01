import { describe, expect, it } from "vitest";
import { resolvePrefixCommand } from "../../bot/prefix-commands.js";
import { sanitizeSettings } from "@/lib/bot-settings";
import { prefixCommandFormSchema } from "@/lib/prefix-commands";

describe("prefix commands", () => {
  it("reserves names handled by built-in voice, DOG, SYS+ and music commands", () => {
    for (const name of ["access", "panel", "pv", "sysp", "dog", "undog", "doginfo", "play", "stop", "queue"]) {
      expect(prefixCommandFormSchema.safeParse({ name, response: "test", permission: "0" }).success).toBe(false);
    }
    expect(prefixCommandFormSchema.safeParse({ name: "regles", response: "test", permission: "0" }).success).toBe(true);
  });
  const command = { name: "reglement", response: "Respectez les membres.", permission: "0" as const };
  it("creates an additional = command and syncs it without losing keywords", () => {
    const settings = sanitizeSettings({ prefixCommands: [command], keywords: [{ trigger: "salut", response: "Bonjour", exact: true }] });
    expect(resolvePrefixCommand(settings.prefixCommands, "=reglement")?.content).toBe("Respectez les membres.");
    expect(settings.keywords[0]?.response).toBe("Bonjour");
  });
  it("uses the edited name and reply, not the old command", () => {
    const edited = prefixCommandFormSchema.parse({ ...command, name: "regles", response: "Nouvelle réponse" });
    expect(resolvePrefixCommand([edited], "=regles")?.content).toBe("Nouvelle réponse");
    expect(resolvePrefixCommand([edited], "=reglement")).toBeNull();
  });
  it("stops responding after deletion", () => {
    expect(resolvePrefixCommand([command].filter((c) => c.name !== "reglement"), "=reglement")).toBeNull();
  });
  it("matches only a command at the start, including arguments", () => {
    expect(resolvePrefixCommand([command], "=REGLEMENT détails")?.content).toBe(command.response);
    expect(resolvePrefixCommand([command], "voir =reglement")).toBeNull();
    expect(resolvePrefixCommand([command], "=reglement-suite")).toBeNull();
  });
  it.each(["32", "8192"])("enforces permission %s", (permission) => {
    expect(resolvePrefixCommand([{ ...command, permission }], "=reglement", "0")?.allowed).toBe(false);
    expect(resolvePrefixCommand([{ ...command, permission }], "=reglement", permission)?.content).toBe(command.response);
    expect(resolvePrefixCommand([{ ...command, permission }], "=reglement", "8")?.allowed).toBe(true);
  });
  it("rejects the former exclamation prefix", () => {
    expect(resolvePrefixCommand([command], "!reglement")).toBeNull();
  });
  it("loads old settings without prefix commands", () => {
    expect(sanitizeSettings({}).prefixCommands).toEqual([]);
  });
  it("preserves a previously stored built-in-name command instead of silently deleting it", () => {
    expect(sanitizeSettings({ prefixCommands: [{ name: "play", response: "ancienne réponse", permission: "0" }] }).prefixCommands)
      .toEqual([{ name: "play", response: "ancienne réponse", permission: "0" }]);
    expect(prefixCommandFormSchema.safeParse({ name: "play", response: "nouvelle réponse", permission: "0" }).success).toBe(false);
  });
});

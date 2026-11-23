import test from "node:test";
import assert from "node:assert/strict";
import { parseWebhookEncryptionKey, encryptWebhookToken, decryptWebhookToken } from "./webhooks-crypto.js";

test("webhook tokens are encrypted and can be decrypted with the same key", () => {
  const key = parseWebhookEncryptionKey("ab".repeat(32));
  const token = "discord-webhook-secret-example";
  const encrypted = encryptWebhookToken(token, key);
  assert.notEqual(encrypted, token);
  assert.equal(decryptWebhookToken(encrypted, key), token);
});

test("webhook token ciphertext is authenticated and rejects tampering", () => {
  const key = parseWebhookEncryptionKey("cd".repeat(32));
  const encrypted = encryptWebhookToken("secret-token", key);
  const [iv, tag, ciphertext] = encrypted.split(".");
  const altered = `${iv}.${tag}.${`${ciphertext.slice(0, -1)}${ciphertext.endsWith("A") ? "B" : "A"}`}`;
  assert.throws(() => decryptWebhookToken(altered, key));
});

test("invalid encryption keys are rejected", () => {
  assert.throws(() => parseWebhookEncryptionKey("short"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseWebhookEncryptionKey, encryptWebhookToken, decryptWebhookToken, encryptWebhookTokenWithHexKey, decryptWebhookTokenWithHexKey } from "./webhooks-crypto.js";

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

test("configured hexadecimal key is used for webhook token storage and retrieval", () => {
  const keyHex = "ef".repeat(32);
  const token = "webhook-token-that-must-remain-secret";
  const encrypted = encryptWebhookTokenWithHexKey(token, keyHex);
  assert.notEqual(encrypted, token);
  assert.equal(decryptWebhookTokenWithHexKey(encrypted, keyHex), token);
  assert.throws(() => encryptWebhookTokenWithHexKey(token, "missing"));
  assert.throws(() => decryptWebhookTokenWithHexKey(encrypted, "missing"));
});

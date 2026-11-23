import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function parseWebhookEncryptionKey(value) {
  if (!/^[a-f0-9]{64}$/i.test(value ?? "")) throw new Error("WEBHOOK_ENCRYPTION_KEY doit contenir 64 caractères hexadécimaux.");
  return Buffer.from(value, "hex");
}

export function encryptWebhookToken(token, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("Clé de chiffrement invalide.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptWebhookToken(payload, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("Clé de chiffrement invalide.");
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("Données webhook invalides.");
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, "base64url"));
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("Données webhook invalides.");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

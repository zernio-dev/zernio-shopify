import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Returns the 32-byte encryption key from the ENCRYPTION_KEY env var.
 * The env var must be a 64-character hex string.
 */
function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be a 64-character hex string (32 bytes)",
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns a base64 string in the format: iv:tag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted}`;
}

/**
 * Decrypt a string previously encrypted with encrypt().
 * Expects the base64 format: iv:tag:ciphertext
 */
export function decrypt(encryptedStr: string): string {
  const key = getKey();
  const parts = encryptedStr.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted string format");
  }

  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const encrypted = parts[2];

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Generate a preview of an API key: first 5 + last 5 chars.
 * e.g. "sk_ab1...z9y8x" for a key like "sk_ab1234567890...xyz9y8x"
 */
export function apiKeyPreview(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 5)}...${key.slice(-5)}`;
}

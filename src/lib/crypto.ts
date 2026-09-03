import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

/**
 * Reads the 32-byte encryption key, accepting hex or base64.
 *
 * Throws rather than falling back to a default: a silently weak key on a
 * store of bank access tokens is worse than a failed request.
 */
export function loadKey(raw = process.env.PLAID_TOKEN_ENCRYPTION_KEY): Buffer {
  if (!raw) {
    throw new Error(
      "PLAID_TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32",
    );
  }

  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");

  if (key.length !== 32) {
    throw new Error(
      `PLAID_TOKEN_ENCRYPTION_KEY must decode to 32 bytes for AES-256-GCM, got ${key.length}.`,
    );
  }
  return key;
}

/**
 * Encrypts a Plaid access token.
 *
 * Output is `v1:<base64(iv || tag || ciphertext)>`. The IV is random per
 * call, so encrypting the same token twice never yields the same string, and
 * the GCM tag makes tampering detectable on read.
 */
export function encryptToken(plaintext: string, key = loadKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

export function decryptToken(payload: string, key = loadKey()): string {
  const [version, encoded] = payload.split(":", 2);
  if (version !== VERSION || !encoded) {
    throw new Error("Unrecognised encrypted token format.");
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("Encrypted token is truncated.");
  }

  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = bytes.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

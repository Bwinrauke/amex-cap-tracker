import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptToken, encryptToken, loadKey } from "./crypto";

const KEY = randomBytes(32);

describe("token encryption", () => {
  it("round-trips a token", () => {
    const token = "access-sandbox-2f8e1c00-0000-4000-8000-abcdefabcdef";
    expect(decryptToken(encryptToken(token, KEY), KEY)).toBe(token);
  });

  it("produces a different ciphertext each time", () => {
    const token = "access-sandbox-token";
    expect(encryptToken(token, KEY)).not.toBe(encryptToken(token, KEY));
  });

  it("rejects a tampered payload", () => {
    const encrypted = encryptToken("access-sandbox-token", KEY);
    const [version, encoded] = encrypted.split(":", 2);
    const bytes = Buffer.from(encoded, "base64");
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = `${version}:${bytes.toString("base64")}`;

    expect(() => decryptToken(tampered, KEY)).toThrow();
  });

  it("rejects the wrong key", () => {
    const encrypted = encryptToken("access-sandbox-token", KEY);
    expect(() => decryptToken(encrypted, randomBytes(32))).toThrow();
  });

  it("rejects an unversioned payload", () => {
    expect(() => decryptToken("not-encrypted", KEY)).toThrow(/format/i);
  });
});

describe("loadKey", () => {
  it("accepts hex and base64", () => {
    expect(loadKey(KEY.toString("hex"))).toEqual(KEY);
    expect(loadKey(KEY.toString("base64"))).toEqual(KEY);
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => loadKey(randomBytes(16).toString("hex"))).toThrow(/32 bytes/);
  });

  it("refuses a missing key rather than defaulting", () => {
    expect(() => loadKey(undefined)).toThrow(/not set/i);
  });
});

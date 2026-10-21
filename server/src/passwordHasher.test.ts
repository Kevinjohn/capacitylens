import { describe, expect, it } from "vitest";
import {
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  MAX_CONCURRENT_SCRYPT,
  MAX_QUEUED_SCRYPT,
  createScryptPasswordHasher,
} from "./passwordHasher";

describe("scrypt password hashing", () => {
  it("pins the production scrypt parameters", () => {
    expect(SCRYPT_N).toBe(2 ** 17);
    expect(SCRYPT_R).toBe(8);
    expect(SCRYPT_P).toBe(1);
    expect(MAX_CONCURRENT_SCRYPT).toBe(2);
    expect(MAX_QUEUED_SCRYPT).toBe(16);
  });

  it("round-trips exact password bytes with a fast test work factor", async () => {
    const hasher = createScryptPasswordHasher(2 ** 10);
    const password = "correct horse battery staple 🦄";
    const hash = await hasher.hash(password);
    expect(hash).toMatch(/^scrypt-v1\$1024\$8\$1\$/);
    await expect(hasher.verify({ hash, password })).resolves.toBe(true);
    await expect(hasher.verify({ hash, password: password.normalize("NFKC") + "x" })).resolves.toBe(false);
    await expect(hasher.verify({ hash: "malformed", password })).resolves.toBe(false);
    await expect(hasher.verify({ hash: "scrypt-v1$1024$8$1$bad$bad", password })).resolves.toBe(false);
  });

  it("treats a stored non-power-of-two work factor as a malformed credential", async () => {
    const hasher = createScryptPasswordHasher(1024);
    const hash = await hasher.hash("correct horse battery staple");
    await expect(hasher.verify({ hash: hash.replace("$1024$", "$1023$"), password: "anything" })).resolves.toBe(false);
  });

  it("surfaces scrypt queue pressure instead of returning a false credential verdict", async () => {
    const hasher = createScryptPasswordHasher(2 ** 10);
    const password = "correct horse battery staple 🦄";
    const versionedHash = await hasher.hash(password);
    const legacyShape = `${"ab".repeat(16)}:${"cd".repeat(64)}`;

    for (const hash of [versionedHash, legacyShape]) {
      const occupying = Array.from({ length: MAX_CONCURRENT_SCRYPT + MAX_QUEUED_SCRYPT }, (_, index) =>
        hasher.hash(`queue-occupant-${index}`),
      );
      try {
        await expect(hasher.verify({ hash, password })).rejects.toThrow(
          "Password processing is temporarily at capacity.",
        );
      } finally {
        await Promise.all(occupying);
      }
    }
  });
});

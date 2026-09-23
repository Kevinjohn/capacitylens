import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MICROSOFT_PROOF_V46_SQL } from "./db/migrations/microsoftProofV46";
import { anonymise } from "../scripts/rehearse/anonymise";

describe("Microsoft proof redaction", () => {
  it("removes proof identities, mailbox targets, callback URLs and hashed tokens from rehearsal copies", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(MICROSOFT_PROOF_V46_SQL);
      db.prepare(
        `INSERT INTO microsoft_identity_proofs
        (id, nonceHash, purpose, targetEmail, tenantId, oid, tokenHash, state,
         expiresAt, sourceIpHash, oauthStateHash, oauthStateHistory, callbackUrl, errorCallbackUrl, createdAt, updatedAt)
        VALUES (?, ?, 'bootstrap', ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "proof-id",
        "browser-hash",
        "bruce@example.test",
        "tenant-id",
        "identity-id",
        "token-hash",
        1_800_000,
        "ip-hash",
        "oauth-hash",
        '["old-oauth-hash"]',
        "https://example.test/private-return",
        "https://example.test/private-error",
        0,
        0,
      );
      anonymise(db);
      expect(db.prepare("SELECT * FROM microsoft_identity_proofs").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally {
      db.close();
    }
  });
});

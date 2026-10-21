import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import {
  approveJoinToken,
  clearFailedJoinDelivery,
  completeJoinIntent,
  insertJoinIntent,
  readJoinIntent,
  reserveJoinDelivery,
} from "./joiningIntents";
import type { JoinIntent } from "./joiningIntents";

const now = Date.parse("2026-09-27T00:00:00.000Z");
const base: JoinIntent = {
  id: "intent-1",
  nonceHash: "nonce-hash-1",
  browserHash: "browser-hash-1",
  purpose: "policy",
  accountId: "a-studio",
  invitationId: null,
  email: "diana@studio.example",
  principalId: null,
  providerId: "password",
  state: "started",
  tokenHash: null,
  deliveryGeneration: 0,
  expiresAt: now + 15 * 60_000,
  sentCount: 0,
  lastSentAt: null,
  sourceIpHash: "ip-hash-1",
  providerStateHash: null,
  createdAt: now,
  updatedAt: now,
};

describe("company join intent transitions", () => {
  it("replaces the mail generation and ignores a delayed failure from the old send", () => {
    const db = openDb(":memory:");
    try {
      insertJoinIntent(db, base);
      const first = reserveJoinDelivery({ db, intent: base, tokenHash: "token-1", now });
      const mailed = readJoinIntent(db, base.nonceHash);
      if (!mailed) throw new Error("Expected a live join intent.");
      expect(first).toBe(1);
      const second = reserveJoinDelivery({ db, intent: mailed, tokenHash: "token-2", now: now + 61_000 });
      clearFailedJoinDelivery({ db, id: base.id, generation: first, tokenHash: "token-1" });
      expect(readJoinIntent(db, base.nonceHash)).toMatchObject({
        state: "mail-sent",
        tokenHash: "token-2",
        deliveryGeneration: second,
        sentCount: 2,
      });
      expect(approveJoinToken({ db, nonceHash: base.nonceHash, tokenHash: "token-1", now: now + 62_000 })).toBeNull();
      const approved = approveJoinToken({ db, nonceHash: base.nonceHash, tokenHash: "token-2", now: now + 62_000 });
      expect(approved?.state).toBe("approved");
      expect(approveJoinToken({ db, nonceHash: base.nonceHash, tokenHash: "token-2", now: now + 62_000 })).toBeNull();
      if (!approved) throw new Error("Expected a verified join intent.");
      completeJoinIntent({ db, intent: approved, principalId: "diana", now: now + 63_000 });
      expect(readJoinIntent(db, base.nonceHash)).toMatchObject({ state: "completed", principalId: "diana" });
    } finally {
      db.close();
    }
  });

  it("counts sends across replacement intents for browser, address and IP", () => {
    const db = openDb(":memory:");
    try {
      insertJoinIntent(db, base);
      reserveJoinDelivery({ db, intent: base, tokenHash: "token-1", now });
      const replacement = { ...base, id: "intent-2", nonceHash: "nonce-hash-2", createdAt: now + 1 };
      insertJoinIntent(db, replacement);
      expect(() => reserveJoinDelivery({ db, intent: replacement, tokenHash: "token-2", now: now + 1 })).toThrow();
      expect(readJoinIntent(db, replacement.nonceHash)).toMatchObject({ state: "started", sentCount: 0 });
    } finally {
      db.close();
    }
  });
});

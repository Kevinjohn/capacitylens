import { describe, expect, it } from "vitest";
import { insertRow, openDb, readFullSlice, replaceAccountSlice, wipe } from "./db";
import { readJoiningPolicy, writeJoiningPolicy } from "./controlTables/joiningPolicies";
import { insertJoinIntent, readJoinIntent } from "./controlTables/joiningIntents";

function fixture() {
  const db = openDb(":memory:");
  insertRow(db, "accounts", {
    id: "a-studio",
    name: "Wayne Enterprises",
    color: "#6366f1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  writeJoiningPolicy(db, "a-studio", {
    policy: "approved_domains",
    approvedDomains: ["wayne.example", "stark.example"],
  });
  insertJoinIntent(db, {
    id: "joining-intent",
    nonceHash: "joining-nonce-hash",
    browserHash: "browser-hash",
    purpose: "policy",
    accountId: "a-studio",
    invitationId: null,
    email: "diana@wayne.example",
    principalId: null,
    providerId: "password",
    state: "approved",
    tokenHash: null,
    deliveryGeneration: 1,
    expiresAt: 2000000000000,
    sentCount: 1,
    lastSentAt: 1900000000000,
    sourceIpHash: "ip-hash",
    providerStateHash: null,
    createdAt: 1900000000000,
    updatedAt: 1900000000000,
  });
  return db;
}

describe("joining control data lifecycle", () => {
  it("preserves policy and a pending verified journey across a scheduling import", () => {
    const db = fixture();
    try {
      const policy = readJoiningPolicy(db, "a-studio");
      const intent = readJoinIntent(db, "joining-nonce-hash");
      const imported = readFullSlice(db, "a-studio");
      imported.clients.push({
        id: "wayne-foundation",
        accountId: "a-studio",
        name: "Wayne Foundation",
        color: "#6366f1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      replaceAccountSlice(db, "a-studio", imported);
      expect(readFullSlice(db, "a-studio").clients[0].name).toBe("Wayne Foundation");
      expect(readJoiningPolicy(db, "a-studio")).toEqual(policy);
      expect(readJoinIntent(db, "joining-nonce-hash")).toEqual(intent);
    } finally {
      db.close();
    }
  });

  it("removes policy and pending proof during a trusted local reset", () => {
    const db = fixture();
    try {
      wipe(db);
      expect(readJoinIntent(db, "joining-nonce-hash")).toBeNull();
      expect(db.prepare("SELECT * FROM account_joining_policies").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

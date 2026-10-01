import { describe, expect, it } from "vitest";
import { openDb } from "../../db";
import * as joiningPolicies from "../../controlTables/joiningPolicies";
import * as joiningIntents from "../../controlTables/joiningIntents";

function intent(accountId: string): joiningIntents.JoinIntent {
  return {
    id: accountId,
    nonceHash: accountId,
    browserHash: accountId,
    purpose: "policy",
    accountId,
    invitationId: null,
    email: "diana@example.com",
    principalId: null,
    providerId: "google",
    state: "started",
    tokenHash: null,
    deliveryGeneration: 0,
    expiresAt: 1000,
    sentCount: 0,
    lastSentAt: null,
    sourceIpHash: "ip",
    providerStateHash: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("company joining control-table isolation", () => {
  it("updates and removes only the named company's policy", () => {
    const db = openDb(":memory:");
    try {
      joiningPolicies.writeJoiningPolicy(db, "a-studio", { policy: "open", approvedDomains: [] });
      joiningPolicies.writeJoiningPolicy(db, "a-loft", {
        policy: "approved_domains",
        approvedDomains: ["stark.example"],
      });
      const foreign = db.prepare("SELECT * FROM account_joining_policies WHERE accountId = ?").get("a-loft");
      joiningPolicies.writeJoiningPolicy(db, "a-studio", { policy: "invitation_only", approvedDomains: [] });
      expect(db.prepare("SELECT * FROM account_joining_policies WHERE accountId = ?").get("a-loft")).toEqual(foreign);
      joiningPolicies.removeJoiningPolicy(db, "a-studio");
      expect(db.prepare("SELECT * FROM account_joining_policies WHERE accountId = ?").get("a-loft")).toEqual(foreign);
      expect(db.prepare("SELECT * FROM account_joining_policies WHERE accountId = ?").get("a-studio")).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("removes only the named company's joining intents", () => {
    const db = openDb(":memory:");
    try {
      joiningIntents.insertJoinIntent(db, intent("a-studio"));
      joiningIntents.insertJoinIntent(db, intent("a-loft"));
      const foreign = joiningIntents.readJoinIntent(db, "a-loft");
      joiningIntents.removeJoinIntentsForAccount(db, "a-studio");
      expect(joiningIntents.readJoinIntent(db, "a-studio")).toBeNull();
      expect(joiningIntents.readJoinIntent(db, "a-loft")).toEqual(foreign);
    } finally {
      db.close();
    }
  });
});

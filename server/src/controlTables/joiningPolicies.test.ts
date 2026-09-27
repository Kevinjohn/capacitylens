import { describe, expect, it } from "vitest";
import { DATABASE_MIGRATION_TABLE, initializeOpenDb, openDb } from "../db";
import { createInvite, getInvite } from "../controlTables";
import { readJoiningPolicy, writeJoiningPolicy } from "./joiningPolicies";

// eslint-disable-next-line max-lines-per-function
describe("company joining policy storage", () => {
  it("upgrades with invitation-only default and revokes unaddressed unused links and proposals", () => {
    const db = openDb(":memory:");
    db.exec(`DROP TABLE company_join_intents;
      DROP TABLE account_joining_policies;
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 49;
      PRAGMA user_version = 48;`);
    for (const [token, email] of [
      ["unaddressed", null],
      ["addressed", "diana@example.org"],
    ] as const) {
      createInvite(db, {
        token,
        id: token,
        accountId: "a-studio",
        role: "viewer",
        preauthEmail: email,
        expiresAt: "2027-01-01T00:00:00.000Z",
        usedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    }
    db.prepare(
      `INSERT INTO invitation_person_proposals (invitationId, accountId, resourceId, createdAt, updatedAt)
      VALUES ('unaddressed', 'a-studio', 'person-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    initializeOpenDb(db, ":memory:");
    expect(readJoiningPolicy(db, "a-studio")).toEqual({ policy: "invitation_only", approvedDomains: [] });
    expect(getInvite(db, "unaddressed")).toBeNull();
    expect(getInvite(db, "addressed")?.preauthEmail).toBe("diana@example.org");
    expect(
      db.prepare("SELECT 1 FROM invitation_person_proposals WHERE invitationId = 'unaddressed'").get(),
    ).toBeUndefined();
    db.close();
  });
  it("defaults existing companies to invitation only and round-trips canonical exact domains", () => {
    const db = openDb(":memory:");
    expect(readJoiningPolicy(db, "a-studio")).toEqual({ policy: "invitation_only", approvedDomains: [] });
    expect(
      writeJoiningPolicy(db, "a-studio", {
        policy: "approved_domains_or_invitation",
        approvedDomains: ["BÜCHER.example", "xn--bcher-kva.example", "studio.example"],
      }),
    ).toEqual({
      policy: "approved_domains_or_invitation",
      approvedDomains: ["studio.example", "xn--bcher-kva.example"],
    });
    expect(readJoiningPolicy(db, "a-studio")).toEqual({
      policy: "approved_domains_or_invitation",
      approvedDomains: ["studio.example", "xn--bcher-kva.example"],
    });
    db.close();
  });

  it("rejects invalid domains without changing existing settings", () => {
    const db = openDb(":memory:");
    writeJoiningPolicy(db, "a-studio", { policy: "open", approvedDomains: [] });
    expect(() =>
      writeJoiningPolicy(db, "a-studio", { policy: "approved_domains", approvedDomains: ["evil.example:443"] }),
    ).toThrow();
    expect(readJoiningPolicy(db, "a-studio")).toEqual({ policy: "open", approvedDomains: [] });
    db.close();
  });
});

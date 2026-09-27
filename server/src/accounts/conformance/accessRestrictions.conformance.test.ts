import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db";
import * as accessRestrictions from "../../controlTables/accessRestrictions";
import * as members from "../../controlTables/members";
import * as ownershipTransfers from "../../controlTables/ownershipTransfers";

const WAYNE = "a-studio";
const STARK = "a-loft";
const PRINCIPAL = "u-bruce-wayne";
const NOW = "2026-09-01T09:00:00.000Z";
let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => {
  db.close();
});

describe("access restriction schema compatibility", () => {
  it("surfaces a missing proof table on an identity-enabled database", () => {
    db.exec("CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL); DROP TABLE identity_email_proofs");
    expect(() => accessRestrictions.provenEmail(db, PRINCIPAL)).toThrow(/identity_email_proofs/);
  });

  it("reads only tables introduced by a populated legacy schema", () => {
    db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL);
      DROP TABLE identity_email_proofs; PRAGMA user_version = 47`);
    accessRestrictions.disableAccess(db, { accountId: WAYNE, principalId: PRINCIPAL, role: "admin" });
    expect(accessRestrictions.provenEmail(db, PRINCIPAL)).toBeNull();
    expect(accessRestrictions.isAccessRestricted(db, WAYNE, PRINCIPAL)).toBe(true);
    db.exec("DROP TABLE account_access_restrictions; PRAGMA user_version = 46");
    expect(accessRestrictions.listAccessRestrictions(db, WAYNE)).toEqual([]);
    expect(accessRestrictions.getAccessRestriction(db, WAYNE, PRINCIPAL)).toBeNull();
    expect(accessRestrictions.isAccessRestricted(db, WAYNE, PRINCIPAL)).toBe(false);
    db.prepare(
      "INSERT INTO account_members (accountId, userId, role, status, createdAt) VALUES (?, ?, 'admin', 'disabled', ?)",
    ).run(WAYNE, PRINCIPAL, NOW);
    expect(members.getActiveMemberRole(db, WAYNE, PRINCIPAL)).toBeNull();
  });

  it("surfaces a missing restriction table on a current database", () => {
    db.exec("DROP TABLE account_access_restrictions");
    expect(() => accessRestrictions.isAccessRestricted(db, WAYNE, PRINCIPAL)).toThrow(/account_access_restrictions/);
  });
});

describe("access restrictions stay inside their company", () => {
  it("scopes restriction writes and transfer invalidation", () => {
    db.exec("CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL)");
    db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(PRINCIPAL, "bruce@example.test");
    db.prepare(
      "INSERT INTO identity_email_proofs (principalId, email, source, provenAt) VALUES (?, ?, 'google', ?)",
    ).run(PRINCIPAL, "bruce@example.test", NOW);
    for (const accountId of [WAYNE, STARK]) {
      members.upsertMember(db, { accountId, userId: PRINCIPAL, role: "admin", status: "active", createdAt: NOW });
      ownershipTransfers.insertRequest(db, {
        id: `ot-${accountId}`,
        accountId,
        initiatorUserId: PRINCIPAL,
        targetUserId: "u-selina-kyle",
        state: "awaiting_target",
        revision: "0",
        createdAt: NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
        targetAcceptedAt: null,
        terminalAt: null,
        terminalReason: null,
      });
    }
    accessRestrictions.disableAccess(db, { accountId: WAYNE, principalId: PRINCIPAL, role: "admin" });
    accessRestrictions.disableAccess(db, { accountId: STARK, principalId: PRINCIPAL, role: "admin" });
    expect(accessRestrictions.getAccessRestriction(db, WAYNE, PRINCIPAL)?.verifiedEmail).toBe("bruce@example.test");
    expect(members.invalidateRestrictedPrincipal(db, WAYNE, PRINCIPAL)).toEqual([`ot-${WAYNE}`]);
    expect(ownershipTransfers.readLiveRequest(db, STARK)?.id).toBe(`ot-${STARK}`);
    accessRestrictions.enableAccess(db, WAYNE, PRINCIPAL);
    expect(accessRestrictions.listAccessRestrictions(db, WAYNE)).toEqual([]);
    expect(accessRestrictions.getAccessRestriction(db, STARK, PRINCIPAL)?.principalId).toBe(PRINCIPAL);
    accessRestrictions.disableAccess(db, { accountId: WAYNE, principalId: PRINCIPAL, role: "admin" });
    accessRestrictions.removeAccessRestrictionsForAccount(db, WAYNE);
    expect(accessRestrictions.getAccessRestriction(db, STARK, PRINCIPAL)?.principalId).toBe(PRINCIPAL);
  });

  it("captures new proof only on the selected company's principal-only restriction", () => {
    db.exec("CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL)");
    db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(PRINCIPAL, "bruce@example.test");
    for (const accountId of [WAYNE, STARK]) {
      accessRestrictions.disableAccess(db, { accountId, principalId: PRINCIPAL, role: "admin" });
    }
    db.prepare(
      "INSERT INTO identity_email_proofs (principalId, email, source, provenAt) VALUES (?, ?, 'google', ?)",
    ).run(PRINCIPAL, "bruce@example.test", NOW);
    accessRestrictions.captureRestrictionEmail(db, WAYNE, PRINCIPAL);
    expect(accessRestrictions.getAccessRestriction(db, WAYNE, PRINCIPAL)?.verifiedEmail).toBe("bruce@example.test");
    expect(accessRestrictions.getAccessRestriction(db, STARK, PRINCIPAL)?.verifiedEmail).toBeNull();
  });
});

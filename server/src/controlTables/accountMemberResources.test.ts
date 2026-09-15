import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db";
import { openDb } from "../db";
import { upsertMember } from "./members";
import {
  clearAccountMemberResourceLink,
  listAccountMemberResourceLinks,
  listResourceAvatarProjection,
  reconcileAccountMemberResources,
  removeAccountMemberResourceForMember,
  removeAccountMemberResourceForResource,
  removeAccountMemberResourcesForAccount,
  setAccountMemberResourceLink,
} from "./accountMemberResources";
import { tx } from "../txn";

const NOW = "2026-09-14T10:00:00.000Z";

// The suite deliberately shares one realistic auth/resource fixture across the storage invariants.
// eslint-disable-next-line max-lines-per-function
describe("account member resource links", () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(":memory:");
    db.prepare(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`).run(
      "a1",
      "Wayne Enterprises",
      "#6366f1",
      NOW,
      NOW,
    );
    db.exec(
      `CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, emailVerified INTEGER, image TEXT, createdAt TEXT, updatedAt TEXT)`,
    );
    for (const [id, kind] of [
      ["r1", "person"],
      ["r2", "person"],
      ["placeholder", "placeholder"],
    ] as const) {
      db.prepare(
        `INSERT INTO resources
           (id, accountId, kind, name, role, color, employmentType, engagement,
            workingHoursPerDay, workingDays, halfDays, createdAt, updatedAt)
         VALUES (?, 'a1', ?, ?, 'Designer', '#6366f1', 'employee', 'studio', 8, '[1,2,3,4,5]', '[]', ?, ?)`,
      ).run(id, kind, id, NOW, NOW);
    }
    for (const userId of ["u1", "u2"]) {
      upsertMember(db, {
        accountId: "a1",
        userId,
        role: userId === "u1" ? "owner" : "admin",
        status: "active",
        createdAt: NOW,
      });
      db.prepare(
        `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt)
         VALUES (?, ?, ?, 1, ?, ?, ?)`,
      ).run(userId, userId, `${userId}@example.test`, `https://images.example/${userId}.png`, NOW, NOW);
    }
  });
  afterEach(() => db.close());

  it("enforces both cardinalities and rejects non-person targets", () => {
    const first = setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: "u1",
      resourceId: "r1",
      expectedRevision: null,
      now: NOW,
    });
    expect(() =>
      setAccountMemberResourceLink({
        db,
        accountId: "a1",
        userId: "u2",
        resourceId: "r1",
        expectedRevision: null,
        now: NOW,
      }),
    ).toThrow(/already linked/);
    expect(() =>
      setAccountMemberResourceLink({
        db,
        accountId: "a1",
        userId: "u1",
        resourceId: "placeholder",
        expectedRevision: first.revision,
        now: NOW,
      }),
    ).toThrow(/no longer available/);
  });

  it("does not misreport storage faults as a cardinality conflict", () => {
    const cause = new Error("disk I/O error");
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql) => {
      if (String(sql).startsWith("INSERT INTO account_member_resources"))
        return {
          run: () => {
            throw cause;
          },
        } as never;
      return prepare(sql);
    });
    expect(() =>
      setAccountMemberResourceLink({
        db,
        accountId: "a1",
        userId: "u1",
        resourceId: "r1",
        expectedRevision: null,
        now: NOW,
      }),
    ).toThrow(cause);
  });

  it("rejects a stale token after unlink and recreate", () => {
    const first = setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: "u1",
      resourceId: "r1",
      expectedRevision: null,
      now: NOW,
    });
    clearAccountMemberResourceLink({ db, accountId: "a1", userId: "u1", expectedRevision: first.revision });
    const recreated = setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: "u1",
      resourceId: "r2",
      expectedRevision: null,
      now: NOW,
    });
    expect(recreated.revision).not.toBe(first.revision);
    expect(() =>
      clearAccountMemberResourceLink({ db, accountId: "a1", userId: "u1", expectedRevision: first.revision }),
    ).toThrow(/changed/);
  });

  it("treats an identical retry as a no-op that preserves its revision", () => {
    const first = setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: "u1",
      resourceId: "r1",
      expectedRevision: null,
      now: NOW,
    });
    const retry = setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: "u1",
      resourceId: "r1",
      expectedRevision: first.revision,
      now: "2026-09-14T11:00:00.000Z",
    });
    expect(retry).toEqual(first);
  });

  it("suppresses inactive and unsafe images without widening identity data", () => {
    setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: "u1",
      resourceId: "r1",
      expectedRevision: null,
      now: NOW,
    });
    expect(listResourceAvatarProjection(db, "a1")).toEqual([
      { resourceId: "r1", imageUrl: "https://images.example/u1.png" },
    ]);
    db.prepare(`UPDATE account_members SET status = 'disabled' WHERE accountId = 'a1' AND userId = 'u1'`).run();
    expect(listResourceAvatarProjection(db, "a1")).toEqual([]);
    db.prepare(`UPDATE account_members SET status = 'active' WHERE accountId = 'a1' AND userId = 'u1'`).run();
    db.prepare(`UPDATE user SET image = 'javascript:alert(1)' WHERE id = 'u1'`).run();
    expect(listResourceAvatarProjection(db, "a1")).toEqual([]);
  });

  it("fails a corrupt dangling association closed instead of treating it as suppression", () => {
    setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: "u1",
      resourceId: "r1",
      expectedRevision: null,
      now: NOW,
    });
    db.prepare(`DELETE FROM user WHERE id = 'u1'`).run();
    expect(() => listResourceAvatarProjection(db, "a1")).toThrow(/Corrupt member\/resource link/);
  });

  it("clears the association when an ordinary resource write changes a person to a non-person", () => {
    setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: "u1",
      resourceId: "r1",
      expectedRevision: null,
      now: NOW,
    });

    db.prepare(`UPDATE resources SET kind = 'placeholder' WHERE accountId = 'a1' AND id = 'r1'`).run();

    expect(listAccountMemberResourceLinks(db, "a1")).toEqual([]);
    expect(listResourceAvatarProjection(db, "a1")).toEqual([]);
  });

  it.each([
    [
      "wrong resource kind",
      `DROP TRIGGER capacitylens_member_resource_kind_cleanup;
       UPDATE resources SET kind = 'placeholder' WHERE id = 'r1'`,
    ],
    ["unknown membership status", `UPDATE account_members SET status = 'unknown' WHERE userId = 'u1'`],
    ["empty revision", `UPDATE account_member_resources SET revision = '' WHERE userId = 'u1'`],
    ["malformed metadata", `UPDATE account_member_resources SET updatedAt = 'yesterday' WHERE userId = 'u1'`],
  ])("fails closed for corrupt projection metadata: %s", (_label, statement) => {
    setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: "u1",
      resourceId: "r1",
      expectedRevision: null,
      now: NOW,
    });
    db.exec(`PRAGMA ignore_check_constraints = ON`);
    db.exec(statement);
    expect(() => listResourceAvatarProjection(db, "a1")).toThrow(/Corrupt member\/resource link/);
  });

  it("reconciles imported non-person targets atomically and restores links on rollback", () => {
    setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: "u1",
      resourceId: "r1",
      expectedRevision: null,
      now: NOW,
    });
    expect(() =>
      tx(db, () => {
        db.prepare(`UPDATE resources SET kind = 'placeholder' WHERE accountId = 'a1' AND id = 'r1'`).run();
        reconcileAccountMemberResources({ db, accountId: "a1" });
        throw new Error("simulated import failure");
      }),
    ).toThrow(/simulated import failure/);
    expect(listAccountMemberResourceLinks(db, "a1")).toHaveLength(1);
    db.prepare(`UPDATE resources SET kind = 'placeholder' WHERE accountId = 'a1' AND id = 'r1'`).run();
    reconcileAccountMemberResources({ db, accountId: "a1" });
    expect(listAccountMemberResourceLinks(db, "a1")).toEqual([]);
  });

  it.each([
    ["member removal", (database: Db) => removeAccountMemberResourceForMember(database, "a1", "u1")],
    ["resource purge", (database: Db) => removeAccountMemberResourceForResource(database, "a1", "r1")],
    ["account erasure", (database: Db) => removeAccountMemberResourcesForAccount(database, "a1")],
  ])("cleans retained links during %s", (_label, cleanup) => {
    setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: "u1",
      resourceId: "r1",
      expectedRevision: null,
      now: NOW,
    });
    cleanup(db);
    expect(listAccountMemberResourceLinks(db, "a1")).toEqual([]);
  });

  it("fails loudly when a current-schema database loses the association table", () => {
    db.exec(`DROP TABLE account_member_resources; PRAGMA user_version = 43;`);
    expect(() => removeAccountMemberResourcesForAccount(db, "a1")).toThrow(/no such table/i);
  });
});

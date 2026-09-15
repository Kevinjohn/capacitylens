import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@capacitylens/shared/account/types";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { createSqliteAccountMemberResourcePort } from "../accounts/sqliteAccountMemberResourcePort";

const NOW = "2026-09-14T10:00:00.000Z";

function actorContext(principalId: string): ActorContext {
  return {
    principalId,
    sessionId: `session-${principalId}`,
    assurance: "mfa",
    fresh: true,
    mfaSatisfied: true,
  };
}

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
    for (const [id, kind, name] of [
      ["r1", "person", "Bruce Wayne"],
      ["r2", "person", "Clark Kent"],
      ["placeholder", "placeholder", "placeholder"],
    ] as const) {
      db.prepare(
        `INSERT INTO resources
           (id, accountId, kind, name, role, color, employmentType, engagement,
            workingHoursPerDay, workingDays, halfDays, createdAt, updatedAt)
         VALUES (?, 'a1', ?, ?, 'Designer', '#6366f1', 'employee', 'studio', 8, '[1,2,3,4,5]', '[]', ?, ?)`,
      ).run(id, kind, name, NOW, NOW);
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

  // eslint-disable-next-line max-lines-per-function
  it("enforces both cardinalities across two SQLite connections", () => {
    const filename = join(tmpdir(), `capacitylens-member-links-${process.pid}-${randomUUID()}.db`);
    const left = openDb(filename);
    const right = openDb(filename);
    try {
      left
        .prepare(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`)
        .run("shared", "Wayne Enterprises", "#6366f1", NOW, NOW);
      for (const [id, name] of [
        ["shared-r1", "Bruce Wayne"],
        ["shared-r2", "Clark Kent"],
      ] as const) {
        left
          .prepare(
            `INSERT INTO resources
             (id, accountId, kind, name, role, color, employmentType, engagement,
              workingHoursPerDay, workingDays, halfDays, createdAt, updatedAt)
             VALUES (?, 'shared', 'person', ?, 'Designer', '#6366f1', 'employee', 'studio', 8,
              '[1,2,3,4,5]', '[]', ?, ?)`,
          )
          .run(id, name, NOW, NOW);
      }
      for (const userId of ["shared-u1", "shared-u2"])
        upsertMember(left, { accountId: "shared", userId, role: "admin", status: "active", createdAt: NOW });

      setAccountMemberResourceLink({
        db: left,
        accountId: "shared",
        userId: "shared-u1",
        resourceId: "shared-r1",
        expectedRevision: null,
        now: NOW,
      });
      expect(() =>
        setAccountMemberResourceLink({
          db: right,
          accountId: "shared",
          userId: "shared-u2",
          resourceId: "shared-r1",
          expectedRevision: null,
          now: NOW,
        }),
      ).toThrow(/already linked/i);

      const second = setAccountMemberResourceLink({
        db: right,
        accountId: "shared",
        userId: "shared-u2",
        resourceId: "shared-r2",
        expectedRevision: null,
        now: NOW,
      });
      expect(() =>
        setAccountMemberResourceLink({
          db: left,
          accountId: "shared",
          userId: "shared-u2",
          resourceId: "shared-r1",
          expectedRevision: null,
          now: NOW,
        }),
      ).toThrow(/changed/i);
      expect(second.resourceId).toBe("shared-r2");
    } finally {
      left.close();
      right.close();
      rmSync(filename, { force: true });
      rmSync(`${filename}-wal`, { force: true });
      rmSync(`${filename}-shm`, { force: true });
    }
  });

  it("rejects new links for inactive members while retaining existing links", () => {
    const first = setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: "u1",
      resourceId: "r1",
      expectedRevision: null,
      now: NOW,
    });
    db.prepare(`UPDATE account_members SET status = 'disabled' WHERE accountId = 'a1' AND userId = 'u1'`).run();
    expect(() =>
      setAccountMemberResourceLink({
        db,
        accountId: "a1",
        userId: "u1",
        resourceId: "r2",
        expectedRevision: first.revision,
        now: NOW,
      }),
    ).toThrow(/active member/i);
    expect(listAccountMemberResourceLinks(db, "a1")).toHaveLength(1);
  });

  it.each(["archivedAt", "deletedAt"])(
    "rejects changing a retained link whose current person is %s but still allows unlink",
    (inactiveColumn) => {
      const first = setAccountMemberResourceLink({
        db,
        accountId: "a1",
        userId: "u1",
        resourceId: "r1",
        expectedRevision: null,
        now: NOW,
      });
      db.prepare(`UPDATE resources SET ${inactiveColumn} = ? WHERE accountId = ? AND id = ?`).run(NOW, "a1", "r1");
      expect(() =>
        setAccountMemberResourceLink({
          db,
          accountId: "a1",
          userId: "u1",
          resourceId: "r2",
          expectedRevision: first.revision,
          now: NOW,
        }),
      ).toThrow(/current scheduled person is no longer available/i);
      expect(listAccountMemberResourceLinks(db, "a1")).toHaveLength(1);
      expect(() =>
        clearAccountMemberResourceLink({ db, accountId: "a1", userId: "u1", expectedRevision: first.revision }),
      ).not.toThrow();
    },
  );

  // eslint-disable-next-line max-lines-per-function
  it("binds authorized link commands, replays idempotently, and audits atomically", async () => {
    const port = createSqliteAccountMemberResourcePort(db, { applicationId: "test-app" });
    const linkCommand = { commandId: "member-link-command-01", idempotencyKey: "member-link-key-01" };
    const first = await port.setLink({
      workspaceId: "a1",
      principalId: "u1",
      resourceId: "r1",
      expectedRevision: null,
      now: NOW,
      actor: actorContext("u1"),
      command: linkCommand,
    });
    const replay = await port.setLink({
      workspaceId: "a1",
      principalId: "u1",
      resourceId: "r1",
      expectedRevision: null,
      now: "2026-09-14T11:00:00.000Z",
      actor: actorContext("u1"),
      command: linkCommand,
    });
    expect(replay).toEqual(first);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM capacitylens_audit_outbox`).get()).toEqual({ count: 1 });
    const auditRow = db.prepare(`SELECT payload FROM capacitylens_audit_outbox`).get() as { payload: string };
    const audit = JSON.parse(auditRow.payload) as { action?: unknown };
    expect(audit.action).toBe("memberResourceLink");
    await expect(
      port.setLink({
        workspaceId: "a1",
        principalId: "u1",
        resourceId: "r2",
        expectedRevision: null,
        now: NOW,
        actor: actorContext("u1"),
        command: linkCommand,
      }),
    ).rejects.toThrow(/already used|different command payload/i);
    await expect(
      port.setLink({
        workspaceId: "a1",
        principalId: "u1",
        resourceId: "r2",
        expectedRevision: first.revision,
        now: NOW,
        actor: actorContext("u3"),
        command: { commandId: "member-link-command-02", idempotencyKey: "member-link-key-02" },
      }),
    ).rejects.toThrow(/not a member/i);

    const noOp = await port.setLink({
      workspaceId: "a1",
      principalId: "u1",
      resourceId: "r1",
      expectedRevision: first.revision,
      now: "2026-09-14T12:00:00.000Z",
      actor: actorContext("u1"),
      command: { commandId: "member-link-command-04", idempotencyKey: "member-link-key-04" },
    });
    expect(noOp).toEqual(first);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM capacitylens_audit_outbox`).get()).toEqual({ count: 1 });
    const changed = await port.setLink({
      workspaceId: "a1",
      principalId: "u1",
      resourceId: "r2",
      expectedRevision: first.revision,
      now: "2026-09-14T13:00:00.000Z",
      actor: actorContext("u1"),
      command: { commandId: "member-link-command-05", idempotencyKey: "member-link-key-05" },
    });
    await port.clearLink({
      workspaceId: "a1",
      principalId: "u1",
      expectedRevision: changed.revision,
      actor: actorContext("u1"),
      command: { commandId: "member-link-command-06", idempotencyKey: "member-link-key-06" },
    });
    const actions = (
      db.prepare(`SELECT payload FROM capacitylens_audit_outbox ORDER BY sequence`).all() as { payload: string }[]
    ).map(({ payload }) => (JSON.parse(payload) as { action?: unknown }).action);
    expect(actions).toEqual(["memberResourceLink", "memberResourceChange", "memberResourceUnlink"]);

    db.exec(
      `CREATE TRIGGER reject_member_resource_audit BEFORE INSERT ON capacitylens_audit_outbox
       BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END`,
    );
    await expect(
      port.setLink({
        workspaceId: "a1",
        principalId: "u2",
        resourceId: "r2",
        expectedRevision: null,
        now: NOW,
        actor: actorContext("u2"),
        command: { commandId: "member-link-command-03", idempotencyKey: "member-link-key-03" },
      }),
    ).rejects.toThrow(/injected audit failure/i);
    expect(listAccountMemberResourceLinks(db, "a1")).toHaveLength(0);
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

  it("keeps V44 proposal cleanup active on a future schema version", () => {
    db.prepare(
      `INSERT INTO invitation_person_proposals (invitationId, accountId, resourceId, createdAt, updatedAt)
       VALUES ('future-invite', 'a1', 'r1', ?, ?)`,
    ).run(NOW, NOW);
    db.prepare(
      `INSERT INTO member_resource_link_exceptions (accountId, userId, proposedResourceId, reason, createdAt, updatedAt)
       VALUES ('a1', 'u1', 'r1', 'resource_unavailable', ?, ?)`,
    ).run(NOW, NOW);
    db.exec(`PRAGMA user_version = 45`);
    removeAccountMemberResourcesForAccount(db, "a1");
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invitation_person_proposals`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM member_resource_link_exceptions`).get()).toEqual({ count: 0 });
  });

  it("does not require V44 state tables during V43 cleanup", () => {
    db.exec(
      `DROP TABLE invitation_person_proposals; DROP TABLE member_resource_link_exceptions; PRAGMA user_version = 43`,
    );
    expect(() => removeAccountMemberResourcesForAccount(db, "a1")).not.toThrow();
  });
});

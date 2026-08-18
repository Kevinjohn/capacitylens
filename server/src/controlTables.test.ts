import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  ensureControlTables,
  assertControlTablesCurrent,
  getMembershipRow,
  upsertMember,
  getMemberRole,
  listMembershipsForUser,
  listMembersForAccount,
  migrateSingleOwnerControlPlaneV10,
  assertSingleOwnerControlPlaneV10,
  migrateOwnerlessControlPlaneV11,
  reportOwnerlessPromotionsV11,
  migrateOwnerResetCeremoniesV12,
  migrateMemberResetCeremoniesV14,
  assertSingleOwnerControlPlaneCurrent,
  removeMember,
  createInvite,
  getInvite,
  newInviteId,
  listInvitesForAccount,
  revokeInvite,
  pruneInvites,
  USED_INVITATION_RETENTION_LIMIT,
  USED_INVITATION_RETENTION_MS,
  markInviteUsed,
  InviteAlreadyUsedError,
  looksLikeEmail,
  inviteTokenHash,
  type AccountMember,
} from "./controlTables";
import { ensureAccountBoundaryState } from "./accounts/state";
import type { Db } from "./db";

// Unit tests for the membership server-CONTROL table (P1.1). A bare in-memory DB + ensureControlTables
// is enough — this table is intentionally decoupled from AppData/openDb, so it needs no schema setup
// beyond its own DDL. (openDb wiring + the AppData-exclusion guarantees are covered in
// app.controlTables.test.ts.)

const TS = "2026-01-01T00:00:00.000Z";

const freshDb = (): Db => {
  const db = new DatabaseSync(":memory:");
  ensureControlTables(db);
  ensureAccountBoundaryState(db);
  return db;
};

const member = (over: Partial<AccountMember> = {}): AccountMember => ({
  accountId: "acc-1",
  userId: "user-1",
  role: "editor",
  status: "active",
  createdAt: TS,
  ...over,
});

describe("ensureControlTables", () => {
  it("is idempotent — running twice does not throw", () => {
    const db = new DatabaseSync(":memory:");
    ensureControlTables(db);
    expect(() => ensureControlTables(db)).not.toThrow();
  });

  it("rejects unexpected control-table columns instead of accepting an unknown durable shape", () => {
    const db = freshDb();
    expect(() => assertControlTablesCurrent(db)).not.toThrow();
    db.exec("ALTER TABLE account_members ADD COLUMN unexpected TEXT");
    expect(() => assertControlTablesCurrent(db)).toThrow(/unexpected account_members\.unexpected/i);
  });

  it("rolls back the entire plaintext-token rebuild when a legacy row cannot migrate", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE invites (
      token TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      role TEXT,
      preauthEmail TEXT,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      createdAt TEXT NOT NULL
    )`);
    db.prepare(`INSERT INTO invites (token, accountId, role, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)`).run(
      "still-secret",
      "a1",
      null,
      "2099-01-01T00:00:00.000Z",
      TS,
    );

    expect(() => ensureControlTables(db as Db)).toThrow();
    expect((db.prepare(`SELECT token FROM invites`).get() as { token: string }).token).toBe("still-secret");
    expect(
      (
        db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='invites_new'`).get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
    const columns = db.prepare(`PRAGMA table_info(invites)`).all() as Array<{ name: string }>;
    expect(columns.some((column) => column.name === "id")).toBe(false);
  });
});

describe("corrupt role handling", () => {
  it.each([
    ["membership reader", (db: Db) => getMembershipRow(db, "acc-corrupt", "user-corrupt"), "membership" as const],
    ["ownerless migration reader", (db: Db) => migrateOwnerlessControlPlaneV11(db), "membership" as const],
    ["invite writer", (db: Db) => createInvite(db, invite({ role: "superuser" as never })), "none" as const],
    ["invite lookup", (db: Db) => getInvite(db, "corrupt-token"), "invite" as const],
    ["invite list", (db: Db) => listInvitesForAccount(db, "acc-corrupt"), "invite" as const],
  ])("fails loudly for a superuser role in the %s", (_name, read, seed) => {
    const db = freshDb();
    if (seed === "membership") {
      db.prepare(`INSERT INTO account_members (accountId, userId, role, status, createdAt) VALUES (?, ?, ?, ?, ?)`).run(
        "acc-corrupt",
        "user-corrupt",
        "superuser",
        "active",
        TS,
      );
    } else if (seed === "invite") {
      db.prepare(
        `INSERT INTO invites (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(inviteTokenHash("corrupt-token"), "corrupt-invite", "acc-corrupt", "superuser", null, TS_FUTURE, null, TS);
    }

    expect(() => read(db)).toThrow(/role|control table corrupted/i);
  });
});

describe("upsertMember + getMemberRole", () => {
  it("inserts a membership and reads its role back", () => {
    const db = freshDb();
    upsertMember(db, member({ role: "admin" }));
    expect(getMemberRole(db, "acc-1", "user-1")).toBe("admin");
  });

  it("returns null for a non-member (no row)", () => {
    const db = freshDb();
    expect(getMemberRole(db, "acc-1", "nobody")).toBeNull();
  });

  it("updates the role of an existing (accountId, userId) instead of duplicating", () => {
    const db = freshDb();
    upsertMember(db, member({ role: "viewer" }));
    upsertMember(db, member({ role: "owner" }));
    expect(getMemberRole(db, "acc-1", "user-1")).toBe("owner");
    // The PK keeps it to a single row — the upsert mutated in place, it did not insert a second.
    expect(listMembershipsForUser(db, "user-1")).toHaveLength(1);
  });

  it("rejects a bad role value (fail loud, do not coerce)", () => {
    const db = freshDb();
    // Force an invalid role past the type system, as a crafted/buggy caller could.
    const bad = { ...member(), role: "superuser" } as unknown as AccountMember;
    expect(() => upsertMember(db, bad)).toThrow(/unknown role/i);
  });
});

describe("listMembershipsForUser", () => {
  it("returns only the requested user's rows", () => {
    const db = freshDb();
    upsertMember(db, member({ accountId: "acc-1", userId: "user-1", role: "owner" }));
    upsertMember(db, member({ accountId: "acc-2", userId: "user-1", role: "viewer" }));
    upsertMember(db, member({ accountId: "acc-1", userId: "user-2", role: "editor" }));

    const rows = listMembershipsForUser(db, "user-1");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === "user-1")).toBe(true);
    expect(new Set(rows.map((r) => r.accountId))).toEqual(new Set(["acc-1", "acc-2"]));
  });

  it("returns an empty array for a user with no memberships", () => {
    const db = freshDb();
    expect(listMembershipsForUser(db, "ghost")).toEqual([]);
  });
});

// ── P1.11 member-management helpers ────────────────────────────────────────────────────────────

describe("listMembersForAccount", () => {
  it("lists only the requested account's members, in a stable createdAt order", () => {
    const db = freshDb();
    upsertMember(
      db,
      member({ accountId: "acc-1", userId: "u-b", role: "editor", createdAt: "2026-01-02T00:00:00.000Z" }),
    );
    upsertMember(
      db,
      member({ accountId: "acc-1", userId: "u-a", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    upsertMember(db, member({ accountId: "acc-2", userId: "u-c", role: "admin" }));

    const rows = listMembersForAccount(db, "acc-1");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.accountId === "acc-1")).toBe(true);
    expect(rows.map((r) => r.userId)).toEqual(["u-a", "u-b"]); // ordered by createdAt then userId
  });

  it("returns an empty array for an account with no members", () => {
    const db = freshDb();
    expect(listMembersForAccount(db, "nobody")).toEqual([]);
  });
});

describe("single-Owner control-plane migration", () => {
  it("detects duplicate active Owners and rejects unused Owner invitations", () => {
    const duplicates = freshDb();
    duplicates.exec(`
      CREATE UNIQUE INDEX idx_account_members_single_active_owner
        ON account_members(accountId)
        WHERE role = 'owner' AND status = 'active' AND userId = 'never';
    `);
    upsertMember(duplicates, member({ userId: "owner-1", role: "owner" }));
    upsertMember(duplicates, member({ userId: "owner-2", role: "owner" }));
    expect(() => assertSingleOwnerControlPlaneV10(duplicates)).toThrow(/has 2 active Owners/);

    const pendingInvite = freshDb();
    migrateSingleOwnerControlPlaneV10(pendingInvite);
    createInvite(pendingInvite, invite({ id: "owner-invite", role: "owner" }));
    expect(() => assertSingleOwnerControlPlaneV10(pendingInvite)).toThrow(/unused Owner invite/);
  });
  it("retains the oldest Owner, demotes co-owners, revokes live Owner invites and prevents recurrence", () => {
    const db = freshDb();
    upsertMember(db, member({ userId: "owner-later", role: "owner", createdAt: "2026-01-02T00:00:00.000Z" }));
    upsertMember(db, member({ userId: "owner-first", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" }));
    createInvite(db, {
      token: "unused-owner-token",
      id: "unused-owner",
      accountId: "acc-1",
      role: "owner",
      preauthEmail: null,
      expiresAt: "2099-01-01T00:00:00.000Z",
      usedAt: null,
      createdAt: TS,
    });
    createInvite(db, {
      token: "used-owner-token",
      id: "used-owner",
      accountId: "acc-1",
      role: "owner",
      preauthEmail: null,
      expiresAt: "2099-01-01T00:00:00.000Z",
      usedAt: TS,
      createdAt: TS,
    });

    migrateSingleOwnerControlPlaneV10(db);
    migrateOwnerlessControlPlaneV11(db);
    expect(getMemberRole(db, "acc-1", "owner-first")).toBe("owner");
    expect(getMemberRole(db, "acc-1", "owner-later")).toBe("admin");
    expect(listInvitesForAccount(db, "acc-1").map((invite) => invite.id)).toEqual(["used-owner"]);
    expect(() => assertSingleOwnerControlPlaneCurrent(db)).not.toThrow();
    expect(() => upsertMember(db, member({ userId: "owner-third", role: "owner" }))).toThrow(/unique/i);
    expect(() => migrateSingleOwnerControlPlaneV10(db)).not.toThrow();
  });

  it("repairs an ownerless member-bearing account by promoting its highest-tier active member", () => {
    const db = freshDb();
    // Create the auth verification table before the first membership write so the per-handle table
    // probe sees the production password-mode shape. The initial upserts find no rows to revoke;
    // the reset ceremonies are inserted afterwards to model links minted before migration.
    db.exec(`CREATE TABLE verification (id TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    upsertMember(db, member({ userId: "member-later", role: "viewer", createdAt: "2026-01-02T00:00:00.000Z" }));
    upsertMember(db, member({ userId: "member-first", role: "admin", createdAt: "2026-01-01T00:00:00.000Z" }));
    db.prepare(`INSERT INTO verification (id, value) VALUES (?, ?)`).run("promoted-reset", "member-first");
    db.prepare(`INSERT INTO verification (id, value) VALUES (?, ?)`).run("other-reset", "member-later");

    migrateSingleOwnerControlPlaneV10(db);
    migrateOwnerlessControlPlaneV11(db);

    expect(getMemberRole(db, "acc-1", "member-first")).toBe("owner");
    expect(getMemberRole(db, "acc-1", "member-later")).toBe("viewer");
    expect(db.prepare(`SELECT id FROM verification ORDER BY id`).all()).toEqual([
      { id: "other-reset" },
      { id: "promoted-reset" },
    ]);

    migrateOwnerResetCeremoniesV12(db);
    expect(db.prepare(`SELECT id FROM verification ORDER BY id`).all()).toEqual([{ id: "other-reset" }]);
    expect(() => assertSingleOwnerControlPlaneCurrent(db)).not.toThrow();
    expect(() => migrateOwnerlessControlPlaneV11(db)).not.toThrow();
  });

  it("promotes the highest-tier member (admin) over an OLDER viewer, via the non-elevated warn path", () => {
    // The security fix: an older viewer must NOT be silently escalated to Owner when a more-privileged
    // member exists. The (younger) admin is promoted; the older viewer is left untouched.
    const db = freshDb();
    upsertMember(db, member({ userId: "old-viewer", role: "viewer", createdAt: "2026-01-01T00:00:00.000Z" }));
    upsertMember(db, member({ userId: "new-admin", role: "admin", createdAt: "2026-01-03T00:00:00.000Z" }));
    migrateSingleOwnerControlPlaneV10(db); // installs the single-owner index the final assertion requires

    // Snapshot the recorded lines BEFORE mockRestore (which clears mock.calls) so the assertions
    // below still see them.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { warnLines, errorLines } = (() => {
      try {
        reportOwnerlessPromotionsV11(migrateOwnerlessControlPlaneV11(db));
        return {
          warnLines: warnSpy.mock.calls.map((c) => String(c[0])),
          errorLines: errorSpy.mock.calls.map((c) => String(c[0])),
        };
      } finally {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    })();

    expect(getMemberRole(db, "acc-1", "new-admin")).toBe("owner");
    expect(getMemberRole(db, "acc-1", "old-viewer")).toBe("viewer");
    expect(() => assertSingleOwnerControlPlaneCurrent(db)).not.toThrow();
    // An admin promotion is the normal (not below-admin) path: one console.warn, no console.error.
    expect(warnLines).toHaveLength(1);
    expect(errorLines).toHaveLength(0);
    expect(warnLines[0]).toContain("acc-1");
    expect(warnLines[0]).toContain("new-admin");
  });

  it("promotes an editor when the account has no admin (editor over viewers)", () => {
    const db = freshDb();
    upsertMember(db, member({ userId: "a-viewer", role: "viewer", createdAt: "2026-01-01T00:00:00.000Z" }));
    upsertMember(db, member({ userId: "b-editor", role: "editor", createdAt: "2026-01-02T00:00:00.000Z" }));
    upsertMember(db, member({ userId: "c-viewer", role: "viewer", createdAt: "2026-01-03T00:00:00.000Z" }));
    migrateSingleOwnerControlPlaneV10(db); // installs the single-owner index the final assertion requires

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const errorLines = (() => {
      try {
        reportOwnerlessPromotionsV11(migrateOwnerlessControlPlaneV11(db));
        return errorSpy.mock.calls.map((c) => String(c[0])); // snapshot BEFORE mockRestore clears it
      } finally {
        errorSpy.mockRestore();
      }
    })();

    expect(getMemberRole(db, "acc-1", "b-editor")).toBe("owner");
    expect(getMemberRole(db, "acc-1", "a-viewer")).toBe("viewer");
    expect(getMemberRole(db, "acc-1", "c-viewer")).toBe("viewer");
    expect(() => assertSingleOwnerControlPlaneCurrent(db)).not.toThrow();
    // An editor is below admin — the elevated path fires exactly once, naming account + member + role.
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]).toContain("acc-1");
    expect(errorLines[0]).toContain("b-editor");
    expect(errorLines[0]).toContain("editor");
  });

  it("an all-viewers account still gets exactly one Owner (documented fallback) and warns LOUDLY", () => {
    // Nobody outranks a viewer here, so the exactly-one-Owner invariant forces a viewer promotion
    // rather than bricking startup. That last-resort escalation MUST be loud (below-admin → error).
    const db = freshDb();
    upsertMember(db, member({ userId: "v-late", role: "viewer", createdAt: "2026-01-02T00:00:00.000Z" }));
    upsertMember(db, member({ userId: "v-early", role: "viewer", createdAt: "2026-01-01T00:00:00.000Z" }));
    migrateSingleOwnerControlPlaneV10(db); // installs the single-owner index the final assertion requires

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const errorLines = (() => {
      try {
        reportOwnerlessPromotionsV11(migrateOwnerlessControlPlaneV11(db));
        return errorSpy.mock.calls.map((c) => String(c[0])); // snapshot BEFORE mockRestore clears it
      } finally {
        errorSpy.mockRestore();
      }
    })();

    // Tie-break by earliest membership: the earlier viewer is promoted; exactly one Owner results.
    expect(getMemberRole(db, "acc-1", "v-early")).toBe("owner");
    expect(getMemberRole(db, "acc-1", "v-late")).toBe("viewer");
    expect(() => assertSingleOwnerControlPlaneCurrent(db)).not.toThrow();
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]).toContain("acc-1");
    expect(errorLines[0]).toContain("v-early");
    expect(errorLines[0]).toContain("viewer");
  });

  it("breaks a same-tier tie by earliest membership (createdAt, then userId)", () => {
    const db = freshDb();
    upsertMember(db, member({ userId: "admin-b", role: "admin", createdAt: "2026-01-02T00:00:00.000Z" }));
    upsertMember(db, member({ userId: "admin-a", role: "admin", createdAt: "2026-01-01T00:00:00.000Z" }));
    // Same createdAt as admin-a — the userId ascending tie-break decides ('admin-a' < 'admin-c').
    upsertMember(db, member({ userId: "admin-c", role: "admin", createdAt: "2026-01-01T00:00:00.000Z" }));
    migrateSingleOwnerControlPlaneV10(db); // installs the single-owner index the final assertion requires

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      migrateOwnerlessControlPlaneV11(db);
    } finally {
      warnSpy.mockRestore();
    }

    expect(getMemberRole(db, "acc-1", "admin-a")).toBe("owner");
    expect(getMemberRole(db, "acc-1", "admin-b")).toBe("admin");
    expect(getMemberRole(db, "acc-1", "admin-c")).toBe("admin");
    expect(() => assertSingleOwnerControlPlaneCurrent(db)).not.toThrow();
  });

  it("v14 revokes ceremonies for EVERY active member — the demoted non-owners v12 (owners-only) left outstanding", () => {
    const db = freshDb();
    db.exec(`CREATE TABLE verification (id TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    upsertMember(db, member({ userId: "kept-owner", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" }));
    upsertMember(db, member({ userId: "demoted-admin", role: "admin", createdAt: "2026-01-02T00:00:00.000Z" }));
    // A non-active membership, inserted raw (MembershipStatus is 'active'-only today): v14 mirrors
    // v12's status filter, so this identity's ceremony must survive.
    db.prepare(`INSERT INTO account_members (accountId, userId, role, status, createdAt) VALUES (?, ?, ?, ?, ?)`).run(
      "acc-1",
      "inactive-member",
      "editor",
      "suspended",
      TS,
    );
    // Links minted BEFORE the repair (inserted after the upserts, so upsertMember's own
    // privilege-change revocation cannot be what removes them).
    db.prepare(`INSERT INTO verification (id, value) VALUES (?, ?)`).run("owner-reset", "kept-owner");
    db.prepare(`INSERT INTO verification (id, value) VALUES (?, ?)`).run("demoted-reset", "demoted-admin");
    db.prepare(`INSERT INTO verification (id, value) VALUES (?, ?)`).run("inactive-reset", "inactive-member");

    migrateOwnerResetCeremoniesV12(db);
    // THE GAP v14 closes: v12's owners-only scope leaves the demoted (now-admin) identity's link live.
    expect(db.prepare(`SELECT id FROM verification ORDER BY id`).all()).toEqual([
      { id: "demoted-reset" },
      { id: "inactive-reset" },
    ]);

    migrateMemberResetCeremoniesV14(db);
    expect(db.prepare(`SELECT id FROM verification ORDER BY id`).all()).toEqual([{ id: "inactive-reset" }]);
    // Membership rows are untouched — v14 only burns ceremonies, it never rewrites roles or statuses.
    expect(getMemberRole(db, "acc-1", "kept-owner")).toBe("owner");
    expect(getMemberRole(db, "acc-1", "demoted-admin")).toBe("admin");
  });

  it("starts revoking ceremonies when Better Auth creates its table after an earlier absent probe", () => {
    const db = freshDb();
    // Existing auth-off databases run application migrations before Better Auth creates its own
    // tables. Exercise that exact same-handle ordering: both the membership write and v12 see no
    // verification table, then password auth creates it later in the process.
    upsertMember(db, member({ userId: "owner-later-auth", role: "owner" }));
    migrateOwnerResetCeremoniesV12(db);
    db.exec(`CREATE TABLE verification (id TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.prepare(`INSERT INTO verification (id, value) VALUES (?, ?)`).run("live-reset", "owner-later-auth");

    upsertMember(db, member({ userId: "owner-later-auth", role: "owner" }));

    expect(db.prepare(`SELECT id FROM verification`).all()).toEqual([]);
  });

  it("rejects a member-bearing account with no active Owner after migration", () => {
    const db = freshDb();
    migrateSingleOwnerControlPlaneV10(db);
    upsertMember(db, member({ userId: "orphaned-admin", role: "admin" }));

    expect(() => assertSingleOwnerControlPlaneCurrent(db)).toThrow(/has 0 active Owners/);
  });

  it("rejects a same-named partial unique index over the wrong column or predicate", () => {
    const db = freshDb();
    db.exec(`
      CREATE UNIQUE INDEX idx_account_members_single_active_owner
        ON account_members(userId)
        WHERE status = 'active';
    `);

    expect(() => assertSingleOwnerControlPlaneCurrent(db)).toThrow(/invalid definition/);
  });
});

describe("removeMember", () => {
  it("removes the named membership and is idempotent (a missing row is a no-op)", () => {
    const db = freshDb();
    upsertMember(db, member({ accountId: "acc-1", userId: "u-1", role: "editor" }));
    removeMember(db, "acc-1", "u-1");
    expect(getMemberRole(db, "acc-1", "u-1")).toBeNull();
    expect(() => removeMember(db, "acc-1", "u-1")).not.toThrow(); // idempotent
  });

  it("only deletes the row of the named account (cross-tenant safe)", () => {
    const db = freshDb();
    upsertMember(db, member({ accountId: "acc-1", userId: "u-1", role: "editor" }));
    upsertMember(db, member({ accountId: "acc-2", userId: "u-1", role: "admin" }));
    removeMember(db, "acc-1", "u-1");
    expect(getMemberRole(db, "acc-1", "u-1")).toBeNull();
    expect(getMemberRole(db, "acc-2", "u-1")).toBe("admin"); // the other account's row survives
  });
});

const TS_FUTURE = "2999-01-01T00:00:00.000Z";

const invite = (over: Partial<Parameters<typeof createInvite>[1]> = {}) => ({
  token: `tok-${over.id ?? "1"}`,
  id: "inv-1",
  accountId: "acc-1",
  role: "editor" as const,
  preauthEmail: null,
  expiresAt: TS_FUTURE,
  usedAt: null,
  createdAt: TS,
  ...over,
});

describe("createInvite / getInvite — non-secret id (P1.11)", () => {
  it("round-trips the id through getInvite", () => {
    const db = freshDb();
    const id = newInviteId();
    expect(id.length).toBeGreaterThan(0);
    createInvite(db, invite({ token: "tok-a", id }));
    expect(getInvite(db, "tok-a")!.id).toBe(id);
  });

  it("newInviteId mints distinct ids", () => {
    expect(newInviteId()).not.toBe(newInviteId());
  });
});

describe("invite validation and single-use consumption", () => {
  it("enforces the shared email-length ceiling", () => {
    expect(looksLikeEmail("person@example.com")).toBe(true);
    expect(looksLikeEmail(`${"a".repeat(250)}@x.io`)).toBe(false);
  });

  it("throws a typed conflict when the conditional consume loses the race", () => {
    const db = freshDb();
    createInvite(db, invite({ token: "race-token", id: "race-invite" }));
    markInviteUsed(db, "race-token", TS);
    expect(() => markInviteUsed(db, "race-token", TS)).toThrow(InviteAlreadyUsedError);
  });
});

describe("listInvitesForAccount", () => {
  it("lists an account's invites WITHOUT the token, newest first", () => {
    const db = freshDb();
    createInvite(db, invite({ token: "tok-1", id: "inv-1", createdAt: "2026-01-01T00:00:00.000Z" }));
    createInvite(db, invite({ token: "tok-2", id: "inv-2", createdAt: "2026-01-02T00:00:00.000Z" }));
    createInvite(db, invite({ token: "tok-3", id: "inv-3", accountId: "acc-2" })); // other account

    const list = listInvitesForAccount(db, "acc-1");
    expect(list.map((i) => i.id)).toEqual(["inv-2", "inv-1"]); // newest first
    // No token field on ANY row (it's a write-once secret — never on a read path).
    expect(list.every((i) => !("token" in i))).toBe(true);
    expect(JSON.stringify(list)).not.toContain("tok-");
  });

  it("orders offset timestamps by instant with an id tie-break", () => {
    const db = freshDb();
    createInvite(db, invite({ token: "tok-later", id: "inv-b", createdAt: "2026-07-31T21:00:00-04:00" }));
    createInvite(db, invite({ token: "tok-earlier", id: "inv-c", createdAt: "2026-08-01T00:30:00Z" }));
    createInvite(db, invite({ token: "tok-tied", id: "inv-a", createdAt: "2026-08-01T01:00:00Z" }));

    expect(listInvitesForAccount(db, "acc-1").map((invitation) => invitation.id)).toEqual(["inv-a", "inv-b", "inv-c"]);
  });

  it("returns an empty array for an account with no invites", () => {
    expect(listInvitesForAccount(freshDb(), "none")).toEqual([]);
  });

  it('lists USED invites too — the members UI shows a consumed invite with a "used" badge', () => {
    const db = freshDb();
    createInvite(db, invite({ token: "tok-used", id: "inv-used", usedAt: TS }));
    createInvite(db, invite({ token: "tok-open", id: "inv-open" })); // still unused
    const list = listInvitesForAccount(db, "acc-1");
    expect(list.map((i) => i.id).sort()).toEqual(["inv-open", "inv-used"]);
    expect(list.find((i) => i.id === "inv-used")!.usedAt).toBe(TS);
  });
});

describe("pruneInvites", () => {
  const TS_EXPIRED = "2000-01-01T00:00:00.000Z";

  it("deletes expired-unused links while retaining recent used history and live invites", () => {
    const db = freshDb();
    createInvite(db, invite({ token: "tok-live", id: "inv-live" })); // unused, future expiry
    createInvite(db, invite({ token: "tok-used", id: "inv-used", usedAt: TS, expiresAt: TS_EXPIRED })); // used + expired
    createInvite(db, invite({ token: "tok-dead", id: "inv-dead", expiresAt: TS_EXPIRED })); // unused + expired → dead link

    expect(pruneInvites(db)).toBe(1); // only the dead unused link is removed
    expect(getInvite(db, "tok-dead")).toBeNull();
    // A recent USED invite survives even when its bearer expiry is past.
    expect(getInvite(db, "tok-used")).not.toBeNull();
    expect(getInvite(db, "tok-live")).not.toBeNull();
  });

  it("evaluates offset and malformed expiry values by instant and fails closed", () => {
    const db = freshDb();
    createInvite(
      db,
      invite({
        token: "tok-offset-expired",
        id: "inv-offset-expired",
        expiresAt: "2026-08-01T01:00:00+01:00",
      }),
    );
    createInvite(
      db,
      invite({
        token: "tok-offset-live",
        id: "inv-offset-live",
        expiresAt: "2026-07-31T21:00:00-04:00",
      }),
    );
    createInvite(db, invite({ token: "tok-malformed", id: "inv-malformed", expiresAt: "not-a-date" }));

    expect(pruneInvites(db, Date.parse("2026-08-01T00:30:00.000Z"))).toBe(2);
    expect(getInvite(db, "tok-offset-expired")).toBeNull();
    expect(getInvite(db, "tok-malformed")).toBeNull();
    expect(getInvite(db, "tok-offset-live")).not.toBeNull();
  });

  it("enforces age and per-account count bounds with deterministic ties and tenant isolation", () => {
    const db = freshDb();
    const now = Date.parse("2027-01-01T00:00:00.000Z");
    const recent = "2026-12-01T00:00:00.000Z";
    for (const accountId of ["acc-1", "acc-2"]) {
      const count = accountId === "acc-1" ? USED_INVITATION_RETENTION_LIMIT + 3 : USED_INVITATION_RETENTION_LIMIT + 1;
      for (let index = 0; index < count; index += 1) {
        const suffix = String(index).padStart(3, "0");
        createInvite(
          db,
          invite({
            token: `${accountId}-token-${suffix}`,
            id: `${accountId}-invite-${suffix}`,
            accountId,
            usedAt: recent,
          }),
        );
      }
    }
    createInvite(db, invite({ token: "old-token", id: "old", usedAt: "2025-12-31T23:59:59.999Z" }));
    createInvite(
      db,
      invite({
        token: "boundary-token",
        id: "boundary",
        accountId: "acc-3",
        usedAt: new Date(now - USED_INVITATION_RETENTION_MS).toISOString(),
      }),
    );
    createInvite(db, invite({ token: "malformed-token", id: "malformed", accountId: "acc-3", usedAt: "invalid" }));
    createInvite(db, invite({ token: "live-token", id: "live", accountId: "acc-3" }));

    expect(pruneInvites(db, now, "acc-1")).toBe(4);
    expect(
      listInvitesForAccount(db, "acc-1")
        .map(({ id }) => id)
        .sort(),
    ).toEqual(
      Array.from(
        { length: USED_INVITATION_RETENTION_LIMIT },
        (_, index) => `acc-1-invite-${String(index).padStart(3, "0")}`,
      ),
    );
    expect(listInvitesForAccount(db, "acc-2")).toHaveLength(USED_INVITATION_RETENTION_LIMIT + 1);

    expect(pruneInvites(db, now)).toBe(2);
    expect(listInvitesForAccount(db, "acc-2")).toHaveLength(USED_INVITATION_RETENTION_LIMIT);
    expect(
      listInvitesForAccount(db, "acc-3")
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["boundary", "live"]);
  });
});

describe("revokeInvite", () => {
  it("deletes the invite by id (scoped to its account) and is idempotent", () => {
    const db = freshDb();
    createInvite(db, invite({ token: "tok-1", id: "inv-1" }));
    revokeInvite(db, "acc-1", "inv-1");
    expect(getInvite(db, "tok-1")).toBeNull();
    expect(() => revokeInvite(db, "acc-1", "inv-1")).not.toThrow(); // idempotent
  });

  it("cross-tenant revoke is a NO-OP — an admin of one account can't revoke another's invite", () => {
    const db = freshDb();
    createInvite(db, invite({ token: "tok-1", id: "inv-1", accountId: "acc-1" }));
    revokeInvite(db, "acc-2", "inv-1"); // wrong account predicate → no row matches
    expect(getInvite(db, "tok-1")).not.toBeNull(); // survives
  });
});

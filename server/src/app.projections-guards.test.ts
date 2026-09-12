import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { openDb } from "./db";
import { TS, freshApp, dbTrackingFullTableSelects, account, client } from "./fixtures/appTestEntities";
import { call, post, put, batch } from "./fixtures/appTestHttp";
import { readBatchReceipt, readValidatedState } from "./fixtures/appTestSnapshotBatch";
import { scaffold } from "./fixtures/appTestScaffold";

function createAcceptedAndChangedBatchOperationsTest() {
  it("distinguishes accepted batch operations from state-changing operations", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));

    const result = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "changed-client",
        row: client("changed-client", "a1"),
      },
      {
        method: "DELETE",
        table: "phases",
        id: "missing-phase",
        accountId: "a1",
      },
      {
        method: "DELETE",
        table: "allocations",
        id: "missing-allocation",
        accountId: "a1",
      },
    ]);

    expect(result.statusCode).toBe(200);
    expect(readBatchReceipt(result)).toMatchObject({ ok: true, applied: 3, changed: 1 });
    expect(readBatchReceipt(result).revisions).toHaveLength(1);
  });
}

function createSameBatchRearchiveTest() {
  it("excludes a same-batch re-archive of an already-archived row from changed", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });

    const result = await batch(app, [
      { method: "ARCHIVE", table: "clients", id: "c1", accountId: "a1" },
      { method: "ARCHIVE", table: "clients", id: "c1", accountId: "a1" },
    ]);

    expect(result.statusCode).toBe(200);
    // The first op archives the row; the second sees it already archived (mid-transaction) and its
    // audit record is nulled out — `changed` must reflect only the first.
    expect(result.json()).toMatchObject({ ok: true, applied: 2, changed: 1 });
  });
}

function createScopedProjectionMaterializationTest() {
  it("does not materialize unrelated tables for empty/single-account batches or import", async () => {
    const { db, raw, fullTableSelects } = dbTrackingFullTableSelects();
    const app = createApp(db, {
      multiAccount: true,
      optimisticConcurrency: false,
    });
    await post(app, "accounts", account("a1"));
    await post(app, "accounts", account("a2"));
    await post(app, "clients", client("unrelated-client", "a2"));
    fullTableSelects.length = 0;

    const emptyResult = await batch(app, []);
    const emptyBatchReads = fullTableSelects.splice(0).length;
    const batchResult = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "a1-client",
        row: client("a1-client", "a1"),
      },
    ]);
    const singleAccountBatchReads = fullTableSelects.splice(0).length;
    const importResult = await call(app, {
      method: "POST",
      url: "/api/import",
      payload: {
        accountId: "a1",
        data: {
          schemaVersion: 3,
          data: {
            accounts: [],
            disciplines: [],
            resources: [],
            clients: [client("import-client", "source-account")],
            projects: [],
            phases: [],
            activities: [],
            allocations: [],
            timeOff: [],
          },
        },
      },
    });
    const importReads = fullTableSelects.splice(0).length;

    expect([emptyResult.statusCode, batchResult.statusCode, importResult.statusCode]).toEqual([200, 200, 200]);
    expect({ emptyBatchReads, singleAccountBatchReads, importReads }).toEqual({
      emptyBatchReads: 0,
      singleAccountBatchReads: 0,
      importReads: 0,
    });
    await app.close();
    raw.close();
  });
}

describe("tenant-scoped mutation projections", () => {
  createAcceptedAndChangedBatchOperationsTest();
  createSameBatchRearchiveTest();
  createScopedProjectionMaterializationTest();
});

function createOversizedPayloadGuardTest() {
  it("rejects an oversized payload with 413", async () => {
    const { app } = freshApp();
    const huge = '{"id":"' + "a".repeat(6 * 1024 * 1024) + '"}';
    const res = await call(app, {
      method: "POST",
      url: "/api/accounts",
      headers: { "content-type": "application/json" },
      payload: huge,
    });
    expect(res.statusCode).toBe(413);
  });
}

describe("guards", () => {
  createOversizedPayloadGuardTest();
  it("reset is 403 unless allowed, then wipes + re-seeds", async () => {
    const locked = createApp(openDb(":memory:"), { allowReset: false });
    expect(
      (
        await call(locked, {
          method: "POST",
          url: "/api/test/reset",
          payload: {},
        })
      ).statusCode,
    ).toBe(403);

    const { app } = freshApp(true);
    await scaffold(app);
    await call(app, {
      method: "POST",
      url: "/api/test/reset",
      payload: { seed: true },
    });
    const s = await readValidatedState(app);
    expect(s.accounts.length).toBeGreaterThan(0); // seeded demo data present
  });

  it("reset removes memberships and invitations for wiped companies", async () => {
    const { app, db } = freshApp(true);
    db.prepare(
      `INSERT INTO account_members (accountId, userId, role, status, createdAt)
      VALUES (?, ?, ?, ?, ?)`,
    ).run("old-account", "old-user", "owner", "active", TS);
    db.prepare(
      `INSERT INTO invites
      (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("old-token-hash", "old-invite", "old-account", "viewer", null, TS, null, TS);

    expect((await call(app, { method: "POST", url: "/api/test/reset" })).statusCode).toBe(200);

    expect(db.prepare(`SELECT COUNT(*) AS count FROM account_members`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invites`).get()).toEqual({
      count: 0,
    });
  });

  it("rolls the wipe back when re-seeding fails", async () => {
    const { app, db } = freshApp(true);
    await scaffold(app);
    const accountsBefore = db.prepare(`SELECT id FROM accounts ORDER BY id`).all();
    db.exec(`
      CREATE TRIGGER reject_seeded_accounts
      BEFORE INSERT ON accounts
      BEGIN
        SELECT RAISE(ABORT, 'forced seed failure');
      END
    `);

    const response = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      payload: { seed: true },
    });

    expect(response.statusCode).toBe(500);
    expect(db.prepare(`SELECT id FROM accounts ORDER BY id`).all()).toEqual(accountsBefore);
  });
});

import { describe, it, expect } from "vitest";
import { MAX_BATCH_OPS } from "./app";
import { upsertRow } from "./db";
import { tx } from "./txn";
import { MAX_BATCH_HANDLER_BUDGET_MS, meta, freshApp, account, client } from "./fixtures/appTestEntities";
import { call, readErrorResponse, body, post, batch } from "./fixtures/appTestHttp";
import { readValidatedState } from "./fixtures/appTestSnapshotBatch";

describe("batch op-count cap (MAX_BATCH_OPS)", () => {
  it(`rejects a batch of more than ${MAX_BATCH_OPS} ops with 400 before anything is written`, async () => {
    const { app } = freshApp();
    // Op count (not just body bytes) bounds parsing, authorization, scoped projection updates and
    // writes — the cap must fire BEFORE the pre-scan/tx, leaving the DB untouched.
    const ops = Array.from({ length: MAX_BATCH_OPS + 1 }, (_, i) => ({
      method: "PUT",
      table: "accounts",
      id: `flood-${i}`,
      row: account(`flood-${i}`),
    }));
    const res = await batch(app, ops);
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toContain(String(MAX_BATCH_OPS));
    expect((await readValidatedState(app)).accounts).toHaveLength(0); // nothing written
  });

  it(`allows a batch of exactly ${MAX_BATCH_OPS} ops (boundary, inclusive)`, async () => {
    const { app, db } = freshApp();
    await post(app, "accounts", account("a1"));
    // Exercise the expensive shape the cap is intended to contain: real updates against a
    // pre-populated table, not missing-row DELETE padding. Batch validation and projection updates
    // use indexes, so this remains proportional to the operation count plus one account-slice read.
    tx(db, () => {
      for (let index = 0; index < MAX_BATCH_OPS; index += 1) {
        upsertRow(db, "clients", client(`client-${index}`, "a1"));
      }
    });
    const ops = Array.from({ length: MAX_BATCH_OPS }, (_, index) => ({
      method: "PUT",
      table: "clients",
      id: `client-${index}`,
      row: { ...client(`client-${index}`, "a1"), name: `Updated ${index}` },
    }));
    const startedAt = performance.now();
    const res = await batch(app, ops);
    const handlerMs = performance.now() - startedAt;
    expect(res.statusCode).toBe(200);
    expect(handlerMs).toBeLessThan(MAX_BATCH_HANDLER_BUDGET_MS);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM clients WHERE name LIKE 'Updated %'`).get() as { n: number }).n).toBe(
      MAX_BATCH_OPS,
    );
  });
});

describe("null-id rejection (POST/batch without id → 400)", () => {
  it("POST without an id is rejected with 400", async () => {
    const { app } = freshApp();
    const res = await post(app, "accounts", {
      name: "No Id",
      color: "#3b82f6",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/id/);
    // nothing persisted
    expect((await readValidatedState(app)).accounts).toHaveLength(0);
  });

  it("POST with id: null is rejected with 400", async () => {
    const { app } = freshApp();
    const res = await post(app, "accounts", {
      id: null,
      name: "Null Id",
      color: "#3b82f6",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/id/);
  });

  it("POST with empty-string id is rejected with 400", async () => {
    const { app } = freshApp();
    const res = await post(app, "accounts", {
      id: "",
      name: "Empty Id",
      color: "#3b82f6",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/id/);
  });

  it("batch PUT op with a missing/non-string id is rejected with 400", async () => {
    const { app } = freshApp();
    // A batch op whose id field is not a string — the batch handler rejects it before
    // it can reach sanitizeWrite (typeof id !== 'string' check).
    const res = await call(app, {
      method: "POST",
      url: "/api/batch",
      payload: body({
        ops: [
          {
            method: "PUT",
            table: "accounts",
            row: { name: "No Id", color: "#3b82f6", ...meta() },
          },
        ],
      }),
    });
    expect(res.statusCode).toBe(400);
    expect((await readValidatedState(app)).accounts).toHaveLength(0);
  });
});

describe("absent/null request body on generic writes → 400, not 500", () => {
  // POST /api/:entity used to dereference the body (body.accountId! for a scoped table,
  // sanitizeWrite's assertIdPresent for accounts) BEFORE any 400 classification could run, so a
  // missing/null body crashed as an unclassified TypeError → statusFor → 500. /api/batch and
  // /api/import already guard `!body` this way; the generic routes now match.
  it("POST /api/resources with no body/Content-Type is 400, not 500", async () => {
    const { app } = freshApp();
    const res = await call(app, { method: "POST", url: "/api/resources" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  it("POST /api/resources with a literal JSON null body is 400, not 500", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/resources",
      payload: "null",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  it("POST /api/accounts with no body/Content-Type is 400, not 500", async () => {
    // Regression for the accounts branch specifically: it skips the scoped-table authorize
    // dereference and instead crashed inside sanitizeWrite's assertIdPresent (row.id on null/undefined).
    const { app } = freshApp();
    const res = await call(app, { method: "POST", url: "/api/accounts" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  it("POST /api/accounts with a literal JSON null body is 400, not 500", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/accounts",
      payload: "null",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  // The sibling handler: PATCH /api/:entity/:id ran entirely inside a try/catch, but a null body
  // still surfaced as 500 — accountFieldsFrozen's `field in incoming` throws on null, and the
  // caught TypeError isn't a ValidationError/constraint-failed, so statusFor mapped it to 500.
  it("PATCH /api/accounts/:id with a literal JSON null body is 400, not 500", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await call(app, {
      method: "PATCH",
      url: "/api/accounts/a1",
      payload: "null",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  it("PATCH /api/accounts/:id with no body/Content-Type is 400, not 500", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await call(app, { method: "PATCH", url: "/api/accounts/a1" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });
});

// Seed the fixture account + dependency chain, then write each entity via POST and
// GET it back via /api/state. Deep-equal catches any column that is present in the
// spec but not round-tripping correctly (NULL/optional handling, JSON encode/decode).

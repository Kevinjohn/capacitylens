import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { openDb, readState } from "./db";
import { insertRequest, upsertMember } from "./controlTables";

// P1.1 EXCLUSION proof: the `account_members` server-control table must be UNREACHABLE through the
// generic entity machinery and ABSENT from the state read. openDb creates it on every open, so even
// with a row present it must not leak through /api/:entity, GET /api/state (the state read/export
// source; there is no separate /api/state/export route today — loadState IS the export source), or
// loadState itself.

describe("account_members is excluded from the AppData path", () => {
  it("is not a known entity for generic CRUD (GET + POST → 4xx, not 200)", async () => {
    const app = createApp(openDb(":memory:"));

    // No GET /api/:entity route exists at all → Fastify 404 (never a 200 listing the table).
    const get = await app.inject({ method: "GET", url: "/api/account_members" });
    expect(get.statusCode).toBe(404);

    // POST /api/:entity gates on isKnownTable → 404 "Unknown entity", the SAME refusal any unknown
    // table gets — never a 200/201 that would persist a row through the entity path.
    const post = await app.inject({
      method: "POST",
      url: "/api/account_members",
      payload: { accountId: "a", userId: "u", role: "admin", status: "active", createdAt: "x" },
    });
    expect(post.statusCode).toBe(404);
  });

  it("never appears in GET /api/state or loadState, even with a member row present", async () => {
    const db = openDb(":memory:");
    const app = createApp(db);

    // Insert a real membership row directly through the control-table helper (the only path that
    // touches it). It must STILL not surface in the AppData read/export.
    upsertMember(db, {
      accountId: "acc-1",
      userId: "user-1",
      role: "owner",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    // The wire shape: GET /api/state backs the client hydrate and is the export source.
    const res = await app.inject({ method: "GET", url: "/api/state" });
    expect(res.statusCode).toBe(200);
    const state = res.json() as Record<string, unknown>;
    expect(state).not.toHaveProperty("account_members");
    // Belt-and-braces: no value anywhere in the serialised state mentions the table or the row.
    expect(JSON.stringify(state)).not.toContain("account_members");
    expect(JSON.stringify(state)).not.toContain("user-1");

    // And loadState (the function GET /api/state and export both call) has no such key either.
    expect(readState(db) as unknown as Record<string, unknown>).not.toHaveProperty("account_members");
  });
});

// The same EXCLUSION proof for `account_ownership_transfers` (#780). A row names the two principals
// of a pending ownership handover, so reaching it through the generic entity machinery would
// publish who is being handed the company to anyone who can read the ordinary state.
describe("account_ownership_transfers is excluded from the AppData path", () => {
  it("is not a known entity for generic CRUD (GET + POST → 4xx, not 200)", async () => {
    const app = createApp(openDb(":memory:"));

    const get = await app.inject({ method: "GET", url: "/api/account_ownership_transfers" });
    expect(get.statusCode).toBe(404);

    const post = await app.inject({
      method: "POST",
      url: "/api/account_ownership_transfers",
      payload: {
        id: "ot-1",
        accountId: "acc-1",
        initiatorUserId: "u-bruce-wayne",
        targetUserId: "u-selina-kyle",
        state: "awaiting_target",
        revision: "0",
        createdAt: "2026-09-01T09:00:00.000Z",
        expiresAt: "2026-09-08T09:00:00.000Z",
      },
    });
    expect(post.statusCode).toBe(404);
  });

  it("never appears in GET /api/state or loadState, even with a live request present", async () => {
    const db = openDb(":memory:");
    const app = createApp(db);

    insertRequest(db, {
      id: "ot-1",
      accountId: "acc-1",
      initiatorUserId: "u-bruce-wayne",
      targetUserId: "u-selina-kyle",
      state: "awaiting_target",
      revision: "0",
      createdAt: "2026-09-01T09:00:00.000Z",
      expiresAt: "2026-09-08T09:00:00.000Z",
      targetAcceptedAt: null,
      terminalAt: null,
      terminalReason: null,
    });

    const res = await app.inject({ method: "GET", url: "/api/state" });
    expect(res.statusCode).toBe(200);
    const state = res.json() as Record<string, unknown>;
    expect(state).not.toHaveProperty("account_ownership_transfers");
    // Belt-and-braces: neither the table name nor either named principal appears on the wire.
    const serialised = JSON.stringify(state);
    expect(serialised).not.toContain("account_ownership_transfers");
    expect(serialised).not.toContain("u-bruce-wayne");
    expect(serialised).not.toContain("u-selina-kyle");

    expect(readState(db) as unknown as Record<string, unknown>).not.toHaveProperty("account_ownership_transfers");
  });
});

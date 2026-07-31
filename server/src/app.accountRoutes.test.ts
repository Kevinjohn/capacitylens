import { describe, it, expect } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "./app";
import { openDb } from "./db";
import { call } from "./testHelpers";

// ROUTING-BOUNDARY contract for the dedicated `accounts` write routes (routes/accountEntityRoutes.ts).
//
// The account rules used to live as ~25 hand-replicated `entity === "accounts"` branches inside the
// generic /api/:entity handlers. They now live once each behind STATIC /api/accounts… paths, which
// Fastify matches ahead of the parametric routes. The BEHAVIOUR of each rule is already pinned by
// app.test.ts (frozen fields, provisioning, cap), app.authz.test.ts (the write/delete gates),
// app.singleCompanyCap.test.ts and app.erasure.test.ts — all of which drive these same URLs and must
// keep passing unchanged. What is NOT covered elsewhere, and is new with this extraction, is the
// route-precedence wiring itself: adding a static `/api/accounts/:id` node must neither swallow the
// deeper parametric routes nor let an account write fall back into scoped-entity semantics.

const TS = "2026-01-01T00:00:00.000Z";

function freshApp(): FastifyInstance {
  return buildApp(openDb(":memory:"), { optimisticConcurrency: false });
}

/** Trusted-local (OFF mode) create through the dedicated POST /api/accounts route. */
async function createAccount(app: FastifyInstance, id: string): Promise<void> {
  const res = await call(app, {
    method: "POST",
    url: "/api/accounts",
    payload: { id, name: `Studio ${id}`, color: "#3b82f6", createdAt: TS, updatedAt: TS } as InjectOptions["payload"],
  });
  expect(res.statusCode).toBe(201);
}

describe("dedicated /api/accounts routes — route precedence", () => {
  it("does not shadow the parametric lifecycle routes: POST /api/accounts/:id/archive stays a 404", async () => {
    // `accounts` is not a lifecycle entity (no archivedAt/deletedAt tombstones), so the lifecycle
    // handler must still MATCH and answer its own 404. If the new static /api/accounts/:id node
    // prevented find-my-way from backtracking to /api/:entity/:id/archive, this would become a bare
    // 404 with no body — a silent routing regression rather than the handler's own refusal.
    const app = freshApp();
    await createAccount(app, "a1");
    const res = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/archive",
      payload: { accountId: "a1" } as InjectOptions["payload"],
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Unknown entity: accounts");
  });

  it("does not shadow the account administration routes registered under the same prefix", async () => {
    // GET /api/accounts/:id/members lives in accounts/accountRoutes.ts. It shares the static
    // `accounts` node with the new PUT/PATCH/DELETE /api/accounts/:id handlers and must stay reachable.
    const app = freshApp();
    await createAccount(app, "a1");
    const res = await call(app, { method: "GET", url: "/api/accounts/a1/members" });
    expect(res.statusCode).toBe(200);
  });

  it("keeps GET /api/accounts (the picker summary read) answering ahead of any parametric route", async () => {
    const app = freshApp();
    await createAccount(app, "a1");
    expect((await call(app, { method: "GET", url: "/api/accounts" })).json()).toEqual([
      { id: "a1", name: "Studio a1", role: "owner" },
    ]);
  });
});

describe("dedicated /api/accounts routes — no scoped-entity fallback", () => {
  it("DELETE /api/accounts/:id needs no ?accountId= (the scoped-delete assertion never applies)", async () => {
    // A scoped DELETE without ?accountId= is a 400 ("accountId is required to delete a scoped
    // record."). An account is top-level and carries no accountId, so it must delete by id alone —
    // this is exactly the rule that a missing special case would silently invert.
    const app = freshApp();
    await createAccount(app, "a1");
    const res = await call(app, { method: "DELETE", url: "/api/accounts/a1" });
    expect(res.statusCode).toBe(204);
    expect((await call(app, { method: "GET", url: "/api/accounts" })).json()).toEqual([]);

    // Contrast: the generic scoped route still demands the owning account.
    const scoped = await call(app, { method: "DELETE", url: "/api/disciplines/d1" });
    expect(scoped.statusCode).toBe(400);
    expect(scoped.json().error).toBe("accountId is required to delete a scoped record.");
  });

  it("PATCH /api/accounts/:id enforces the frozen-field guard on the dedicated route", async () => {
    // The frozen-field (P1.14) refusal is now defined once and reached from PUT, PATCH and the batch
    // loop. Re-assert it at the PATCH vector: it was the branch most easily lost in the extraction,
    // since PATCH is the only verb whose scoped path conceals refusals as a 404.
    const app = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/accounts",
      payload: {
        id: "a1",
        name: "Studio",
        color: "#3b82f6",
        weekStartsOn: 1,
        timezone: "Etc/GMT",
        language: "en",
        createdAt: TS,
        updatedAt: TS,
      } as InjectOptions["payload"],
    });
    expect(res.statusCode).toBe(201);

    const frozen = await call(app, {
      method: "PATCH",
      url: "/api/accounts/a1",
      payload: { weekStartsOn: 0 } as InjectOptions["payload"],
    });
    expect(frozen.statusCode).toBe(409);
    expect(frozen.json().error).toContain("cannot be changed");

    // A non-frozen field on the same route still applies.
    const renamed = await call(app, {
      method: "PATCH",
      url: "/api/accounts/a1",
      payload: { name: "Renamed" } as InjectOptions["payload"],
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe("Renamed");
  });

  it("PATCH /api/accounts/:id 404s an absent company rather than creating one", async () => {
    const app = freshApp();
    const res = await call(app, {
      method: "PATCH",
      url: "/api/accounts/missing",
      payload: { name: "Ghost" } as InjectOptions["payload"],
    });
    expect(res.statusCode).toBe(404);
    expect((await call(app, { method: "GET", url: "/api/accounts" })).json()).toEqual([]);
  });
});

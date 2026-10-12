import { describe, it, expect } from "vitest";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { createApp } from "./app";
import { DB_SCHEMA_VERSION, openDb } from "./db";
import type { Db } from "./db";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { signUp } from "./testHelpers/passwordAuth";

// Hosted mode must reject unauthenticated application routes before tenant data is serialized.
// Health and authentication routes remain publicly reachable; off mode remains trusted-local.

const TS = "2026-01-01T00:00:00.000Z";
const client = { id: "c1", accountId: "a1", name: "Ferris", color: "#3b82f6", createdAt: TS, updatedAt: TS };

const readResponse = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> => app.inject(opts);

const PASSWORD_ENV = {
  CAPACITYLENS_MODE: "password-only",
  CAPACITYLENS_SECRET: "unit-test-secret-0123456789abcdef-0123",
  CAPACITYLENS_PUBLIC_URL: "http://localhost:8787",
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
};

/**
 * Build an auth-on (password) app over a fresh in-memory DB. `allowReset: true` is deliberate: it
 * lets the matrix prove requireUser 401s `POST /api/test/reset` before the allowReset check runs, so
 * an unauthenticated reset can never wipe data in the hosted posture.
 */
async function createAuthenticatedApp(): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(":memory:");
  const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
  if (!configured.auth) {
    throw new Error("Password authentication was not configured");
  }
  await runAuthMigrations(configured.auth);
  return {
    app: createApp(db, { authMode: configured.mode, auth: configured.auth, allowReset: true }),
    db,
  };
}

function createTrustedLocalApp(): FastifyInstance {
  return createApp(openDb(":memory:"), { allowReset: true });
}

// Application routes must require a session in hosted mode, including test-only reset routes.
const BLOCKED_ROUTES: ReadonlyArray<{ name: string; opts: InjectOptions }> = [
  { name: "GET /api/accounts", opts: { method: "GET", url: "/api/accounts" } },
  { name: "GET /api/state?accountId=", opts: { method: "GET", url: "/api/state?accountId=a1" } },
  { name: "GET /api/state (no-arg)", opts: { method: "GET", url: "/api/state" } },
  { name: "GET /api/meta", opts: { method: "GET", url: "/api/meta" } },
  { name: "GET /api/diagnostics", opts: { method: "GET", url: "/api/diagnostics" } },
  { name: "POST /api/:entity", opts: { method: "POST", url: "/api/clients", payload: client } },
  { name: "PUT /api/:entity/:id", opts: { method: "PUT", url: "/api/clients/c1", payload: client } },
  { name: "PATCH /api/:entity/:id", opts: { method: "PATCH", url: "/api/clients/c1", payload: { name: "X" } } },
  { name: "DELETE /api/:entity/:id", opts: { method: "DELETE", url: "/api/clients/c1?accountId=a1" } },
  {
    name: "POST /api/batch",
    opts: {
      method: "POST",
      url: "/api/batch",
      payload: { ops: [{ method: "PUT", table: "clients", id: "c1", row: client }] },
    },
  },
  {
    name: "POST /api/import",
    opts: { method: "POST", url: "/api/import", payload: { accountId: "a1", data: { clients: [client] } } },
  },
  { name: "POST /api/orgs", opts: { method: "POST", url: "/api/orgs", payload: { name: "New Org" } } },
  {
    name: "POST /api/invites",
    opts: { method: "POST", url: "/api/invites", payload: { accountId: "a1", email: "x@y.test", role: "editor" } },
  },
  { name: "POST /api/invites/:token/accept", opts: { method: "POST", url: "/api/invites/tok/accept", payload: {} } },
  { name: "GET /api/accounts/:id/members", opts: { method: "GET", url: "/api/accounts/a1/members" } },
  {
    name: "PATCH /api/accounts/:id/members/:userId",
    opts: { method: "PATCH", url: "/api/accounts/a1/members/u1", payload: { role: "editor" } },
  },
  { name: "DELETE /api/accounts/:id/members/:userId", opts: { method: "DELETE", url: "/api/accounts/a1/members/u1" } },
  { name: "GET /api/accounts/:id/invites", opts: { method: "GET", url: "/api/accounts/a1/invites" } },
  { name: "DELETE /api/accounts/:id/invites/:id", opts: { method: "DELETE", url: "/api/accounts/a1/invites/i1" } },
  // allowReset is true on this app, so a 401 here proves requireUser fires before the allowReset
  // check: an unauthenticated reset can't wipe data in the hosted posture.
  { name: "POST /api/test/reset", opts: { method: "POST", url: "/api/test/reset", payload: { seed: true } } },
];

describe("P1.17 retire the open shared dataset — hosted (auth-on) posture serves ZERO unauthenticated /api access", () => {
  it.each(BLOCKED_ROUTES)("$name → 401 with the no-data error (no session)", async ({ opts }) => {
    const { app } = await createAuthenticatedApp();
    const res = await readResponse(app, opts);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Sign in to continue." });
  });

  it("serves the fixed diagnostics projection to an authenticated principal", async () => {
    const { app } = await createAuthenticatedApp();
    const principal = await signUp(app, "diagnostics@capacitylens.dev");
    const res = await readResponse(app, {
      method: "GET",
      url: "/api/diagnostics",
      headers: { cookie: principal.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      server: {
        connectivity: "ok",
        database: { status: "ok", schemaVersion: DB_SCHEMA_VERSION },
        persistence: "unknown",
        backup: { status: "unavailable", lastSuccessAt: null },
      },
    });
  });

  it("refuses installation-wide reset to a signed-in non-member and preserves tenant data", async () => {
    const { app, db } = await createAuthenticatedApp();
    db.prepare(
      `
      INSERT INTO accounts (id, name, color, createdAt, updatedAt)
      VALUES ('a1', 'Protected tenant', '#3b82f6', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `,
    ).run();
    const principal = await signUp(app, "reset-non-member@capacitylens.dev");

    const res = await readResponse(app, {
      method: "POST",
      url: "/api/test/reset",
      payload: { seed: false },
      headers: { cookie: principal.cookie },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Reset is disabled." });
    expect(db.prepare(`SELECT id FROM accounts`).all()).toEqual([{ id: "a1" }]);
  });

  it("GET /api/health → 200 (exempt: the uptime monitor has no session)", async () => {
    const { app } = await createAuthenticatedApp();
    const res = await readResponse(app, { method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /api/auth/me is handled by the auth layer, NOT requireUser-blocked (401 carries authMode)", async () => {
    // /api/auth/* is exempt from requireUser; the auth layer answers it. A no-session /api/auth/me
    // is reachable and 401s with the login-screen shape `{ authMode, error }`, the `authMode` key
    // (absent from requireUser's 401) is the tell that the auth layer, not requireUser, answered.
    const { app } = await createAuthenticatedApp();
    const res = await readResponse(app, { method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ authMode: string; error: string }>().authMode).toBe("password-only");
    expect(res.json<{ authMode: string; error: string }>().error).toBe("Sign in to continue.");
  });
});

describe("P1.17 — OFF stays the trusted-local self-hoster default (auth-off-by-default invariant intact)", () => {
  // Off mode is trusted-local and attaches the demo principal to unauthenticated application requests.
  it("representative unauthenticated reads are NOT 401 in OFF (DEMO_USER, open dataset served)", async () => {
    const app = createTrustedLocalApp();
    expect((await readResponse(app, { method: "GET", url: "/api/accounts" })).statusCode).not.toBe(401);
    expect((await readResponse(app, { method: "GET", url: "/api/state?accountId=a1" })).statusCode).not.toBe(401);
    expect((await readResponse(app, { method: "GET", url: "/api/state" })).statusCode).toBe(200);
  });
});

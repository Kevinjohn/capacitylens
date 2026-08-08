import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp as buildAppRaw } from "./app";
import { openDb as openDbRaw, insertAll, loadState, type Db } from "./db";
import {
  createInvite,
  getInvite,
  getMemberRole,
  upsertMember,
  normalizeEmail,
  preauthInviteAllows,
} from "./controlTables";
import { authFromEnv, runAuthMigrations, DEMO_USER } from "./auth";
import { PASSWORD_ENV, call, cookiesOf, signUp, registerServerFixtureCleanup } from "./testHelpers";
import { recordSessionAssurance } from "./accounts/state";
import { applicationSessionHandle } from "./accounts/sessionHandle";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";

// P1.9 — single-use, expiring invite links. POST /api/invites mints a token (gated 'manageInvites',
// admin+ of the target account); POST /api/invites/:token/accept binds the invited role to the
// signed-in caller's membership and consumes the token (single-use, expiry-checked). This suite
// drives sign-up -> create -> accept and asserts: the create gate (owner/admin 201, editor/viewer/
// non-member 403, session-less 401, bad/empty role 400); accept binds the membership + stamps usedAt;
// reuse 409; expired 410; unknown 404; OFF mode; and the AppData-EXCLUSION guarantee.

const TS = "2026-01-01T00:00:00.000Z";
const fixtures = registerServerFixtureCleanup();
const openDb = (...args: Parameters<typeof openDbRaw>) => fixtures.trackDb(openDbRaw(...args));
const buildApp = (...args: Parameters<typeof buildAppRaw>) => fixtures.trackApp(buildAppRaw(...args));
const meta = () => ({ createdAt: TS, updatedAt: TS });
const validFractionalExpiry = (() => {
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  expiry.setUTCMilliseconds(100);
  const canonical = expiry.toISOString();
  return { input: canonical.replace(".100Z", ".1Z"), canonical };
})();

const account = (id: string) => ({
  id,
  name: `Studio ${id}`,
  color: "#3b82f6",
  ...meta(),
});

/** Seed one pre-existing account directly. */
function seedOne(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>;
  d.accounts = [account("a1")];
  insertAll(db, d as unknown as AppData);
}

/** Build an auth-on (password) app over a fresh in-memory DB. */
async function appWithAuth(): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(":memory:");
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV);
  await runAuthMigrations(auth!);
  return { app: buildApp(db, { authMode: mode, auth }), db };
}

/**
 * Flip a Better Auth user's `emailVerified` flag directly in the DB (the `user` table; column is an
 * INTEGER 0/1). A fresh email+password sign-up is unverified (P1.7a), so this is how the P1.10 tests
 * obtain a VERIFIED principal: the NEXT getSession reads the live user row (Better Auth joins it
 * fresh), so normalizeSessionUser then reports emailVerified=true.
 */
function verifyUserEmail(db: Db, email: string): void {
  db.prepare(`UPDATE user SET emailVerified = 1 WHERE email = ?`).run(email);
}

const createInviteReq = (
  app: FastifyInstance,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
) => call(app, { method: "POST", url: "/api/invites", payload, headers });

const acceptReq = (app: FastifyInstance, token: string, headers: Record<string, string> = {}) =>
  call(app, { method: "POST", url: `/api/invites/${token}/accept`, headers });

const previewReq = (app: FastifyInstance, token: string, headers: Record<string, string> = {}) =>
  call(app, { method: "GET", url: `/api/invites/${token}/preview`, headers });

describe("POST /api/invites (P1.9 create) — gate", () => {
  it("owner of the account creates an invite -> 201, with a token + a getInvite row", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    const res = await createInviteReq(app, { accountId: "a1", role: "editor" }, { cookie });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      id: string;
      token: string;
      accountId: string;
      role: string;
      expiresAt: string;
    };
    expect(body.accountId).toBe("a1");
    expect(body.role).toBe("editor");
    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(0);
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    const atRest = db.prepare(`SELECT tokenHash FROM invites`).get() as {
      tokenHash: string;
    };
    expect(atRest.tokenHash).not.toBe(body.token);
    expect(JSON.stringify(db.prepare(`SELECT * FROM invites`).all())).not.toContain(body.token);
    // The row landed in the control table, unused, with a FUTURE expiry.
    const stored = getInvite(db, body.token)!;
    expect(stored.accountId).toBe("a1");
    expect(stored.role).toBe("editor");
    expect(stored.usedAt).toBeNull();
    expect(stored.preauthEmail).toBeNull(); // P1.9 always null
    expect(Date.parse(stored.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("replays the same default-expiry invitation command without minting a second bearer", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "invite-replay-owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const headers = {
      cookie,
      "idempotency-key": "invite-replay-idempotency-01",
      "x-account-command-id": "invite-replay-command-000001",
    };

    const first = await createInviteReq(app, { accountId: "a1", role: "editor" }, headers);
    const replay = await createInviteReq(app, { accountId: "a1", role: "editor" }, headers);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invites`).get()).toEqual({
      count: 1,
    });
  });

  it("rejects a command replay whose payload differs from the original", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "invite-conflict-owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const headers = {
      cookie,
      "idempotency-key": "invite-conflict-idempotency-01",
      "x-account-command-id": "invite-conflict-command-000001",
    };

    expect((await createInviteReq(app, { accountId: "a1", role: "editor" }, headers)).statusCode).toBe(201);
    const conflict = await createInviteReq(app, { accountId: "a1", role: "viewer" }, headers);

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      retryable: false,
    });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invites`).get()).toEqual({
      count: 1,
    });
  });

  it("rejects malformed account-command headers before creating an invitation", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "invite-header-owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    const headerCases: Array<Record<string, string>> = [
      {
        cookie,
        "idempotency-key": "short",
        "x-account-command-id": "valid-command-id-000001",
      },
      {
        cookie,
        "idempotency-key": "valid-idempotency-key-0001",
        "x-account-command-id": "bad id",
      },
      {
        cookie,
        "idempotency-key": "valid-idempotency-key-0001",
      },
      {
        cookie,
        "x-account-command-id": "valid-command-id-000001",
      },
    ];
    for (const headers of headerCases) {
      const response = await createInviteReq(app, { accountId: "a1", role: "editor" }, headers);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: "VALIDATION_FAILED",
        retryable: false,
      });
    }
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invites`).get()).toEqual({
      count: 0,
    });
  });

  it("replays a completed explicit-expiry command after the invitation expires", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "explicit-expiry-replay-owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const headers = {
      cookie,
      "idempotency-key": "invite-expiry-replay-idempotency-01",
      "x-account-command-id": "invite-expiry-replay-command-000001",
    };
    const input = {
      accountId: "a1",
      role: "editor",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    const first = await createInviteReq(app, input, headers);
    // Expiry is durable row state. Move the created invitation past its boundary directly rather
    // than freezing process timers, which would also freeze Fastify/auth request scheduling.
    db.prepare(`UPDATE invites SET expiresAt = ?`).run(new Date(Date.now() - 1).toISOString());
    const replay = await createInviteReq(app, input, headers);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invites`).get()).toEqual({
      count: 1,
    });
  });

  it.each([
    ["malformed", "not-a-date", /valid ISO-8601/],
    ["past", "2000-01-01T00:00:00.000Z", /future/],
    ["too distant", "2999-01-01T00:00:00.000Z", /at most 30 days/],
  ])("rejects a %s expiresAt instead of widening it", async (_label, expiresAt, message) => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const res = await createInviteReq(app, { accountId: "a1", role: "editor", expiresAt }, { cookie });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(message);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM invites`).get()).toEqual({
      n: 0,
    });
  });

  it.each([
    ["non-leap February 29", "2099-02-29T12:00:00Z"],
    ["April 31", "2099-04-31T12:00:00.123Z"],
    ["hour 24", "2099-02-02T24:00:00Z"],
  ])("rejects a valid-shaped but nonexistent %s expiry", async (_label, expiresAt) => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "invalid-calendar-expiry@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    const res = await createInviteReq(app, { accountId: "a1", role: "editor", expiresAt }, { cookie });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/valid ISO-8601/);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM invites`).get()).toEqual({
      n: 0,
    });
  });

  it.each([["fractional instant", validFractionalExpiry.input, validFractionalExpiry.canonical]])(
    "accepts and canonicalizes a valid %s expiry",
    async (_label, expiresAt, canonical) => {
      const { app, db } = await appWithAuth();
      seedOne(db);
      const { cookie, userId } = await signUp(app, "valid-calendar-expiry@capacitylens.dev");
      upsertMember(db, {
        accountId: "a1",
        userId,
        role: "owner",
        status: "active",
        createdAt: TS,
      });

      const res = await createInviteReq(app, { accountId: "a1", role: "editor", expiresAt }, { cookie });

      expect(res.statusCode).toBe(201);
      expect(res.json().expiresAt).toBe(canonical);
    },
  );

  it("admin of the account is ALLOWED (admin tier = manageInvites) -> 201", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "admin@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });

    const res = await createInviteReq(app, { accountId: "a1", role: "viewer" }, { cookie });
    expect(res.statusCode).toBe(201);
  });

  it("editor/viewer of the account are DENIED (below admin tier) -> 403", async () => {
    for (const role of ["editor", "viewer"] as const) {
      const { app, db } = await appWithAuth();
      seedOne(db);
      const { cookie, userId } = await signUp(app, `${role}@capacitylens.dev`);
      upsertMember(db, {
        accountId: "a1",
        userId,
        role,
        status: "active",
        createdAt: TS,
      });

      const res = await createInviteReq(app, { accountId: "a1", role: "editor" }, { cookie });
      expect(res.statusCode, `${role} denied`).toBe(403);
    }
  });

  it("a non-member (cross-tenant stranger) is DENIED -> 403", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie } = await signUp(app, "stranger@capacitylens.dev"); // no membership of a1

    const res = await createInviteReq(app, { accountId: "a1", role: "editor" }, { cookie });
    expect(res.statusCode).toBe(403);
  });

  it("a session-less request is 401 (requireUser is upstream of the invite gate)", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const res = await createInviteReq(app, { accountId: "a1", role: "editor" });
    expect(res.statusCode).toBe(401);
  });

  it("a bad or empty role is 400 (before the gate matters for shape)", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "badrole@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    const bad = await createInviteReq(app, { accountId: "a1", role: "superuser" }, { cookie });
    expect(bad.statusCode).toBe(400);
    const empty = await createInviteReq(app, { accountId: "a1", role: "" }, { cookie });
    expect(empty.statusCode).toBe(400);
    const missingAccount = await createInviteReq(app, { role: "editor" }, { cookie });
    expect(missingAccount.statusCode).toBe(400);
  });

  it("rejects Owner invites even when the caller is the Owner", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "owner-no-owner-invites@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    const res = await createInviteReq(app, { accountId: "a1", role: "owner" }, { cookie });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("OWNER_TRANSFER_REQUIRED");
    expect(res.json().error).toMatch(/transfer ownership/i);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM invites`).get()).toEqual({
      n: 0,
    });
  });
});

describe("GET /api/invites/:token/preview", () => {
  it("returns only safe company, role, and expiry context without requiring a session", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    createInvite(db, {
      token: "preview-token",
      id: "preview-id",
      accountId: "a1",
      role: "editor",
      preauthEmail: "private-address@capacitylens.dev",
      expiresAt: "2999-01-01T00:00:00.000Z",
      usedAt: null,
      createdAt: TS,
    });

    const res = await previewReq(app, "preview-token");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      accountName: "Studio a1",
      role: "editor",
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    expect(JSON.stringify(res.json())).not.toContain("private-address");
  });

  it.each([
    ["unknown", "missing-preview", 404],
    ["used", "used-preview", 409],
    ["expired", "expired-preview", 410],
    ["legacy Owner", "owner-preview", 410],
  ])("rejects an %s invite", async (kind, token, status) => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    if (kind !== "unknown") {
      createInvite(db, {
        token,
        id: `${token}-id`,
        accountId: "a1",
        role: kind === "legacy Owner" ? "owner" : "viewer",
        preauthEmail: null,
        expiresAt: kind === "expired" ? "2000-01-01T00:00:00.000Z" : "2999-01-01T00:00:00.000Z",
        usedAt: kind === "used" ? "2026-01-02T00:00:00.000Z" : null,
        createdAt: TS,
      });
    }
    expect((await previewReq(app, token)).statusCode).toBe(status);
  });
});

describe("POST /api/invites/:token/accept (P1.9 accept)", () => {
  it("a signed-in user accepts a valid editor invite -> 200, role bound, token consumed", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const a = await signUp(app, "inviter@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: a.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const created = await createInviteReq(app, { accountId: "a1", role: "editor" }, { cookie: a.cookie });
    const token = (created.json() as { token: string }).token;

    // User B (no prior membership) accepts.
    const b = await signUp(app, "joiner@capacitylens.dev");
    expect(getMemberRole(db, "a1", b.userId)).toBeNull(); // not yet a member
    const res = await acceptReq(app, token, { cookie: b.cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accountId: "a1", role: "editor" });
    // Role bound, token stamped used.
    expect(getMemberRole(db, "a1", b.userId)).toBe("editor");
    expect(getInvite(db, token)!.usedAt).not.toBeNull();
  });

  it("a reused invite is 409, and neither the membership nor usedAt changes", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const a = await signUp(app, "inviter2@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: a.userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });
    const created = await createInviteReq(app, { accountId: "a1", role: "viewer" }, { cookie: a.cookie });
    const token = (created.json() as { token: string }).token;

    const b = await signUp(app, "reuser@capacitylens.dev");
    expect((await acceptReq(app, token, { cookie: b.cookie })).statusCode).toBe(200);
    const usedAtAfterFirst = getInvite(db, token)!.usedAt;
    expect(usedAtAfterFirst).not.toBeNull();
    expect(getMemberRole(db, "a1", b.userId)).toBe("viewer");

    // Second accept (same token, same user) is rejected and changes nothing.
    const second = await acceptReq(app, token, { cookie: b.cookie });
    expect(second.statusCode).toBe(409);
    expect(getInvite(db, token)!.usedAt).toBe(usedAtAfterFirst);
    expect(getMemberRole(db, "a1", b.userId)).toBe("viewer");
  });

  it("consumes an invite without changing an existing sole-owner membership", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const owner = await signUp(app, "sole-owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const created = await createInviteReq(app, { accountId: "a1", role: "viewer" }, { cookie: owner.cookie });
    const token = (created.json() as { token: string }).token;

    const accepted = await acceptReq(app, token, { cookie: owner.cookie });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ accountId: "a1", role: "owner" });
    expect(getMemberRole(db, "a1", owner.userId)).toBe("owner");
    expect(getInvite(db, token)?.usedAt).not.toBeNull();
  });

  it("an expired invite is 410, and no membership is bound", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const b = await signUp(app, "late@capacitylens.dev");
    // Insert a born-expired invite directly (the body param refuses a past expiresAt, so seed it).
    createInvite(db, {
      token: "expired-token-xyz",
      id: "expired-invite-id",
      accountId: "a1",
      role: "editor",
      preauthEmail: null,
      expiresAt: "2000-01-01T00:00:00.000Z",
      usedAt: null,
      createdAt: TS,
    });

    const res = await acceptReq(app, "expired-token-xyz", { cookie: b.cookie });
    expect(res.statusCode).toBe(410);
    expect(getMemberRole(db, "a1", b.userId)).toBeNull();
    expect(getInvite(db, "expired-token-xyz")!.usedAt).toBeNull(); // not consumed
  });

  it.each([
    ["at or just after expiry", new Date().toISOString()],
    ["a corrupt expiry", "not-a-date"],
  ])("treats %s as expired", async (label, expiresAt) => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const user = await signUp(app, `expiry-${label.replaceAll(" ", "-")}@capacitylens.dev`);
    const token = `expiry-${label}`;
    createInvite(db, {
      token,
      id: token,
      accountId: "a1",
      role: "editor",
      preauthEmail: null,
      expiresAt,
      usedAt: null,
      createdAt: TS,
    });
    const res = await acceptReq(app, token, { cookie: user.cookie });
    expect(res.statusCode).toBe(410);
    expect(getMemberRole(db, "a1", user.userId)).toBeNull();
  });

  it("an unknown token is 404", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const b = await signUp(app, "nobody@capacitylens.dev");
    const res = await acceptReq(app, "no-such-token", { cookie: b.cookie });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/invites/:token/signup — password invite onboarding", () => {
  it("rejects invalid email, empty name, short password, and unsupported auth mode", async () => {
    const { app } = await appWithAuth();
    const base = {
      email: "new-person@capacitylens.dev",
      password: "password-123456",
      name: "New Person",
    };
    for (const [payload, error] of [
      [{ ...base, email: "not-an-email" }, "A valid email address is required."],
      [{ ...base, name: "   " }, "Name is required."],
      [{ ...base, password: "short" }, `Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.`],
    ] as const) {
      const response = await call(app, {
        method: "POST",
        url: "/api/invites/unknown-token/signup",
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error });
    }

    const unsupported = await call(buildApp(openDb(":memory:")), {
      method: "POST",
      url: "/api/invites/unknown-token/signup",
      payload: base,
    });
    expect(unsupported.statusCode).toBe(404);
    expect(unsupported.json()).toEqual({ error: "Not found." });
  });

  it("rejects invalid bearer tokens without reserving generated commands", async () => {
    const { app, db } = await appWithAuth();
    const commandCount = () => db.prepare(`SELECT COUNT(*) AS count FROM account_commands`).get();
    const before = commandCount();

    for (const token of ["unknown-invite-token-1", "unknown-invite-token-2"]) {
      const response = await call(app, {
        method: "POST",
        url: `/api/invites/${token}/signup`,
        payload: {
          email: "new-person@capacitylens.dev",
          password: "password-123456",
          name: "New Person",
        },
      });
      expect(response.statusCode).toBe(404);
    }

    expect(commandCount()).toEqual(before);
  });

  it("creates, binds, and signs in a genuinely new preauthorized user while public signup is closed", async () => {
    const db = openDb(":memory:");
    const { mode, auth } = authFromEnv(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: undefined,
      CAPACITYLENS_SETUP_TOKEN: "test-setup-token-0123456789abcdef",
    });
    await runAuthMigrations(auth!);
    const inviter = await auth!.createCredentialUser("inviter-closed@capacitylens.dev", "Inviter", "password-123456");
    const app = buildApp(db, { authMode: mode, auth });
    seedOne(db);
    upsertMember(db, {
      accountId: "a1",
      userId: inviter.id,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const signInInviter = await call(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: {
        email: "inviter-closed@capacitylens.dev",
        password: "password-123456",
      },
    });
    const created = await createInviteReq(
      app,
      {
        accountId: "a1",
        role: "editor",
        preauthEmail: "new-person@capacitylens.dev",
      },
      { cookie: cookiesOf(signInInviter) },
    );
    const token = (created.json() as { token: string }).token;

    // Ordinary self-registration is closed once the inviter exists.
    const publicSignup = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "  NEW-PERSON@capacitylens.dev  ",
        password: "password-123456",
        name: "  New 💩  Person  ",
      },
    });
    expect(publicSignup.statusCode).toBe(400);

    // The bearer invite provides the narrow onboarding route and needs no existing session.
    const onboard = await call(app, {
      method: "POST",
      url: `/api/invites/${token}/signup`,
      payload: {
        email: "new-person@capacitylens.dev",
        password: "password-123456",
        name: "New Person",
      },
    });
    expect(onboard.statusCode).toBe(201);
    expect(onboard.json()).toMatchObject({
      ok: true,
      accountId: "a1",
      role: "editor",
    });
    expect(getInvite(db, token)?.usedAt).not.toBeNull();

    const signedIn = await call(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: {
        email: "new-person@capacitylens.dev",
        password: "password-123456",
      },
    });
    expect(signedIn.statusCode).toBe(200);
    const me = await call(app, {
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: cookiesOf(signedIn) },
    });
    expect(me.json().user.emailVerified).toBe(true);
    expect(me.json().user.name).toBe("New Person");
    expect(getMemberRole(db, "a1", me.json().user.id)).toBe("editor");
    expect((await acceptReq(app, token, { cookie: cookiesOf(signedIn) })).statusCode).toBe(409);
  });
});

describe("invites — OFF mode (trusted-local)", () => {
  it("create + accept work and bind the DEMO_USER membership", async () => {
    const db = openDb(":memory:");
    const app = buildApp(db); // authMode defaults to 'off'
    seedOne(db);

    const created = await createInviteReq(app, {
      accountId: "a1",
      role: "editor",
    });
    expect(created.statusCode).toBe(201); // OFF = allow-all, minted as DEMO_USER's act
    const token = (created.json() as { token: string }).token;

    const res = await acceptReq(app, token);
    expect(res.statusCode).toBe(200);
    expect(getMemberRole(db, "a1", DEMO_USER.id)).toBe("editor");
    expect(getInvite(db, token)!.usedAt).not.toBeNull();
  });
});

// P1.10 — email-pre-authorise. The pure decision matrix (preauthInviteAllows + normalizeEmail) is
// unit-tested deterministically below; the integration block then proves the create-store-normalize
// path and every accept outcome (link binds, wrong-email 403, unverified-match 403, verified-match
// 200, OFF skip) end-to-end, asserting that a 403 never consumes the single-use invite.

describe("P1.10 — preauthInviteAllows / normalizeEmail (pure decision matrix)", () => {
  it("normalizeEmail trims and lowercases", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
    expect(normalizeEmail("bob@host")).toBe("bob@host");
    expect(normalizeEmail("ALREADY@LOWER.io ")).toBe("already@lower.io");
  });

  it("null preauth → true for ANY signed-in caller (link invite — even unverified)", () => {
    expect(preauthInviteAllows(null, { email: "anyone@x.io", emailVerified: false })).toBe(true);
    expect(preauthInviteAllows(null, { email: "anyone@x.io", emailVerified: true })).toBe(true);
  });

  it("preauth + verified + EXACT (normalized) match → true (case/whitespace folded by store-time normalize)", () => {
    // preauthEmail is stored ALREADY normalized; the user email is normalized inside the helper, so a
    // differently-cased / padded live email still matches the normalized stored value.
    const stored = normalizeEmail("Carol@Example.com"); // = 'carol@example.com'
    expect(
      preauthInviteAllows(stored, {
        email: "Carol@Example.com",
        emailVerified: true,
      }),
    ).toBe(true);
    expect(
      preauthInviteAllows(stored, {
        email: "  CAROL@EXAMPLE.COM ",
        emailVerified: true,
      }),
    ).toBe(true);
  });

  it("preauth + verified + DIFFERENT email → false", () => {
    const stored = normalizeEmail("carol@example.com");
    expect(
      preauthInviteAllows(stored, {
        email: "dave@example.com",
        emailVerified: true,
      }),
    ).toBe(false);
  });

  it("preauth + unverified matching email is SSO-denied but password-mode allowed", () => {
    const stored = normalizeEmail("carol@example.com");
    expect(
      preauthInviteAllows(stored, {
        email: "carol@example.com",
        emailVerified: false,
      }),
    ).toBe(false);
    expect(preauthInviteAllows(stored, { email: "carol@example.com", emailVerified: false }, true)).toBe(true);
  });
});

describe("POST /api/invites (P1.10 create) — preauthEmail", () => {
  it("create with preauthEmail → 201; getInvite stores the NORMALIZED value; 201 echoes it", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    const res = await createInviteReq(
      app,
      {
        accountId: "a1",
        role: "editor",
        preauthEmail: "  Friend@Example.COM ",
      },
      { cookie },
    );
    expect(res.statusCode).toBe(201);
    const body = res.json() as { token: string; preauthEmail: string };
    expect(body.preauthEmail).toBe("friend@example.com"); // echoed normalized
    expect(getInvite(db, body.token)!.preauthEmail).toBe("friend@example.com"); // stored normalized
  });

  it("empty/whitespace preauthEmail → stored null (link invite, unchanged P1.9 behaviour)", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "owner2@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    const res = await createInviteReq(app, { accountId: "a1", role: "editor", preauthEmail: "   " }, { cookie });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { token: string; preauthEmail: string | null };
    expect(body.preauthEmail).toBeNull();
    expect(getInvite(db, body.token)!.preauthEmail).toBeNull();
  });

  it("a malformed preauthEmail → 400 (no row minted)", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const { cookie, userId } = await signUp(app, "owner3@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    for (const bad of [
      "not-an-email",
      "two@@at.io",
      "@nolocal.io",
      "nodomain@",
      "invite\0@example.com",
      "invite\u202e@example.com",
      "invite\u200b@example.com",
      `${"a".repeat(250)}@x.io`,
      `${"İ".repeat(251)}@a`,
      null,
      42,
    ]) {
      const res = await createInviteReq(app, { accountId: "a1", role: "editor", preauthEmail: bad }, { cookie });
      expect(res.statusCode, `"${bad}" rejected`).toBe(400);
    }
  });
});

describe("POST /api/invites/:token/accept (P1.10 preauth gate)", () => {
  it("requires the strict provider before an SSO-only session can create a membership", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_SSO_CLIENT_ID: "client-id",
      CAPACITYLENS_SSO_CLIENT_SECRET: "client-secret",
      CAPACITYLENS_SSO_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
      CAPACITYLENS_SSO_ISSUER: "https://idp.example",
      CAPACITYLENS_SSO_PROVIDER_ID: "workforce",
      CAPACITYLENS_GITHUB_CLIENT_ID: "github-client-id",
      CAPACITYLENS_GITHUB_CLIENT_SECRET: "github-client-secret",
    });
    await runAuthMigrations(configured.auth!);
    const passwordApp = buildApp(db, { authMode: "password", auth: configured.auth });
    const joiner = await signUp(passwordApp, "social-only@capacitylens.dev");
    verifyUserEmail(db, "social-only@capacitylens.dev");
    await passwordApp.close();
    const timestamp = new Date().toISOString();
    db.prepare(
      `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("github-link", "github", "github-subject", joiner.userId, timestamp, timestamp);
    const session = db.prepare(`SELECT token FROM session WHERE userId = ?`).get(joiner.userId) as { token: string };
    const sessionHandle = applicationSessionHandle("capacitylens", session.token);
    recordSessionAssurance(db, sessionHandle, joiner.userId, "federated", "github");
    const ssoApp = buildApp(db, { authMode: "sso", auth: configured.auth });

    const socialMe = await call(ssoApp, { method: "GET", url: "/api/auth/me", headers: { cookie: joiner.cookie } });
    expect(socialMe.json().canCreateAccount).toBe(false);
    const socialProvision = await call(ssoApp, {
      method: "POST",
      url: "/api/orgs",
      headers: { cookie: joiner.cookie },
      payload: { id: "founded", name: "Founded", color: "#3b82f6" },
    });
    expect(socialProvision.statusCode).toBe(403);
    expect(socialProvision.json().error).toMatch(/required SSO provider/i);

    db.prepare(
      `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("workforce-link", "workforce", "workforce-subject", joiner.userId, timestamp, timestamp);
    recordSessionAssurance(db, sessionHandle, joiner.userId, "federated", "workforce");
    const strictProvision = await call(ssoApp, {
      method: "POST",
      url: "/api/orgs",
      headers: { cookie: joiner.cookie },
      payload: { id: "founded", name: "Founded", color: "#3b82f6" },
    });
    expect(strictProvision.statusCode).toBe(201);
    expect(getMemberRole(db, "founded", joiner.userId)).toBe("owner");

    seedOne(db);
    createInvite(db, {
      token: "sso-provider-invite",
      id: "sso-provider-invite-id",
      accountId: "a1",
      role: "editor",
      preauthEmail: "social-only@capacitylens.dev",
      expiresAt: "2999-01-01T00:00:00.000Z",
      usedAt: null,
      createdAt: TS,
    });
    recordSessionAssurance(db, sessionHandle, joiner.userId, "federated", "github");

    const refused = await acceptReq(ssoApp, "sso-provider-invite", { cookie: joiner.cookie });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatch(/required SSO provider/i);
    expect(getMemberRole(db, "a1", joiner.userId)).toBeNull();
    expect(getInvite(db, "sso-provider-invite")!.usedAt).toBeNull();

    recordSessionAssurance(db, sessionHandle, joiner.userId, "federated", "workforce");
    const accepted = await acceptReq(ssoApp, "sso-provider-invite", { cookie: joiner.cookie });
    expect(accepted.statusCode).toBe(200);
    expect(getMemberRole(db, "a1", joiner.userId)).toBe("editor");
  });

  it("a LINK invite (preauthEmail null) still binds any signed-in caller — P1.9 regression", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const a = await signUp(app, "link-inviter@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: a.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const created = await createInviteReq(app, { accountId: "a1", role: "editor" }, { cookie: a.cookie });
    const token = (created.json() as { token: string }).token;

    // Joiner is an ordinary, unverified fresh sign-up — a link invite does not care.
    const b = await signUp(app, "link-joiner@capacitylens.dev");
    const res = await acceptReq(app, token, { cookie: b.cookie });
    expect(res.statusCode).toBe(200);
    expect(getMemberRole(db, "a1", b.userId)).toBe("editor");
  });

  it("preauth + WRONG email → 403; membership NOT created; invite NOT consumed (usedAt stays null)", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const a = await signUp(app, "pa-inviter@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: a.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const created = await createInviteReq(
      app,
      {
        accountId: "a1",
        role: "editor",
        preauthEmail: "expected@capacitylens.dev",
      },
      { cookie: a.cookie },
    );
    const token = (created.json() as { token: string }).token;

    // Wrong-email caller, even if verified, is rejected.
    const b = await signUp(app, "wrong@capacitylens.dev");
    verifyUserEmail(db, "wrong@capacitylens.dev");
    const res = await acceptReq(app, token, { cookie: b.cookie });
    expect(res.statusCode).toBe(403);
    expect(getMemberRole(db, "a1", b.userId)).toBeNull(); // no bind
    expect(getInvite(db, token)!.usedAt).toBeNull(); // NOT consumed — still live for the right caller
  });

  it("password mode accepts a matching preauthorized email without a separate verification service", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const a = await signUp(app, "pa-inviter2@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: a.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const created = await createInviteReq(
      app,
      {
        accountId: "a1",
        role: "editor",
        preauthEmail: "newhire@capacitylens.dev",
      },
      { cookie: a.cookie },
    );
    const token = (created.json() as { token: string }).token;

    // Password mode proves control of the identity by the signed-in local credential itself.
    const b = await signUp(app, "newhire@capacitylens.dev");
    const res = await acceptReq(app, token, { cookie: b.cookie });
    expect(res.statusCode).toBe(200);
    expect(getMemberRole(db, "a1", b.userId)).toBe("editor");
    expect(getInvite(db, token)!.usedAt).not.toBeNull();
  });

  it("preauth + matching VERIFIED email → 200; role bound; usedAt set (end-to-end)", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    const a = await signUp(app, "pa-inviter3@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: a.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const created = await createInviteReq(
      app,
      {
        accountId: "a1",
        role: "editor",
        preauthEmail: "verified@capacitylens.dev",
      },
      { cookie: a.cookie },
    );
    const token = (created.json() as { token: string }).token;

    // Sign up, then flip emailVerified in the live user row; the NEXT getSession reads it fresh, so
    // the principal the accept handler sees is verified (proves the verified-match → bind path E2E).
    const b = await signUp(app, "verified@capacitylens.dev");
    verifyUserEmail(db, "verified@capacitylens.dev");
    // Sanity: /api/auth/me now reports the verified flag (confirms getSession reflects the row).
    const me = await call(app, {
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: b.cookie },
    });
    expect(me.json().user.emailVerified).toBe(true);

    const res = await acceptReq(app, token, { cookie: b.cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accountId: "a1", role: "editor" });
    expect(getMemberRole(db, "a1", b.userId)).toBe("editor");
    expect(getInvite(db, token)!.usedAt).not.toBeNull();
  });

  it("OFF mode skips the preauth check — a preauth invite binds DEMO_USER (trusted-local)", async () => {
    const db = openDb(":memory:");
    const app = buildApp(db); // authMode defaults to 'off'
    seedOne(db);

    // Even a preauth invite for an unrelated email binds DEMO_USER in off (the gate is skipped).
    const created = await createInviteReq(app, {
      accountId: "a1",
      role: "admin",
      preauthEmail: "someone-else@capacitylens.dev",
    });
    expect(created.statusCode).toBe(201);
    const token = (created.json() as { token: string }).token;

    const res = await acceptReq(app, token);
    expect(res.statusCode).toBe(200);
    expect(getMemberRole(db, "a1", DEMO_USER.id)).toBe("admin");
    expect(getInvite(db, token)!.usedAt).not.toBeNull();
  });
});

describe("invites are excluded from the AppData path", () => {
  it("an invite row never appears in GET /api/state or loadState", async () => {
    const db = openDb(":memory:");
    const app = buildApp(db);
    createInvite(db, {
      token: "secret-invite-token",
      id: "secret-invite-id",
      accountId: "acc-1",
      role: "admin",
      preauthEmail: null,
      expiresAt: "2999-01-01T00:00:00.000Z",
      usedAt: null,
      createdAt: TS,
    });

    const res = await app.inject({ method: "GET", url: "/api/state" });
    expect(res.statusCode).toBe(200);
    const state = res.json() as Record<string, unknown>;
    expect(state).not.toHaveProperty("invites");
    // Belt-and-braces: the table name AND the token secret must appear NOWHERE in the wire state.
    expect(JSON.stringify(state)).not.toContain("invites");
    expect(JSON.stringify(state)).not.toContain("secret-invite-token");
    expect(loadState(db) as unknown as Record<string, unknown>).not.toHaveProperty("invites");
  });

  it("is not a known entity for generic CRUD (GET 404, POST 404 — never a listing/persist)", async () => {
    const app = buildApp(openDb(":memory:"));
    // No GET /api/:entity route exists -> Fastify 404 (never a 200 listing the invites table).
    const get = await app.inject({
      method: "GET",
      url: "/api/invites/some-token",
    });
    // NOTE: /api/invites/:token/accept is a real route; a bare GET on that shape is a 404 (no GET
    // handler), and a GET on the collection path is likewise unhandled — neither lists rows.
    expect([404, 405]).toContain(get.statusCode);
    const post = await app.inject({
      method: "POST",
      url: "/api/account_members", // a control table proper -> generic CRUD refuses it
      payload: {
        accountId: "a",
        userId: "u",
        role: "admin",
        status: "active",
        createdAt: "x",
      },
    });
    expect(post.statusCode).toBe(404);
  });
});

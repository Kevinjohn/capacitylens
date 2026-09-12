import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app";
import { openDb, insertAll, type Db } from "./db";
import { upsertMember, getMemberRole, getInvite } from "./controlTables";
import { createAuthFromEnvironment, runAuthMigrations, type Auth } from "./auth";
import { PASSWORD_ENV, call, signUp } from "./testHelpers";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";
import { recordSessionAssurance } from "./accounts/state";

// P1.11 — Owner/Admin member-management endpoints. Mirrors app.invites.test.ts: drives sign-up →
// membership → the five new routes (GET/PATCH/DELETE members, GET/DELETE invites) plus the Owner
// rejection on POST /api/invites. Asserts the gates (owner/admin allowed, editor/viewer/non-member 403,
// session-less 401), the role-change matrix (Owner changes only through transfer), that the
// exactly-one-Owner backstop refuses generic demotion/removal/duplication, that the
// invites LIST never carries the token, cross-tenant revoke is a no-op, and — the headline — that an
// admin of one account cannot read another account's members (cross-tenant member leak → 403).

const TS = "2026-01-01T00:00:00.000Z";
const meta = () => ({ createdAt: TS, updatedAt: TS });
const account = (id: string) => ({
  id,
  name: `Studio ${id}`,
  color: "#3b82f6",
  ...meta(),
});

/** Seed two pre-existing accounts directly (a1 + a2, for the cross-tenant cases). */
function seedTwo(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>;
  d.accounts = [account("a1"), account("a2")];
  insertAll(db, d as unknown as AppData);
}

async function appWithAuth(options: { rateLimit?: number } = {}): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(":memory:");
  const { mode, auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
  if (!auth) throw new Error("Expected auth configuration.");
  await runAuthMigrations(auth);
  return { app: createApp(db, { authMode: mode, auth, ...options }), db };
}

const membersReq = (app: FastifyInstance, accountId: string, headers: Record<string, string> = {}) =>
  call(app, {
    method: "GET",
    url: `/api/accounts/${accountId}/members`,
    headers,
  });

interface MemberSignInTrackingReqInput {
  app: FastifyInstance;
  accountId: string;
  enabled: unknown;
  headers?: Record<string, string> | undefined;
}

const memberSignInTrackingReq = ({ app, accountId, enabled, headers = {} }: MemberSignInTrackingReqInput) =>
  call(app, {
    method: "PUT",
    url: `/api/accounts/${accountId}/member-sign-in-tracking`,
    payload: { enabled },
    headers,
  });

interface PatchRoleReqInput {
  app: FastifyInstance;
  accountId: string;
  userId: string;
  role: unknown;
  headers?: Record<string, string> | undefined;
}

const patchRoleReq = ({ app, accountId, userId, role, headers = {} }: PatchRoleReqInput) =>
  call(app, {
    method: "PATCH",
    url: `/api/accounts/${accountId}/members/${userId}`,
    payload: { role },
    headers,
  });

interface RemoveReqInput {
  app: FastifyInstance;
  accountId: string;
  userId: string;
  headers?: Record<string, string> | undefined;
}

const removeReq = ({ app, accountId, userId, headers = {} }: RemoveReqInput) =>
  call(app, {
    method: "DELETE",
    url: `/api/accounts/${accountId}/members/${userId}`,
    headers,
  });

interface RevokeSessionsReqInput {
  app: FastifyInstance;
  accountId: string;
  userId: string;
  headers?: Record<string, string> | undefined;
}

const revokeSessionsReq = ({ app, accountId, userId, headers = {} }: RevokeSessionsReqInput) =>
  call(app, {
    method: "POST",
    url: `/api/accounts/${accountId}/members/${userId}/revoke-sessions`,
    headers,
  });

const invitesReq = (app: FastifyInstance, accountId: string, headers: Record<string, string> = {}) =>
  call(app, {
    method: "GET",
    url: `/api/accounts/${accountId}/invites`,
    headers,
  });

const createInviteReq = (
  app: FastifyInstance,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
) => call(app, { method: "POST", url: "/api/invites", payload, headers });

function parseCommandId(value: unknown): string {
  if (typeof value !== "object" || value === null || !("commandId" in value) || typeof value.commandId !== "string") {
    throw new Error("Expected response body to contain a string commandId");
  }
  return value.commandId;
}

function parseErrorCode(value: unknown): string {
  if (typeof value !== "object" || value === null || !("code" in value) || typeof value.code !== "string") {
    throw new Error("Expected response body to contain a string error code");
  }
  return value.code;
}

function registerMemberGateAccessTest(): void {
  it("owner and admin may list; editor/viewer/non-member are 403", async () => {
    for (const [role, allowed] of [
      ["owner", true],
      ["admin", true],
      ["editor", false],
      ["viewer", false],
    ] as const) {
      const { app, db } = await appWithAuth();
      seedTwo(db);
      const { cookie, userId } = await signUp(app, `${role}-list@capacitylens.dev`);
      upsertMember(db, { accountId: "a1", userId, role, status: "active", createdAt: TS });
      const res = await membersReq(app, "a1", { cookie });
      expect(res.statusCode, `${role}`).toBe(allowed ? 200 : 403);
    }
  });
}

const ageSession = (db: Db, userId: string): void => {
  db.prepare(`UPDATE session SET createdAt = ? WHERE userId = ?`).run(
    new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    userId,
  );
};

function registerStaleMemberDirectoryReadTest(): void {
  it("allows an admin directory read and the sign-in-tracking toggle from a stale session", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-stale-directory@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    ageSession(db, owner.userId);

    const members = await membersReq(app, "a1", { cookie: owner.cookie });
    expect(members.statusCode).toBe(200);
    expect((members.json() as { members: unknown[] }).members).toHaveLength(1);

    const invites = await invitesReq(app, "a1", { cookie: owner.cookie });
    expect(invites.statusCode).toBe(200);

    // The sign-in-tracking toggle is ordinary administration, so an aged-out session performs it.
    const mutation = await memberSignInTrackingReq({
      app,
      accountId: "a1",
      enabled: true,
      headers: { cookie: owner.cookie },
    });
    expect(mutation.statusCode).toBe(200);
    expect(mutation.json()).toMatchObject({ enabled: true });
  });
}

function registerStaleOrdinaryMemberAdministrationTest(): void {
  it("runs invite, role, status and removal administration from a stale session but not the ownership transfer", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-stale-ordinary@capacitylens.dev");
    const member = await signUp(app, "member-stale-ordinary@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    upsertMember(db, { accountId: "a1", userId: member.userId, role: "editor", status: "active", createdAt: TS });

    // Create the invitation that will be revoked BEFORE ageing the session, so the revoke below is
    // the only invite operation whose freshness is under test alongside a second, stale creation.
    const seeded = await createInviteReq(app, { accountId: "a1", role: "editor" }, { cookie: owner.cookie });
    expect(seeded.statusCode).toBe(201);
    const seededInvite = getInvite(db, (seeded.json() as { token: string }).token);
    if (!seededInvite) throw new Error("Expected the seeded invitation.");

    ageSession(db, owner.userId);

    const created = await createInviteReq(app, { accountId: "a1", role: "viewer" }, { cookie: owner.cookie });
    expect(created.statusCode, created.body).toBe(201);

    const revoked = await call(app, {
      method: "DELETE",
      url: `/api/accounts/a1/invites/${seededInvite.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(revoked.statusCode, revoked.body).toBe(204);

    const roleChange = await patchRoleReq({
      app,
      accountId: "a1",
      userId: member.userId,
      role: "admin",
      headers: { cookie: owner.cookie },
    });
    expect(roleChange.statusCode, roleChange.body).toBe(200);
    expect(getMemberRole(db, "a1", member.userId)).toBe("admin");

    const statusChange = await patchStatusReq({
      app,
      accountId: "a1",
      userId: member.userId,
      status: "disabled",
      headers: { cookie: owner.cookie },
    });
    expect(statusChange.statusCode, statusChange.body).toBe(200);

    const removal = await removeReq({
      app,
      accountId: "a1",
      userId: member.userId,
      headers: { cookie: owner.cookie },
    });
    expect(removal.statusCode, removal.body).toBe(204);
    expect(getMemberRole(db, "a1", member.userId)).toBeNull();

    // Ownership transfer stays on the high-impact list: the same stale session is refused.
    const successor = await signUp(app, "successor-stale-ordinary@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: successor.userId, role: "admin", status: "active", createdAt: TS });
    const transferred = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/transfer-ownership",
      payload: { toUserId: successor.userId },
      headers: { cookie: owner.cookie },
    });
    expect(transferred.statusCode).toBe(403);
    expect(parseErrorCode(transferred.json())).toBe("SESSION_NOT_FRESH");
    expect(getMemberRole(db, "a1", owner.userId)).toBe("owner");
  });
}

function registerMemberGateStrangerTest(): void {
  it("a non-member (cross-tenant stranger) is 403", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const { cookie } = await signUp(app, "stranger-list@capacitylens.dev");
    const res = await membersReq(app, "a1", { cookie });
    expect(res.statusCode).toBe(403);
  });
}

function registerMemberGateAnonymousTest(): void {
  it("a session-less request is 401", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const res = await membersReq(app, "a1");
    expect(res.statusCode).toBe(401);
  });
}

function registerMemberGateCrossTenantTest(): void {
  it("THE HEADLINE — an admin of a1 cannot list a2's members (cross-tenant leak → 403)", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const { cookie, userId } = await signUp(app, "a1-admin@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId, role: "admin", status: "active", createdAt: TS });
    const other = await signUp(app, "a2-owner@capacitylens.dev");
    upsertMember(db, { accountId: "a2", userId: other.userId, role: "owner", status: "active", createdAt: TS });
    const res = await membersReq(app, "a2", { cookie });
    expect(res.statusCode).toBe(403);
  });
}

function registerMemberGateIdentityTest(): void {
  it("returns members with identity (name/email) + isSelf for the caller", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-id@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    const ed = await signUp(app, "editor-id@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: ed.userId, role: "editor", status: "active", createdAt: TS });
    const res = await membersReq(app, "a1", { cookie: owner.cookie });
    expect(res.statusCode).toBe(200);
    const members = (
      res.json() as {
        members: Array<{ userId: string; email: string | null; isSelf: boolean; role: string }>;
      }
    ).members;
    expect(members).toHaveLength(2);
    const self = members.find((m) => m.userId === owner.userId);
    if (!self) throw new Error("Expected the owner member row.");
    expect(self.isSelf).toBe(true);
    expect(self.email).toBe("owner-id@capacitylens.dev");
    const otherRow = members.find((m) => m.userId === ed.userId);
    if (!otherRow) throw new Error("Expected the editor member row.");
    expect(otherRow.isSelf).toBe(false);
    expect(otherRow.role).toBe("editor");
  });
}

function registerMemberGateResetCapabilityTest(): void {
  it("reports mayResetPassword per-row from the SERVER's full cross-account judgment", async () => {
    // The client hides the reset control off this field, so it must equal what the reset route would
    // decide — true for an ordinary same-account target and the caller\'s own row, false for a target
    // whose GLOBAL identity outranks the caller in another account (the cross-account takeover the
    // reset route refuses). Proving the affordance can\'t drift open past the enforcement.
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-mrp@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    // An ordinary editor, only in a1 → resettable.
    const ed = await signUp(app, "editor-mrp@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: ed.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });
    // A member who is a mere editor in a1 but the OWNER of a2 → the owner of a1 has no standing in a2.
    const crossOwner = await signUp(app, "cross-owner-mrp@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: crossOwner.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });
    upsertMember(db, {
      accountId: "a2",
      userId: crossOwner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    const res = await membersReq(app, "a1", { cookie: owner.cookie });
    expect(res.statusCode).toBe(200);
    const members = (
      res.json() as {
        members: Array<{
          userId: string;
          mayResetPassword: boolean;
          mayRevokeSessions: boolean;
        }>;
      }
    ).members;
    const by = (id: string) => {
      const member = members.find((m) => m.userId === id);
      if (!member) throw new Error(`Expected member row for ${id}.`);
      return member;
    };
    expect(by(ed.userId).mayResetPassword).toBe(true); // same-account editor → resettable
    expect(by(owner.userId).mayResetPassword).toBe(true); // caller's own row (self-reset exemption)
    expect(by(crossOwner.userId).mayResetPassword).toBe(false); // outranks caller in a2 → refused
    expect(by(ed.userId).mayRevokeSessions).toBe(true);
    expect(by(owner.userId).mayRevokeSessions).toBe(true);
    expect(by(crossOwner.userId).mayRevokeSessions).toBe(false);
  });
}

describe("GET /api/accounts/:id/members — gate", () => {
  registerMemberGateAccessTest();
  registerStaleMemberDirectoryReadTest();
  registerStaleOrdinaryMemberAdministrationTest();
  registerMemberGateStrangerTest();
  registerMemberGateAnonymousTest();
  registerMemberGateCrossTenantTest();
  registerMemberGateIdentityTest();
  registerMemberGateResetCapabilityTest();
});

function createAnonymousRevocationTest(): void {
  it("requires a session for session revocation and ownership transfer", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);

    expect((await revokeSessionsReq({ app, accountId: "a1", userId: "target" })).statusCode).toBe(401);
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/transfer-ownership",
          payload: { toUserId: "target" },
        })
      ).statusCode,
    ).toBe(401);
  });
}

function createOwnerRevocationTest(): void {
  it("lets an owner terminate a member session and invalidates that cookie immediately", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-revoke@capacitylens.dev");
    const target = await signUp(app, "target-revoke@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    upsertMember(db, {
      accountId: "a1",
      userId: target.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/accounts",
          headers: { cookie: target.cookie },
        })
      ).statusCode,
    ).toBe(200);

    const revoked = await revokeSessionsReq({
      app,
      accountId: "a1",
      userId: target.userId,
      headers: {
        cookie: owner.cookie,
      },
    });
    expect(revoked.statusCode).toBe(204);
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/accounts",
          headers: { cookie: target.cookie },
        })
      ).statusCode,
    ).toBe(401);
  });
}

function createCrossAccountRevocationTest(): void {
  it("refuses cross-account authority and leaves the target session intact", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-revoke-cross@capacitylens.dev");
    const target = await signUp(app, "target-revoke-cross@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    upsertMember(db, {
      accountId: "a1",
      userId: target.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });
    upsertMember(db, {
      accountId: "a2",
      userId: target.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    expect(
      (
        await revokeSessionsReq({
          app,
          accountId: "a1",
          userId: target.userId,
          headers: {
            cookie: owner.cookie,
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/accounts",
          headers: { cookie: target.cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
}

function createStaleSessionRevocationTest(): void {
  it("requires a fresh sign-in before a privileged session-termination action", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-revoke-stale@capacitylens.dev");
    const target = await signUp(app, "target-revoke-stale@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    upsertMember(db, {
      accountId: "a1",
      userId: target.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });
    db.prepare(`UPDATE session SET createdAt = ? WHERE userId = ?`).run(
      new Date(Date.now() - 16 * 60 * 1000).toISOString(),
      owner.userId,
    );

    // An old session remains usable for ordinary reads, but not the security-sensitive action.
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/accounts",
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(200);
    const result = await revokeSessionsReq({
      app,
      accountId: "a1",
      userId: target.userId,
      headers: {
        cookie: owner.cookie,
      },
    });
    expect(result.statusCode).toBe(403);
    expect(parseErrorCode(result.json())).toBe("SESSION_NOT_FRESH");
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/accounts",
          headers: { cookie: target.cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
}

describe("POST /api/accounts/:id/members/:userId/revoke-sessions", () => {
  createAnonymousRevocationTest();
  createOwnerRevocationTest();
  createCrossAccountRevocationTest();
  createStaleSessionRevocationTest();
});

// ── Step-up freshness gate: fail CLOSED on a missing session timestamp ─────────────────────────
//
// The real Better Auth path always stamps sessionCreatedAt (auth.api.getSession derives it from the
// session row), so a verified session WITHOUT it can only come from a nonstandard adapter or a
// corrupted session record. That shape must count as NOT fresh (403 SESSION_NOT_FRESH — the
// re-auth dialog recovers by minting a dated session), never as fresh: the field is unverifiable,
// and treating its absence as "fresh" would let it bypass the step-up gate entirely.

/** A stub Auth whose verified session carries NO sessionCreatedAt — the only way to drive the
 *  missing-timestamp branch, since the real adapter always sets it. */
function timestamplessAuth(userId: string): Auth {
  return {
    handler: async () => new Response(null),
    api: {
      getSession: async () => ({
        user: {
          id: userId,
          email: "undated@capacitylens.dev",
          emailVerified: true,
          name: "Undated",
          image: null,
        },
        session: {
          id: "undated-session",
          // Deliberately malformed: the adapter must preserve ordinary access but treat freshness
          // as unverifiable. A real Better Auth session always supplies this field.
          createdAt: undefined as unknown as string,
          expiresAt: "2026-12-31T00:00:00.000Z",
        },
      }),
      requestPasswordReset: async () => ({ status: true }),
    },
    options: {},
    providers: [],
    federatedIssuers: new Map(),
    ensureProviderBindings: () => {},
    revokeUserSessions: async () => {},
    createCredentialUser: async () => ({ id: userId }),
    deleteCredentialUser: async () => {},
  };
}

function createMissingTimestampRejectionTest(): void {
  it("403s a gated (above-write) action with SESSION_NOT_FRESH when the session has no timestamp", async () => {
    const db = openDb(":memory:");
    seedTwo(db);
    upsertMember(db, {
      accountId: "a1",
      userId: "undated-owner",
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    upsertMember(db, {
      accountId: "a1",
      userId: "undated-target",
      role: "editor",
      status: "active",
      createdAt: TS,
    });
    recordSessionAssurance({ db, sessionId: "undated-session", principalId: "undated-owner", assurance: "password" });
    const app = createApp(db, {
      authMode: "password",
      auth: timestamplessAuth("undated-owner"),
    });

    const result = await revokeSessionsReq({ app, accountId: "a1", userId: "undated-target" });
    expect(result.statusCode).toBe(403);
    expect(parseErrorCode(result.json())).toBe("SESSION_NOT_FRESH");
    // The membership itself is intact — only the freshness gate refused, not authorization.
    expect(getMemberRole(db, "a1", "undated-target")).toBe("editor");
  });
}

function createMissingTimestampReadWriteTest(): void {
  it("read and write actions are unaffected — the freshness gate covers only above-write actions", async () => {
    const db = openDb(":memory:");
    seedTwo(db);
    upsertMember(db, {
      accountId: "a1",
      userId: "undated-owner",
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    recordSessionAssurance({ db, sessionId: "undated-session", principalId: "undated-owner", assurance: "password" });
    const app = createApp(db, {
      authMode: "password",
      auth: timestamplessAuth("undated-owner"),
    });

    expect((await call(app, { method: "GET", url: "/api/state?accountId=a1" })).statusCode).toBe(200);
    const put = await call(app, {
      method: "PUT",
      url: "/api/clients/c-undated",
      payload: {
        id: "c-undated",
        accountId: "a1",
        name: "Acme",
        color: "#3b82f6",
        createdAt: TS,
        updatedAt: TS,
      },
    });
    expect(put.statusCode).toBe(200);
  });
}

describe("step-up freshness gate — missing sessionCreatedAt fails closed", () => {
  createMissingTimestampRejectionTest();
  createMissingTimestampReadWriteTest();
});

function registerAdminRoleChangeTest(): void {
  it("admin changes editor→viewer → 200", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const admin = await signUp(app, "admin-pr@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: admin.userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });
    const target = await signUp(app, "target-pr@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: target.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });

    const res = await patchRoleReq({
      app,
      accountId: "a1",
      userId: target.userId,
      role: "viewer",
      headers: {
        cookie: admin.cookie,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(getMemberRole(db, "a1", target.userId)).toBe("viewer");
  });
}

function registerOwnerRoleGrantRejectionTest(): void {
  it("Owner cannot be assigned through an ordinary role change → 400", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const admin = await signUp(app, "admin-grant@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: admin.userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });
    const target = await signUp(app, "target-grant@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: target.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });

    const res = await patchRoleReq({
      app,
      accountId: "a1",
      userId: target.userId,
      role: "owner",
      headers: {
        cookie: admin.cookie,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(getMemberRole(db, "a1", target.userId)).toBe("editor"); // unchanged
  });
}

function registerOwnerDemotionRejectionTest(): void {
  it("admin cannot demote an existing OWNER → 403", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const admin = await signUp(app, "admin-touch@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: admin.userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });
    const owner = await signUp(app, "owner-touch@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    const res = await patchRoleReq({
      app,
      accountId: "a1",
      userId: owner.userId,
      role: "editor",
      headers: {
        cookie: admin.cookie,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(getMemberRole(db, "a1", owner.userId)).toBe("owner");
  });
}

function registerOwnerOrdinaryRoleManagementTest(): void {
  it("owner manages ordinary non-owner roles but cannot grant Owner through the role endpoint", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-all@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const ed = await signUp(app, "ed-all@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: ed.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });

    expect(
      (
        await patchRoleReq({
          app,
          accountId: "a1",
          userId: ed.userId,
          role: "admin",
          headers: {
            cookie: owner.cookie,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(getMemberRole(db, "a1", ed.userId)).toBe("admin");
    expect(
      (
        await patchRoleReq({
          app,
          accountId: "a1",
          userId: ed.userId,
          role: "owner",
          headers: {
            cookie: owner.cookie,
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(getMemberRole(db, "a1", ed.userId)).toBe("admin");
  });
}

async function assertMissingMemberMutationResponses(app: FastifyInstance, ownerCookie: string): Promise<void> {
  const expectedNotFound = { code: "NOT_FOUND", retryable: false };
  const patch = await patchRoleReq({
    app,
    accountId: "a1",
    userId: "ghost",
    role: "editor",
    headers: { cookie: ownerCookie },
  });
  expect(patch.statusCode).toBe(404);
  expect(patch.json()).toMatchObject(expectedNotFound);
  expect(parseCommandId(patch.json())).toEqual(expect.any(String));
  const remove = await removeReq({ app, accountId: "a1", userId: "ghost", headers: { cookie: ownerCookie } });
  expect(remove.statusCode).toBe(404);
  expect(remove.json()).toMatchObject(expectedNotFound);
  expect(parseCommandId(remove.json())).toEqual(expect.any(String));
  const revoke = await revokeSessionsReq({ app, accountId: "a1", userId: "ghost", headers: { cookie: ownerCookie } });
  expect(revoke.statusCode).toBe(404);
  expect(revoke.json()).toMatchObject(expectedNotFound);
  expect(parseCommandId(revoke.json())).toEqual(expect.any(String));
}

function registerRoleMutationErrorEnvelopeTest(): void {
  it("uses the normalized NOT_FOUND envelope for non-member mutations; 400 for a bad role", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-404@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    await assertMissingMemberMutationResponses(app, owner.cookie);
    const ed = await signUp(app, "ed-400@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: ed.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });
    expect(
      (
        await patchRoleReq({
          app,
          accountId: "a1",
          userId: ed.userId,
          role: "superuser",
          headers: {
            cookie: owner.cookie,
          },
        })
      ).statusCode,
    ).toBe(400);
  });
}

describe("PATCH /api/accounts/:id/members/:userId — role change", () => {
  registerAdminRoleChangeTest();
  registerOwnerRoleGrantRejectionTest();
  registerOwnerDemotionRejectionTest();
  registerOwnerOrdinaryRoleManagementTest();
  registerRoleMutationErrorEnvelopeTest();
});

function registerOwnerDemotionProtectionTest(): void {
  it("the Owner cannot be demoted through the generic role endpoint", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "sole-owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    expect(
      (
        await patchRoleReq({
          app,
          accountId: "a1",
          userId: owner.userId,
          role: "editor",
          headers: {
            cookie: owner.cookie,
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(getMemberRole(db, "a1", owner.userId)).toBe("owner");
  });
}

function registerOwnerRemovalProtectionTest(): void {
  it("the Owner cannot be removed through the member endpoint", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "rm-sole@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    expect(
      (await removeReq({ app, accountId: "a1", userId: owner.userId, headers: { cookie: owner.cookie } })).statusCode,
    ).toBe(403);
  });
}

function registerDuplicateOwnerProtectionTest(): void {
  it("the database refuses a second active Owner", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "self-demote@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const owner2 = await signUp(app, "second-owner-constraint@capacitylens.dev");
    expect(() =>
      upsertMember(db, {
        accountId: "a1",
        userId: owner2.userId,
        role: "owner",
        status: "active",
        createdAt: TS,
      }),
    ).toThrow(/unique/i);
    expect(getMemberRole(db, "a1", owner.userId)).toBe("owner");
  });
}

describe("exactly-one-Owner protection", () => {
  registerOwnerDemotionProtectionTest();
  registerOwnerRemovalProtectionTest();
  registerDuplicateOwnerProtectionTest();
});

function registerAdminMemberRemovalTest(): void {
  it("admin cannot remove an owner → 403; admin removes an editor → 204", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const admin = await signUp(app, "admin-rm@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: admin.userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });
    const owner = await signUp(app, "owner-rm@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const ed = await signUp(app, "ed-rm@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: ed.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });

    expect(
      (await removeReq({ app, accountId: "a1", userId: owner.userId, headers: { cookie: admin.cookie } })).statusCode,
    ).toBe(403);
    expect(
      (await removeReq({ app, accountId: "a1", userId: ed.userId, headers: { cookie: admin.cookie } })).statusCode,
    ).toBe(204);
    expect(getMemberRole(db, "a1", ed.userId)).toBeNull();
  });
}

function registerLimitedMemberRemovalTest(): void {
  it("editor/viewer cannot remove anyone → 403", async () => {
    for (const role of ["editor", "viewer"] as const) {
      const { app, db } = await appWithAuth();
      seedTwo(db);
      const actor = await signUp(app, `${role}-rm@capacitylens.dev`);
      upsertMember(db, {
        accountId: "a1",
        userId: actor.userId,
        role,
        status: "active",
        createdAt: TS,
      });
      const ed = await signUp(app, `${role}-rm-target@capacitylens.dev`);
      upsertMember(db, {
        accountId: "a1",
        userId: ed.userId,
        role: "editor",
        status: "active",
        createdAt: TS,
      });
      expect(
        (await removeReq({ app, accountId: "a1", userId: ed.userId, headers: { cookie: actor.cookie } })).statusCode,
      ).toBe(403);
    }
  });
}

describe("DELETE /api/accounts/:id/members/:userId — revoke gate", () => {
  registerAdminMemberRemovalTest();
  registerLimitedMemberRemovalTest();
});

describe("GET /api/accounts/:id/invites — list omits the token", () => {
  it("lists invites without the bearer token; gate is manageInvites", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "inv-list-owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const created = await createInviteReq(app, { accountId: "a1", role: "editor" }, { cookie: owner.cookie });
    const token = (created.json() as { token: string }).token;

    const res = await invitesReq(app, "a1", { cookie: owner.cookie });
    expect(res.statusCode).toBe(200);
    // Assert the RAW body carries no token (not just the parsed objects).
    expect(res.body).not.toContain(token);
    const invites = (res.json() as { invites: Array<Record<string, unknown>> }).invites;
    expect(invites).toHaveLength(1);
    const invite = invites[0];
    if (!invite) throw new Error("Expected one invitation.");
    expect(invite).not.toHaveProperty("token");
    expect(invite.role).toBe("editor");
    expect(typeof invite.id).toBe("string");

    // editor of the account is denied (below manageInvites tier).
    const ed = await signUp(app, "inv-list-ed@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: ed.userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });
    expect((await invitesReq(app, "a1", { cookie: ed.cookie })).statusCode).toBe(403);
  });
});

describe("DELETE /api/accounts/:id/invites/:inviteId — revoke", () => {
  it("owner revokes an invite (204, idempotent); cross-tenant revoke is a no-op", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "inv-rev-owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    const created = await createInviteReq(app, { accountId: "a1", role: "editor" }, { cookie: owner.cookie });
    const token = (created.json() as { token: string }).token;
    const invite = getInvite(db, token);
    if (!invite) throw new Error("Expected the created invitation.");
    const inviteId = invite.id;

    // An admin of a DIFFERENT account (a2) cannot revoke a1's invite. The gate is on a2 here
    // (cross-tenant authorize → 403), the strongest guarantee.
    const otherOwner = await signUp(app, "a2-rev-owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a2",
      userId: otherOwner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });
    // a2 owner tries to revoke a1's invite VIA the a2 path (the accountId predicate makes it a no-op).
    expect(
      (
        await call(app, {
          method: "DELETE",
          url: `/api/accounts/a2/invites/${inviteId}`,
          headers: { cookie: otherOwner.cookie },
        })
      ).statusCode,
    ).toBe(204); // 204 but the row is NOT deleted (wrong accountId predicate)
    expect(getInvite(db, token)).not.toBeNull(); // still live

    // The real owner revokes it (204) and it's gone; a second revoke is still 204 (idempotent).
    expect(
      (
        await call(app, {
          method: "DELETE",
          url: `/api/accounts/a1/invites/${inviteId}`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(getInvite(db, token)).toBeNull();
    expect(
      (
        await call(app, {
          method: "DELETE",
          url: `/api/accounts/a1/invites/${inviteId}`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(204);
  });
});

describe("POST /api/invites — Owner is never invitational", () => {
  it("both Admin and Owner receive 400 for an Owner invite; ordinary roles still work", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const admin = await signUp(app, "inv-owner-admin@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: admin.userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });
    const owner = await signUp(app, "inv-owner-owner@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId: owner.userId,
      role: "owner",
      status: "active",
      createdAt: TS,
    });

    expect((await createInviteReq(app, { accountId: "a1", role: "owner" }, { cookie: admin.cookie })).statusCode).toBe(
      400,
    );
    expect((await createInviteReq(app, { accountId: "a1", role: "owner" }, { cookie: owner.cookie })).statusCode).toBe(
      400,
    );
    // An admin may still invite a non-owner role.
    expect((await createInviteReq(app, { accountId: "a1", role: "editor" }, { cookie: admin.cookie })).statusCode).toBe(
      201,
    );
  });
});

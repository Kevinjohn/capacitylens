import { describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { AuditEntry, AuditSink } from "./audit";
import { createAuthFromEnvironment, runAuthMigrations, SESSION_INACTIVITY_TTL_SECONDS } from "./auth";
import { createApp } from "./app";
import { upsertMember } from "./controlTables";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";
import { insertAll, openDb, type Db } from "./db";
import { PASSWORD_ENV, call, registerServerFixtureCleanup, signUp } from "./testHelpers";

const TS = "2026-09-01T10:00:00.000Z";
const { trackApp, trackDb } = registerServerFixtureCleanup();

function readJsonObject(response: LightMyRequestResponse): Record<string, unknown> {
  const value = response.json<unknown>();
  if (!isRecord(value)) {
    throw new TypeError("Expected response body to be a JSON object.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(response: LightMyRequestResponse, field: string): string {
  const value = readJsonObject(response)[field];
  if (typeof value !== "string") {
    throw new TypeError(`Expected response field ${field} to be a string.`);
  }
  return value;
}

function readBooleanField(response: LightMyRequestResponse, field: string): boolean {
  const value = readJsonObject(response)[field];
  if (typeof value !== "boolean") {
    throw new TypeError(`Expected response field ${field} to be a boolean.`);
  }
  return value;
}

function readObjectArrayField(response: LightMyRequestResponse, field: string): Record<string, unknown>[] {
  const value = readJsonObject(response)[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
    throw new TypeError(`Expected response field ${field} to be an array of objects.`);
  }
  return value;
}

function seedAccount(db: Db): void {
  const data = emptyAppData() as unknown as Record<string, unknown[]>;
  data.accounts = [
    {
      id: "a1",
      name: "Wayne Enterprises",
      color: "#3b82f6",
      createdAt: TS,
      updatedAt: TS,
    },
  ];
  insertAll(db, data as unknown as AppData);
}

function seedAdditionalAccount(db: Db, id: string, name: string): void {
  const data = emptyAppData() as unknown as Record<string, unknown[]>;
  data.accounts = [{ id, name, color: "#8b5cf6", createdAt: TS, updatedAt: TS }];
  insertAll(db, data as unknown as AppData);
}

async function fixture(options: { multiAccount?: boolean } = {}): Promise<{
  app: FastifyInstance;
  db: Db;
  auditEvents: AuditEntry[];
}> {
  const db = trackDb(openDb(":memory:"));
  const { mode, auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
  if (!auth) throw new Error("Password fixture requires an authentication service.");
  await runAuthMigrations(auth);
  const auditEvents: AuditEntry[] = [];
  const audit: AuditSink = {
    degraded: false,
    append: (event) => {
      auditEvents.push(event);
      return true;
    },
  };
  return { app: trackApp(createApp(db, { authMode: mode, auth, audit, ...options })), db, auditEvents };
}

async function memberFixture(
  actorRole: "owner" | "admin" | "editor" | "viewer" = "owner",
  options: { multiAccount?: boolean } = {},
) {
  const setup = await fixture(options);
  seedAccount(setup.db);
  const actor = await signUp(setup.app, `${actorRole}@capacitylens.dev`);
  const target = await signUp(setup.app, "viewer@capacitylens.dev");
  upsertMember(setup.db, {
    accountId: "a1",
    userId: actor.userId,
    role: actorRole,
    status: "active",
    createdAt: TS,
  });
  upsertMember(setup.db, {
    accountId: "a1",
    userId: target.userId,
    role: "viewer",
    status: "active",
    createdAt: TS,
  });
  return { ...setup, actor, target };
}

function registerProjectionStartTests(): void {
  it("starts an audited target projection and ends back at the real role", async () => {
    const { app, actor, target, auditEvents } = await memberFixture();
    const started = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      headers: { cookie: actor.cookie },
      payload: { targetUserId: target.userId },
    });

    expect(started.statusCode).toBe(200);
    const startedBody = readJsonObject(started);
    expect(startedBody).toMatchObject({
      accountId: "a1",
      targetUserId: target.userId,
      targetName: "Tester",
      effectiveRole: "viewer",
    });
    expect(typeof startedBody.token).toBe("string");
    expect(
      (await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } })).json(),
    ).toEqual([expect.objectContaining({ id: "a1", role: "viewer" })]);
    const startedEvent = auditEvents.find(
      (event) =>
        event.action === "identity.masquerade_started" &&
        "targetPrincipalId" in event &&
        event.targetPrincipalId === target.userId,
    );
    if (!startedEvent || !("expiresAt" in startedEvent)) {
      throw new TypeError("Expected masquerade start audit event with an expiry.");
    }
    expect(startedEvent).toMatchObject({
      action: "identity.masquerade_started",
      targetPrincipalId: target.userId,
    });
    expect(typeof startedEvent.expiresAt).toBe("string");

    const ended = await call(app, {
      method: "DELETE",
      url: "/api/masquerade",
      headers: { cookie: actor.cookie },
      payload: { token: readStringField(started, "token"), reason: "explicit" },
    });
    expect(ended.statusCode).toBe(204);
    expect(
      (await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } })).json(),
    ).toEqual([expect.objectContaining({ id: "a1", role: "owner" })]);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({ action: "identity.masquerade_ended", reason: "explicit" }),
    );
  });
}

function registerReadOnlyGuardTest(): void {
  it("blocks every unsafe request before domain validation while active", async () => {
    const { app, actor, target } = await memberFixture();
    const started = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      headers: { cookie: actor.cookie },
      payload: { targetUserId: target.userId },
    });
    expect(started.statusCode).toBe(200);

    const blocked = await call(app, {
      method: "POST",
      url: "/api/projects",
      headers: { cookie: actor.cookie },
      payload: {},
    });
    expect(blocked.statusCode).toBe(403);
    expect(readStringField(blocked, "code")).toBe("MASQUERADE_READ_ONLY");
  });
}

function registerStartGuardTests(): void {
  it("rejects replacement, self-targeting, inactive targets, and non-admin callers", async () => {
    const { app, db, actor, target } = await memberFixture();
    const first = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      headers: { cookie: actor.cookie },
      payload: { targetUserId: target.userId },
    });
    expect(first.statusCode).toBe(200);
    const replacement = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      headers: { cookie: actor.cookie },
      payload: { targetUserId: target.userId },
    });
    expect(replacement.statusCode).toBe(409);
    expect(readStringField(replacement, "code")).toBe("MASQUERADE_ACTIVE");

    await call(app, {
      method: "DELETE",
      url: "/api/masquerade",
      headers: { cookie: actor.cookie },
      payload: { token: readStringField(first, "token"), reason: "explicit" },
    });
    const self = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      headers: { cookie: actor.cookie },
      payload: { targetUserId: actor.userId },
    });
    expect(self.statusCode).toBe(400);

    db.prepare(`UPDATE account_members SET status = 'disabled' WHERE accountId = ? AND userId = ?`).run(
      "a1",
      target.userId,
    );
    const inactive = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      headers: { cookie: actor.cookie },
      payload: { targetUserId: target.userId },
    });
    expect(inactive.statusCode).toBe(404);

    const editor = await signUp(app, "editor@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: editor.userId, role: "editor", status: "active", createdAt: TS });
    const forbidden = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      headers: { cookie: editor.cookie },
      payload: { targetUserId: actor.userId },
    });
    expect(forbidden.statusCode).toBe(403);
  });
}

function registerTrustedLocalGuardTest(): void {
  it("keeps the feature unavailable in trusted-local mode", async () => {
    const db = trackDb(openDb(":memory:"));
    seedAccount(db);
    const app = trackApp(createApp(db));
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          payload: { targetUserId: "user-2" },
        })
      ).statusCode,
    ).toBe(403);
    expect((await call(app, { method: "GET", url: "/api/masquerade" })).statusCode).toBe(403);
  });
}

function registerInvalidationTests(): void {
  it("reprojects target role changes and ends without falling through when either member is invalidated", async () => {
    const { app, db, actor, target, auditEvents } = await memberFixture();
    const started = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      headers: { cookie: actor.cookie },
      payload: { targetUserId: target.userId },
    });
    expect(started.statusCode).toBe(200);

    db.prepare(`UPDATE account_members SET role = 'editor' WHERE accountId = ? AND userId = ?`).run(
      "a1",
      target.userId,
    );
    expect(
      (await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } })).json(),
    ).toEqual([expect.objectContaining({ role: "editor" })]);

    db.prepare(`UPDATE account_members SET status = 'disabled' WHERE accountId = ? AND userId = ?`).run(
      "a1",
      target.userId,
    );
    const invalidated = await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } });
    expect(invalidated.statusCode).toBe(403);
    expect(readStringField(invalidated, "code")).toBe("MASQUERADE_ENDED");
    expect(
      (await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } })).json(),
    ).toEqual([expect.objectContaining({ role: "owner" })]);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({ action: "identity.masquerade_ended", reason: "target_invalidated" }),
    );
  });

  it("ends on caller authority loss and serves the reduced real caller only on the next request", async () => {
    const { app, db, actor, target, auditEvents } = await memberFixture();
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          headers: { cookie: actor.cookie },
          payload: { targetUserId: target.userId },
        })
      ).statusCode,
    ).toBe(200);
    db.prepare(`UPDATE account_members SET role = 'editor' WHERE accountId = ? AND userId = ?`).run("a1", actor.userId);

    const invalidated = await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } });
    expect(invalidated.statusCode).toBe(403);
    expect(readStringField(invalidated, "code")).toBe("MASQUERADE_ENDED");
    expect(
      (await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } })).json(),
    ).toEqual([expect.objectContaining({ role: "editor" })]);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({ action: "identity.masquerade_ended", reason: "caller_invalidated" }),
    );
  });
}

function registerMembershipProjectionTests(): void {
  it("ends on caller membership removal before returning the remaining account list", async () => {
    const { app, db, actor, target, auditEvents } = await memberFixture();
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          headers: { cookie: actor.cookie },
          payload: { targetUserId: target.userId },
        })
      ).statusCode,
    ).toBe(200);
    db.prepare(`DELETE FROM account_members WHERE accountId = ? AND userId = ?`).run("a1", actor.userId);

    const invalidated = await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } });
    expect(invalidated.statusCode).toBe(403);
    expect(readStringField(invalidated, "code")).toBe("MASQUERADE_ENDED");
    expect(auditEvents).toContainEqual(
      expect.objectContaining({ action: "identity.masquerade_ended", reason: "caller_invalidated" }),
    );
  });

  it("projects member-directory identity and capabilities to the target principal", async () => {
    const { app, db, actor, target } = await memberFixture();
    db.prepare(`UPDATE account_members SET role = 'admin' WHERE accountId = ? AND userId = ?`).run("a1", target.userId);
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          headers: { cookie: actor.cookie },
          payload: { targetUserId: target.userId },
        })
      ).statusCode,
    ).toBe(200);

    const response = await call(app, {
      method: "GET",
      url: "/api/accounts/a1/members",
      headers: { cookie: actor.cookie },
    });
    expect(response.statusCode).toBe(200);
    const members = readObjectArrayField(response, "members");
    expect(members.find(({ userId }) => userId === target.userId)).toMatchObject({
      isSelf: true,
      mayResetPassword: true,
      mayRevokeSessions: true,
    });
    expect(members.find(({ userId }) => userId === actor.userId)).toMatchObject({
      isSelf: false,
      mayResetPassword: false,
      mayRevokeSessions: false,
    });
  });
}

function registerAccountProjectionTests(): void {
  it("confines the target role to the started account and keeps the caller's real role elsewhere", async () => {
    const { app, db, actor, target } = await memberFixture("owner", { multiAccount: true });
    seedAdditionalAccount(db, "a2", "Stark Industries");
    upsertMember(db, { accountId: "a2", userId: actor.userId, role: "admin", status: "active", createdAt: TS });
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          headers: { cookie: actor.cookie },
          payload: { targetUserId: target.userId },
        })
      ).statusCode,
    ).toBe(200);

    const accounts = (
      await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } })
    ).json() as Array<{ id: string; role: string }>;
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "a1", role: "viewer" }),
        expect.objectContaining({ id: "a2", role: "admin" }),
      ]),
    );
    expect(
      (await call(app, { method: "GET", url: "/api/state?accountId=a2", headers: { cookie: actor.cookie } }))
        .statusCode,
    ).toBe(200);
  });
}

function registerPrivateNameProjectionTest(): void {
  it("uses the target role for private-name redaction and restores the owner projection after end", async () => {
    const { app, db, actor, target } = await memberFixture();
    const data = emptyAppData() as unknown as Record<string, unknown[]>;
    data.clients = [
      {
        id: "private-client",
        accountId: "a1",
        name: "SENTINEL_REAL_CLIENT_NAME",
        color: "#3b82f6",
        isPrivate: true,
        codeName: "Nightwing",
        createdAt: TS,
        updatedAt: TS,
      },
    ];
    insertAll(db, data as unknown as AppData);
    const started = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      headers: { cookie: actor.cookie },
      payload: { targetUserId: target.userId },
    });

    const projected = await call(app, {
      method: "GET",
      url: "/api/state?accountId=a1",
      headers: { cookie: actor.cookie },
    });
    expect(projected.body).not.toContain("SENTINEL_REAL_CLIENT_NAME");
    expect(readObjectArrayField(projected, "clients")[0]).toMatchObject({ name: '"Nightwing"' });
    await call(app, {
      method: "DELETE",
      url: "/api/masquerade",
      headers: { cookie: actor.cookie },
      payload: { token: readStringField(started, "token"), reason: "explicit" },
    });
    expect(
      readObjectArrayField(
        await call(app, { method: "GET", url: "/api/state?accountId=a1", headers: { cookie: actor.cookie } }),
        "clients",
      )[0],
    ).toMatchObject({ name: "SENTINEL_REAL_CLIENT_NAME", codeName: "Nightwing" });
  });
}

function registerIdentityCapabilityTests(): void {
  it("reports canCreateAccount false while active", async () => {
    const { app, actor, target } = await memberFixture("owner", { multiAccount: true });
    const before = await call(app, { method: "GET", url: "/api/auth/me", headers: { cookie: actor.cookie } });
    expect(readBooleanField(before, "canCreateAccount")).toBe(true);
    const started = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      headers: { cookie: actor.cookie },
      payload: { targetUserId: target.userId },
    });
    expect(started.statusCode).toBe(200);
    expect(
      readBooleanField(
        await call(app, { method: "GET", url: "/api/auth/me", headers: { cookie: actor.cookie } }),
        "canCreateAccount",
      ),
    ).toBe(false);
  });

  it("ends and audits the exact session before custom sign-out destroys it", async () => {
    const { app, actor, target, auditEvents } = await memberFixture();
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          headers: { cookie: actor.cookie },
          payload: { targetUserId: target.userId },
        })
      ).statusCode,
    ).toBe(200);

    const signedOut = await call(app, {
      method: "POST",
      url: "/api/account/sign-out",
      headers: { cookie: actor.cookie },
    });
    expect(signedOut.statusCode).toBe(200);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({ action: "identity.masquerade_ended", reason: "sign_out" }),
    );
    expect(
      (await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } })).statusCode,
    ).toBe(401);
  });
}

function registerSessionRevocationTests(): void {
  it("ends and audits a masquerade when another owner revokes the caller's sessions", async () => {
    const { app, db, actor, target, auditEvents } = await memberFixture("admin");
    const owner = await signUp(app, "owner-revoker@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          headers: { cookie: actor.cookie },
          payload: { targetUserId: target.userId },
        })
      ).statusCode,
    ).toBe(200);

    const revoked = await call(app, {
      method: "POST",
      url: `/api/accounts/a1/members/${actor.userId}/revoke-sessions`,
      headers: { cookie: owner.cookie },
    });

    expect(revoked.statusCode).toBe(204);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({ action: "identity.masquerade_ended", reason: "session_revoked" }),
    );
    expect(
      (await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } })).statusCode,
    ).toBe(401);
  });

  it("audits Better Auth password-reset session revocation and removes the registry entry", async () => {
    const { app, db, actor, target, auditEvents } = await memberFixture("admin");
    const owner = await signUp(app, "owner-resetter@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          headers: { cookie: actor.cookie },
          payload: { targetUserId: target.userId },
        })
      ).statusCode,
    ).toBe(200);
    const minted = await call(app, {
      method: "POST",
      url: `/api/accounts/a1/members/${actor.userId}/reset-password`,
      headers: { cookie: owner.cookie },
    });
    expect(minted.statusCode).toBe(201);

    const reset = await call(app, {
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { token: readStringField(minted, "token"), newPassword: "brand-new-password-456" },
    });

    expect(reset.statusCode).toBe(200);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({ action: "identity.masquerade_ended", reason: "session_revoked" }),
    );
  });
}

function registerExpiryAndMutationGuardTests(): void {
  it("audits an inactivity-expired masquerade before the session is removed", async () => {
    const { app, db, actor, target, auditEvents } = await memberFixture();
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          headers: { cookie: actor.cookie },
          payload: { targetUserId: target.userId },
        })
      ).statusCode,
    ).toBe(200);
    const expiredActivity = new Date(Date.now() - (SESSION_INACTIVITY_TTL_SECONDS + 1) * 1000).toISOString();
    db.prepare(`UPDATE session SET updatedAt = ? WHERE userId = ?`).run(expiredActivity, actor.userId);

    expect(
      (await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } })).statusCode,
    ).toBe(401);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({ action: "identity.masquerade_ended", reason: "session_expired" }),
    );
  });

  it("applies the independent Better Auth mutation guard", async () => {
    const { app, actor, target } = await memberFixture();
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          headers: { cookie: actor.cookie },
          payload: { targetUserId: target.userId },
        })
      ).statusCode,
    ).toBe(200);
    const blocked = await call(app, {
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: actor.cookie },
      payload: {},
    });
    expect(blocked.statusCode).toBe(403);
    expect(readStringField(blocked, "code")).toBe("MASQUERADE_READ_ONLY");
  });
}

function registerOwnershipTransferConcealmentTest(): void {
  // The global policy refuses every unsafe method, so the ceremony's six commands are already
  // covered. The READ is not, and it names who is being handed the company — so it conceals rather
  // than redacts: a masquerading session is not the participant whose ceremony this is.
  it("refuses the ownership transfer read while masquerading, and admits it otherwise", async () => {
    const { app, db } = await fixture();
    seedAccount(db);
    const owner = await signUp(app, "owner@capacitylens.dev");
    const admin = await signUp(app, "admin@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    upsertMember(db, { accountId: "a1", userId: admin.userId, role: "admin", status: "active", createdAt: TS });

    const read = () =>
      call(app, { method: "GET", url: "/api/accounts/a1/ownership-transfer", headers: { cookie: owner.cookie } });
    expect((await read()).statusCode).toBe(200);

    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts/a1/masquerade",
          headers: { cookie: owner.cookie },
          payload: { targetUserId: admin.userId },
        })
      ).statusCode,
    ).toBe(200);
    const concealed = await read();
    expect(concealed.statusCode).toBe(403);
    expect(readStringField(concealed, "code")).toBe("MASQUERADE_READ_ONLY");
  });
}

describe("identity masquerade", () => {
  registerProjectionStartTests();
  registerReadOnlyGuardTest();
  registerStartGuardTests();
  registerTrustedLocalGuardTest();
  registerInvalidationTests();
  registerMembershipProjectionTests();
  registerAccountProjectionTests();
  registerPrivateNameProjectionTest();
  registerIdentityCapabilityTests();
  registerSessionRevocationTests();
  registerExpiryAndMutationGuardTests();
  registerOwnershipTransferConcealmentTest();
});

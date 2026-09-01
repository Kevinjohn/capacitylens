import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AuditEntry, AuditSink } from "./audit";
import { authFromEnv, runAuthMigrations } from "./auth";
import { buildApp } from "./app";
import { upsertMember } from "./controlTables";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";
import { insertAll, openDb, type Db } from "./db";
import { PASSWORD_ENV, call, registerServerFixtureCleanup, signUp } from "./testHelpers";

const TS = "2026-09-01T10:00:00.000Z";
const { trackApp, trackDb } = registerServerFixtureCleanup();

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

async function fixture(options: { multiAccount?: boolean } = {}): Promise<{
  app: FastifyInstance;
  db: Db;
  auditEvents: AuditEntry[];
}> {
  const db = trackDb(openDb(":memory:"));
  const { mode, auth } = authFromEnv(db, PASSWORD_ENV);
  await runAuthMigrations(auth!);
  const auditEvents: AuditEntry[] = [];
  const audit: AuditSink = {
    degraded: false,
    append: (event) => {
      auditEvents.push(event);
      return true;
    },
  };
  return { app: trackApp(buildApp(db, { authMode: mode, auth, audit, ...options })), db, auditEvents };
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

describe("identity masquerade", () => {
  it("starts an audited target projection and ends back at the real role", async () => {
    const { app, actor, target, auditEvents } = await memberFixture();
    const started = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      headers: { cookie: actor.cookie },
      payload: { targetUserId: target.userId },
    });

    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({
      accountId: "a1",
      targetUserId: target.userId,
      targetName: "Tester",
      effectiveRole: "viewer",
      token: expect.any(String),
    });
    expect(
      (await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } })).json(),
    ).toEqual([expect.objectContaining({ id: "a1", role: "viewer" })]);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        action: "identity.masquerade_started",
        targetPrincipalId: target.userId,
        expiresAt: expect.any(String),
      }),
    );

    const ended = await call(app, {
      method: "DELETE",
      url: "/api/masquerade",
      headers: { cookie: actor.cookie },
      payload: { token: started.json().token, reason: "explicit" },
    });
    expect(ended.statusCode).toBe(204);
    expect(
      (await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } })).json(),
    ).toEqual([expect.objectContaining({ id: "a1", role: "owner" })]);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({ action: "identity.masquerade_ended", reason: "explicit" }),
    );
  });

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
    expect(blocked.json().code).toBe("MASQUERADE_READ_ONLY");
  });

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
    expect(replacement.json().code).toBe("MASQUERADE_ACTIVE");

    await call(app, {
      method: "DELETE",
      url: "/api/masquerade",
      headers: { cookie: actor.cookie },
      payload: { token: first.json().token, reason: "explicit" },
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

  it("keeps the feature unavailable in trusted-local mode", async () => {
    const db = trackDb(openDb(":memory:"));
    seedAccount(db);
    const app = trackApp(buildApp(db));
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
    expect(invalidated.json().code).toBe("MASQUERADE_ENDED");
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
    expect(invalidated.json().code).toBe("MASQUERADE_ENDED");
    expect(
      (await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: actor.cookie } })).json(),
    ).toEqual([expect.objectContaining({ role: "editor" })]);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({ action: "identity.masquerade_ended", reason: "caller_invalidated" }),
    );
  });

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
    expect(invalidated.json().code).toBe("MASQUERADE_ENDED");
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
    const members = response.json().members as Array<{
      userId: string;
      isSelf: boolean;
      mayResetPassword: boolean;
      mayRevokeSessions: boolean;
    }>;
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

  it("reports canCreateAccount false while active", async () => {
    const { app, actor, target } = await memberFixture("owner", { multiAccount: true });
    const before = await call(app, { method: "GET", url: "/api/auth/me", headers: { cookie: actor.cookie } });
    expect(before.json().canCreateAccount).toBe(true);
    const started = await call(app, {
      method: "POST",
      url: "/api/accounts/a1/masquerade",
      headers: { cookie: actor.cookie },
      payload: { targetUserId: target.userId },
    });
    expect(started.statusCode).toBe(200);
    expect(
      (await call(app, { method: "GET", url: "/api/auth/me", headers: { cookie: actor.cookie } })).json()
        .canCreateAccount,
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
    expect(blocked.json().code).toBe("MASQUERADE_READ_ONLY");
  });
});

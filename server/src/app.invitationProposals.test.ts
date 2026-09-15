import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp as buildAppRaw } from "./app";
import { openDb as openDbRaw, insertAll, type Db } from "./db";
import { createAuthFromEnvironment, DEMO_USER, runAuthMigrations } from "./auth";
import { getInvite, getMemberRole, upsertMember } from "./controlTables";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";
import { PASSWORD_ENV, call, readCookies, registerServerFixtureCleanup, signUp } from "./testHelpers";

const TS = "2026-01-01T00:00:00.000Z";
const fixtures = registerServerFixtureCleanup();
const openDb = (...args: Parameters<typeof openDbRaw>) => fixtures.trackDb(openDbRaw(...args));
const buildApp = (...args: Parameters<typeof buildAppRaw>) => fixtures.trackApp(buildAppRaw(...args));

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

function readObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected response object");
  return value as Record<string, unknown>;
}

function readResponseString(response: Awaited<ReturnType<typeof call>>, key: string): string {
  const value = readObject(response.json())[key];
  if (typeof value !== "string") throw new Error(`Expected response.${key} to be a string`);
  return value;
}

function seedOne(db: Db): void {
  const data = emptyAppData() as unknown as Record<string, unknown[]>;
  data.accounts = [{ id: "a1", name: "Studio a1", color: "#3b82f6", createdAt: TS, updatedAt: TS }];
  insertAll(db, data as unknown as AppData);
}

function seedPerson(db: Db, id = "person-clark"): void {
  db.prepare(
    `INSERT INTO resources
      (id, accountId, kind, name, role, color, employmentType, engagement,
       workingHoursPerDay, workingDays, halfDays, createdAt, updatedAt)
     VALUES (?, 'a1', 'person', 'Clark Kent', 'Developer', '#3b82f6', 'employee', 'studio', 8, '[1,2,3,4,5]', '[]', ?, ?)`,
  ).run(id, TS, TS);
}

async function appWithAuth(): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(":memory:");
  const { mode, auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
  const requiredAuth = requireValue(auth, "password authentication");
  await runAuthMigrations(requiredAuth);
  return { app: buildApp(db, { authMode: mode, auth: requiredAuth }), db };
}

async function closedSignupProposalContext(): Promise<{ app: FastifyInstance; db: Db; token: string }> {
  const db = openDb(":memory:");
  const { mode, auth } = createAuthFromEnvironment(db, {
    ...PASSWORD_ENV,
    CAPACITYLENS_ALLOW_OPEN_SIGNUP: undefined,
    CAPACITYLENS_SETUP_TOKEN: "test-setup-token-0123456789abcdef",
  });
  const requiredAuth = requireValue(auth, "password authentication");
  await runAuthMigrations(requiredAuth);
  const inviter = await requiredAuth.createCredentialUser({
    email: "proposal-signup-owner@capacitylens.dev",
    name: "Inviter",
    password: "password-123456",
  });
  const app = buildApp(db, { authMode: mode, auth: requiredAuth });
  seedOne(db);
  seedPerson(db, "person-signup");
  upsertMember(db, { accountId: "a1", userId: inviter.id, role: "owner", status: "active", createdAt: TS });
  const signedIn = await call(app, {
    method: "POST",
    url: "/api/auth/sign-in/email",
    payload: { email: "proposal-signup-owner@capacitylens.dev", password: "password-123456" },
  });
  const created = await createInvite(
    app,
    {
      accountId: "a1",
      role: "editor",
      preauthEmail: "proposal-signup@capacitylens.dev",
      proposedResourceId: "person-signup",
    },
    readCookies(signedIn),
  );
  return { app, db, token: readResponseString(created, "token") };
}

// eslint-disable-next-line max-params
async function createInvite(
  app: FastifyInstance,
  payload: Record<string, unknown>,
  cookie: string,
  commandId?: string,
) {
  return call(app, {
    method: "POST",
    url: "/api/invites",
    payload,
    headers: {
      cookie,
      ...(commandId ? { "idempotency-key": `${commandId}-key`, "x-account-command-id": commandId } : {}),
    },
  });
}

// eslint-disable-next-line max-lines-per-function
describe("invitation person proposal route admission", () => {
  // eslint-disable-next-line max-lines-per-function
  it("creates/replays proposals, retains labels, and settles through admission without public leakage", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    seedPerson(db);
    const owner = await signUp(app, "proposal-owner@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    const payload = { accountId: "a1", role: "editor", proposedResourceId: "person-clark" };
    const first = await createInvite(app, payload, owner.cookie, "proposal-route-command-01");
    expect(first.statusCode).toBe(201);
    expect(readObject(first.json())).toMatchObject({ proposedResourceId: "person-clark" });
    const replay = await createInvite(app, payload, owner.cookie, "proposal-route-command-01");
    expect(replay.statusCode).toBe(201);
    expect(readObject(replay.json())).toEqual(readObject(first.json()));
    const changed = await call(app, {
      method: "POST",
      url: "/api/invites",
      payload: { ...payload, proposedResourceId: "person-other" },
      headers: {
        cookie: owner.cookie,
        "idempotency-key": "proposal-route-command-01-key",
        "x-account-command-id": "proposal-route-command-01",
      },
    });
    expect(changed.statusCode).toBe(409);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM account_member_resources`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invitation_person_proposals`).get()).toEqual({ count: 1 });

    const second = await createInvite(app, payload, owner.cookie, "proposal-route-command-02");
    expect(second.statusCode).toBe(201);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invitation_person_proposals`).get()).toEqual({ count: 2 });
    const listed = await call(app, {
      method: "GET",
      url: "/api/accounts/a1/invites",
      headers: { cookie: owner.cookie },
    });
    expect(readObject(listed.json()).invites).toEqual(
      expect.arrayContaining([expect.objectContaining({ proposedResourceLabel: "Clark Kent" })]),
    );

    const token = readResponseString(first, "token");
    const invitee = await signUp(app, "proposal-invitee@capacitylens.dev");
    const preview = await call(app, { method: "GET", url: `/api/invites/${token}/preview` });
    expect(JSON.stringify(preview.json())).not.toContain("person-clark");
    const accepted = await call(app, {
      method: "POST",
      url: `/api/invites/${token}/accept`,
      headers: { cookie: invitee.cookie },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ accountId: "a1", role: "editor" });
    expect(JSON.stringify(accepted.json())).not.toContain("person-clark");
    expect(db.prepare(`SELECT resourceId FROM account_member_resources WHERE userId = ?`).get(invitee.userId)).toEqual({
      resourceId: "person-clark",
    });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invitation_person_proposals`).get()).toEqual({ count: 1 });
    const afterClaim = await call(app, {
      method: "GET",
      url: "/api/accounts/a1/invites",
      headers: { cookie: owner.cookie },
    });
    expect(readObject(afterClaim.json()).invites).toEqual(
      expect.arrayContaining([expect.objectContaining({ proposedResourceLabel: "Clark Kent" })]),
    );
  });

  it("settles proposals through the password-signup child transaction without public resource state", async () => {
    const { app, db, token } = await closedSignupProposalContext();
    const signup = await call(app, {
      method: "POST",
      url: `/api/invites/${token}/signup`,
      payload: { email: "proposal-signup@capacitylens.dev", name: "New Person", password: "password-123456" },
    });
    expect(signup.statusCode).toBe(201);
    expect(JSON.stringify(signup.json())).not.toContain("person-signup");
    const signedIn = await call(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "proposal-signup@capacitylens.dev", password: "password-123456" },
    });
    const me = await call(app, { method: "GET", url: "/api/auth/me", headers: { cookie: readCookies(signedIn) } });
    const userIdValue = readObject(readObject(me.json()).user).id;
    if (typeof userIdValue !== "string") throw new Error("Expected signed-in user id");
    const userId = userIdValue;
    expect(db.prepare(`SELECT resourceId FROM account_member_resources WHERE userId = ?`).get(userId)).toEqual({
      resourceId: "person-signup",
    });
  });

  it("settles proposals through trusted/off-mode admission without exposing resource state", async () => {
    const db = openDb(":memory:");
    const app = buildApp(db);
    seedOne(db);
    seedPerson(db, "person-off-mode");
    const created = await createInvite(
      app,
      { accountId: "a1", role: "editor", proposedResourceId: "person-off-mode" },
      "",
    );
    expect(created.statusCode).toBe(201);
    const token = readResponseString(created, "token");
    const accepted = await call(app, { method: "POST", url: `/api/invites/${token}/accept` });
    expect(accepted.statusCode).toBe(200);
    expect(JSON.stringify(accepted.json())).not.toContain("person-off-mode");
    expect(getMemberRole(db, "a1", DEMO_USER.id)).toBe("editor");
    expect(db.prepare(`SELECT resourceId FROM account_member_resources WHERE userId = ?`).get(DEMO_USER.id)).toEqual({
      resourceId: "person-off-mode",
    });
  });

  it("rolls back membership, invite use, and proposal on unknown association storage failure", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    seedPerson(db);
    const owner = await signUp(app, "proposal-rollback-owner@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    const created = await createInvite(
      app,
      { accountId: "a1", role: "editor", proposedResourceId: "person-clark" },
      owner.cookie,
    );
    const token = readResponseString(created, "token");
    db.exec(`
      CREATE TRIGGER proposal_writer_failure
      BEFORE INSERT ON account_member_resources
      BEGIN SELECT RAISE(ABORT, 'injected proposal writer failure'); END;
    `);
    const invitee = await signUp(app, "proposal-rollback-invitee@capacitylens.dev");
    const accepted = await call(app, {
      method: "POST",
      url: `/api/invites/${token}/accept`,
      headers: { cookie: invitee.cookie },
    });
    expect(accepted.statusCode).toBe(500);
    expect(getMemberRole(db, "a1", invitee.userId)).toBeNull();
    expect(requireValue(getInvite(db, token), "invite").usedAt).toBeNull();
    expect(db.prepare(`SELECT COUNT(*) AS count FROM account_member_resources`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invitation_person_proposals`).get()).toEqual({ count: 1 });
  });

  it("rolls back admission when exception persistence hits an integrity failure", async () => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    seedPerson(db);
    const owner = await signUp(app, "proposal-exception-rollback-owner@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    db.prepare(
      `INSERT INTO account_member_resources (accountId, userId, resourceId, revision, createdAt, updatedAt)
       VALUES ('a1', ?, 'person-clark', 'existing-revision', ?, ?)`,
    ).run(owner.userId, TS, TS);
    const created = await createInvite(
      app,
      { accountId: "a1", role: "editor", proposedResourceId: "person-clark" },
      owner.cookie,
    );
    const token = readResponseString(created, "token");
    db.exec(`
      CREATE TRIGGER proposal_exception_failure
      BEFORE INSERT ON member_resource_link_exceptions
      BEGIN SELECT RAISE(ABORT, 'injected exception persistence failure'); END;
    `);
    const invitee = await signUp(app, "proposal-exception-rollback-invitee@capacitylens.dev");
    const accepted = await call(app, {
      method: "POST",
      url: `/api/invites/${token}/accept`,
      headers: { cookie: invitee.cookie },
    });
    expect(accepted.statusCode).toBe(500);
    expect(getMemberRole(db, "a1", invitee.userId)).toBeNull();
    expect(requireValue(getInvite(db, token), "invite").usedAt).toBeNull();
    expect(db.prepare(`SELECT COUNT(*) AS count FROM member_resource_link_exceptions`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invitation_person_proposals`).get()).toEqual({ count: 1 });
  });

  it.each([
    ["resource occupied", "person-occupied", "resource_already_linked"],
    ["member already linked", "person-member-linked", "member_already_linked"],
    ["resource unavailable", "person-unavailable", "resource_unavailable"],
  ] as const)("admits a proposal with bounded %s outcome", async (_label, resourceId, reason) => {
    const { app, db } = await appWithAuth();
    seedOne(db);
    seedPerson(db, resourceId);
    const owner = await signUp(app, `${resourceId}-owner@capacitylens.dev`);
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    const targetKind = reason === "member_already_linked" ? "linked" : "invitee";
    const target = await signUp(app, `${resourceId}-${targetKind}@capacitylens.dev`);
    const targetUserId = target.userId;
    if (reason === "member_already_linked") {
      upsertMember(db, { accountId: "a1", userId: targetUserId, role: "editor", status: "active", createdAt: TS });
      db.prepare(
        `INSERT INTO account_member_resources (accountId, userId, resourceId, revision, createdAt, updatedAt)
         VALUES ('a1', ?, 'person-other', 'existing-revision', ?, ?)`,
      ).run(targetUserId, TS, TS);
    } else if (reason === "resource_already_linked") {
      db.prepare(
        `INSERT INTO account_member_resources (accountId, userId, resourceId, revision, createdAt, updatedAt)
         VALUES ('a1', ?, ?, 'existing-revision', ?, ?)`,
      ).run(owner.userId, resourceId, TS, TS);
    }
    const created = await createInvite(
      app,
      { accountId: "a1", role: "editor", proposedResourceId: resourceId },
      owner.cookie,
    );
    const token = readResponseString(created, "token");
    if (reason === "resource_unavailable")
      db.prepare(`UPDATE resources SET archivedAt = ? WHERE id = ?`).run(TS, resourceId);
    const accepted = await call(app, {
      method: "POST",
      url: `/api/invites/${token}/accept`,
      headers: { cookie: target.cookie },
    });
    expect(accepted.statusCode).toBe(200);
    expect(getMemberRole(db, "a1", targetUserId)).toBe("editor");
    expect(
      db
        .prepare(`SELECT reason FROM member_resource_link_exceptions WHERE accountId = 'a1' AND userId = ?`)
        .get(targetUserId),
    ).toEqual({ reason });
  });
});

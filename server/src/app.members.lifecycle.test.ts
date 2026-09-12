import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app";
import { openDb, insertAll, type Db } from "./db";
import { upsertMember, getMemberRole, getInvite } from "./controlTables";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { PASSWORD_ENV, call, readCookies, signUp } from "./testHelpers";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";

const TS = "2026-01-01T00:00:00.000Z";
const meta = () => ({ createdAt: TS, updatedAt: TS });
const account = (id: string) => ({
  id,
  name: `Studio ${id}`,
  color: "#3b82f6",
  ...meta(),
});

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

interface PatchStatusReqInput {
  app: FastifyInstance;
  accountId: string;
  userId: string;
  status: unknown;
  headers?: Record<string, string> | undefined;
}

// ── Member lifecycle: disable / archive / restore (#175) ──────────────────────────────────────
// A membership's status is what every authorization read narrows on, so these routes are an access
// control surface, not a labelling one. The assertions below fix BOTH halves: the status actually
// changes, AND the account stops admitting the member the moment it does.

const patchStatusReq = ({ app, accountId, userId, status, headers = {} }: PatchStatusReqInput) =>
  call(app, {
    method: "PATCH",
    url: `/api/accounts/${accountId}/members/${userId}/status`,
    payload: { status },
    headers,
  });

const storedStatus = (db: Db, accountId: string, userId: string): string | undefined =>
  (
    db.prepare(`SELECT status FROM account_members WHERE accountId = ? AND userId = ?`).get(accountId, userId) as
      { status: string } | undefined
  )?.status;

interface SignInDirectory {
  signInTrackingEnabled: boolean;
  members: Array<{ userId: string; signInConfirmed: boolean | null }>;
}

async function readSignInDirectory(
  app: FastifyInstance,
  cookie: string,
  expectedStatus?: number,
): Promise<SignInDirectory> {
  const response = await membersReq(app, "a1", { cookie });
  if (expectedStatus !== undefined) expect(response.statusCode).toBe(expectedStatus);
  return response.json() as SignInDirectory;
}

interface SignInScenarioInput {
  app: FastifyInstance;
  db: Db;
  ownerCookie: string;
  editorCookie: string;
  ownerId: string;
  editorId: string;
  editorEmail: string;
}

async function assertSignInTrackingDefaults({
  app,
  ownerCookie,
  editorCookie,
  ownerId,
  editorId,
}: SignInScenarioInput) {
  const initial = await readSignInDirectory(app, ownerCookie, 200);
  expect(initial.signInTrackingEnabled).toBe(false);
  expect(initial.members.find((member) => member.userId === ownerId)?.signInConfirmed).toBeNull();
  expect(initial.members.find((member) => member.userId === editorId)?.signInConfirmed).toBeNull();
  expect(
    (await memberSignInTrackingReq({ app, accountId: "a1", enabled: true, headers: { cookie: editorCookie } }))
      .statusCode,
  ).toBe(403);
  expect(
    (await memberSignInTrackingReq({ app, accountId: "a1", enabled: "true", headers: { cookie: ownerCookie } }))
      .statusCode,
  ).toBe(400);
}

async function enableAndConfirmMemberSignIn({
  app,
  ownerCookie,
  ownerId,
  editorId,
  editorEmail,
}: SignInScenarioInput): Promise<void> {
  const enabled = await memberSignInTrackingReq({
    app,
    accountId: "a1",
    enabled: true,
    headers: { cookie: ownerCookie },
  });
  expect(enabled.statusCode).toBe(200);
  expect(enabled.json()).toEqual({ enabled: true });
  let directory = await readSignInDirectory(app, ownerCookie);
  expect(directory.signInTrackingEnabled).toBe(true);
  expect(directory.members.find((member) => member.userId === ownerId)?.signInConfirmed).toBe(true);
  expect(directory.members.find((member) => member.userId === editorId)?.signInConfirmed).toBe(false);

  const signedIn = await call(app, {
    method: "POST",
    url: "/api/auth/sign-in/email",
    payload: { email: editorEmail, password: "password-123456" },
  });
  expect(signedIn.statusCode).toBe(200);
  expect(readCookies(signedIn)).not.toBe("");
  directory = await readSignInDirectory(app, ownerCookie);
  expect(directory.members.find((member) => member.userId === editorId)?.signInConfirmed).toBe(true);
}

async function assertMemberSignInResetAndMfa({
  app,
  db,
  ownerCookie,
  editorId,
  editorEmail,
}: SignInScenarioInput): Promise<void> {
  expect(
    (await revokeSessionsReq({ app, accountId: "a1", userId: editorId, headers: { cookie: ownerCookie } })).statusCode,
  ).toBe(204);
  let directory = await readSignInDirectory(app, ownerCookie);
  expect(directory.members.find((member) => member.userId === editorId)?.signInConfirmed).toBe(false);

  db.prepare("UPDATE user SET twoFactorEnabled = 1 WHERE id = ?").run(editorId);
  const awaitingMfa = await call(app, {
    method: "POST",
    url: "/api/auth/sign-in/email",
    payload: { email: editorEmail, password: "password-123456" },
  });
  expect(awaitingMfa.statusCode).toBe(200);
  expect(awaitingMfa.json()).toMatchObject({ twoFactorRedirect: true });
  directory = await readSignInDirectory(app, ownerCookie);
  expect(directory.members.find((member) => member.userId === editorId)?.signInConfirmed).toBe(false);

  expect(
    (await memberSignInTrackingReq({ app, accountId: "a1", enabled: false, headers: { cookie: ownerCookie } }))
      .statusCode,
  ).toBe(200);
  expect(db.prepare("SELECT signInConfirmed FROM account_members WHERE accountId = 'a1'").all()).toEqual([
    { signInConfirmed: null },
    { signInConfirmed: null },
  ]);
}

/** Owner of a1 plus one editor, the shape nearly every case below needs. */
async function ownerAndEditor(suffix: string) {
  const { app, db } = await appWithAuth();
  seedTwo(db);
  const owner = await signUp(app, `owner-${suffix}@capacitylens.dev`);
  upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
  const ed = await signUp(app, `editor-${suffix}@capacitylens.dev`);
  upsertMember(db, { accountId: "a1", userId: ed.userId, role: "editor", status: "active", createdAt: TS });
  return { app, db, owner, ed };
}

function createDisableMemberTest(): void {
  it("disables a member, and the disabled member can no longer enter the account", async () => {
    const { app, db, owner, ed } = await ownerAndEditor("disable");
    // Precondition: the editor can read a1 today.
    expect(
      (await call(app, { method: "GET", url: "/api/state?accountId=a1", headers: { cookie: ed.cookie } })).statusCode,
    ).toBe(200);

    const res = await patchStatusReq({
      app,
      accountId: "a1",
      userId: ed.userId,
      status: "disabled",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: ed.userId, status: "disabled" });
    expect(storedStatus(db, "a1", ed.userId)).toBe("disabled");

    // THE POINT: the membership row survives, but it confers nothing.
    expect(
      (await call(app, { method: "GET", url: "/api/state?accountId=a1", headers: { cookie: ed.cookie } })).statusCode,
    ).toBe(403);
    // ...and a1 disappears from the account list the member can choose between.
    const accounts = await call(app, { method: "GET", url: "/api/accounts", headers: { cookie: ed.cookie } });
    expect(accounts.statusCode).toBe(200);
    expect(JSON.stringify(accounts.json())).not.toContain("a1");
  });
}

function createArchiveMemberTest(): void {
  it("archives a member and denies entry exactly as disabling does", async () => {
    const { app, db, owner, ed } = await ownerAndEditor("archive");
    expect(
      (
        await patchStatusReq({
          app,
          accountId: "a1",
          userId: ed.userId,
          status: "archived",
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(storedStatus(db, "a1", ed.userId)).toBe("archived");
    expect(
      (await call(app, { method: "GET", url: "/api/state?accountId=a1", headers: { cookie: ed.cookie } })).statusCode,
    ).toBe(403);
  });
}

function createRestoreMemberTest(): void {
  it("restores a disabled member to active, and their role is preserved throughout", async () => {
    const { app, db, owner, ed } = await ownerAndEditor("restore");
    await patchStatusReq({
      app,
      accountId: "a1",
      userId: ed.userId,
      status: "disabled",
      headers: { cookie: owner.cookie },
    });
    expect(getMemberRole(db, "a1", ed.userId)).toBe("editor"); // role survives the suspension

    expect(
      (
        await patchStatusReq({
          app,
          accountId: "a1",
          userId: ed.userId,
          status: "active",
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(storedStatus(db, "a1", ed.userId)).toBe("active");
    expect(
      (await call(app, { method: "GET", url: "/api/state?accountId=a1", headers: { cookie: ed.cookie } })).statusCode,
    ).toBe(200);
  });
}

function createVisibleInactiveMemberTest(): void {
  it("keeps a non-active member VISIBLE in the directory, so an admin can reverse it", async () => {
    const { app, owner, ed } = await ownerAndEditor("visible");
    await patchStatusReq({
      app,
      accountId: "a1",
      userId: ed.userId,
      status: "disabled",
      headers: { cookie: owner.cookie },
    });

    const res = await membersReq(app, "a1", { cookie: owner.cookie });
    expect(res.statusCode).toBe(200);
    const members = (res.json() as { members: Array<{ userId: string; status: string; role: string }> }).members;
    const row = members.find((m) => m.userId === ed.userId);
    // An invisible non-active member would be an unreversible one — the admin needs the row to act on.
    if (!row) throw new Error("Expected the disabled member row.");
    expect(row.status).toBe("disabled");
    expect(row.role).toBe("editor");
  });
}

function createOwnerDisableRejectionTest(): void {
  it("refuses to disable the OWNER — the account must never be left without one", async () => {
    const { app, db, owner, ed } = await ownerAndEditor("owner-target");
    upsertMember(db, { accountId: "a1", userId: ed.userId, role: "admin", status: "active", createdAt: TS });
    // Even an admin acting within their tier cannot disable the owner; the single-active-owner index
    // and the boot assertion both key on role='owner' AND status='active'.
    expect(
      (
        await patchStatusReq({
          app,
          accountId: "a1",
          userId: owner.userId,
          status: "disabled",
          headers: { cookie: ed.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(storedStatus(db, "a1", owner.userId)).toBe("active");
  });
}

function createSelfDisableRejectionTest(): void {
  it("refuses SELF-suspension — an admin must not be able to lock themselves out", async () => {
    const { app, db, owner } = await ownerAndEditor("self");
    expect(
      (
        await patchStatusReq({
          app,
          accountId: "a1",
          userId: owner.userId,
          status: "disabled",
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(storedStatus(db, "a1", owner.userId)).toBe("active");
  });
}

function createLimitedStatusMutationRejectionTest(): void {
  it("editor and viewer cannot change any member's status", async () => {
    for (const role of ["editor", "viewer"] as const) {
      const { app, db } = await appWithAuth();
      seedTwo(db);
      const owner = await signUp(app, `owner-${role}-status@capacitylens.dev`);
      upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
      const actor = await signUp(app, `${role}-status@capacitylens.dev`);
      upsertMember(db, { accountId: "a1", userId: actor.userId, role, status: "active", createdAt: TS });
      const target = await signUp(app, `target-${role}-status@capacitylens.dev`);
      upsertMember(db, { accountId: "a1", userId: target.userId, role: "editor", status: "active", createdAt: TS });

      expect(
        (
          await patchStatusReq({
            app,
            accountId: "a1",
            userId: target.userId,
            status: "disabled",
            headers: { cookie: actor.cookie },
          })
        ).statusCode,
        role,
      ).toBe(403);
      expect(storedStatus(db, "a1", target.userId), role).toBe("active");
    }
  });
}

function createCrossTenantStatusMutationTest(): void {
  it("cross-tenant: an owner of a1 cannot disable a member of a2", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const a1owner = await signUp(app, "a1owner-status@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: a1owner.userId, role: "owner", status: "active", createdAt: TS });
    const a2member = await signUp(app, "a2member-status@capacitylens.dev");
    upsertMember(db, { accountId: "a2", userId: a2member.userId, role: "editor", status: "active", createdAt: TS });

    expect(
      (
        await patchStatusReq({
          app,
          accountId: "a2",
          userId: a2member.userId,
          status: "disabled",
          headers: { cookie: a1owner.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(storedStatus(db, "a2", a2member.userId)).toBe("active");
  });
}

function createInvalidStatusMutationTest(): void {
  it("rejects an unknown status with 400 and leaves the row untouched", async () => {
    const { app, db, owner, ed } = await ownerAndEditor("bad-status");
    for (const bad of ["suspended", "", null, 42, undefined]) {
      const res = await patchStatusReq({
        app,
        accountId: "a1",
        userId: ed.userId,
        status: bad,
        headers: { cookie: owner.cookie },
      });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(storedStatus(db, "a1", ed.userId)).toBe("active");
  });
}

function createMissingMemberStatusMutationTest(): void {
  it("404s for a principal who is not a member of the account", async () => {
    const { app, owner } = await ownerAndEditor("missing");
    const outsider = await signUp(app, "outsider-status@capacitylens.dev");
    expect(
      (
        await patchStatusReq({
          app,
          accountId: "a1",
          userId: outsider.userId,
          status: "disabled",
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });
}

function createAnonymousStatusMutationTest(): void {
  it("a session-less request is 401", async () => {
    const { app, ed } = await ownerAndEditor("anon");
    expect((await patchStatusReq({ app, accountId: "a1", userId: ed.userId, status: "disabled" })).statusCode).toBe(
      401,
    );
  });
}

describe("PATCH /api/accounts/:id/members/:userId/status — member lifecycle", () => {
  createDisableMemberTest();
  createArchiveMemberTest();
  createRestoreMemberTest();
  createVisibleInactiveMemberTest();
  createOwnerDisableRejectionTest();
  createSelfDisableRejectionTest();
  createLimitedStatusMutationRejectionTest();
  createCrossTenantStatusMutationTest();
  createInvalidStatusMutationTest();
  createMissingMemberStatusMutationTest();
  createAnonymousStatusMutationTest();
});

describe("member sign-in confirmation", () => {
  it("rate-limits repeated privacy-setting writes", async () => {
    const { app, db } = await appWithAuth({ rateLimit: 100 });
    seedTwo(db);
    const owner = await signUp(app, "owner-sign-in-rate-limit@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });

    for (let request = 0; request < 5; request += 1) {
      expect(
        (
          await memberSignInTrackingReq({
            app,
            accountId: "a1",
            enabled: request % 2 === 0,
            headers: { cookie: owner.cookie },
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(
      (await memberSignInTrackingReq({ app, accountId: "a1", enabled: false, headers: { cookie: owner.cookie } }))
        .statusCode,
    ).toBe(429);
  });

  it("is owner-controlled, default-off, timestamp-free, resettable and erased when disabled", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-sign-in-confirmation@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    const ed = await signUp(app, "editor-sign-in-confirmation@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: ed.userId, role: "editor", status: "active", createdAt: TS });
    const scenario = {
      app,
      db,
      ownerCookie: owner.cookie,
      editorCookie: ed.cookie,
      ownerId: owner.userId,
      editorId: ed.userId,
      editorEmail: "editor-sign-in-confirmation@capacitylens.dev",
    } satisfies SignInScenarioInput;
    await assertSignInTrackingDefaults(scenario);
    await enableAndConfirmMemberSignIn(scenario);
    await assertMemberSignInResetAndMfa(scenario);
  });
});

// ── #175 review: the status domain must reach EVERY membership path, not just the new route ──────
// Widening a membership to active/disabled/archived is only half a feature. The other half is that
// every path which resolves a member — invite redemption, identity administration, removal, role
// change — agrees about what a non-active row means. Each case below failed before this pass, and
// each fails independently, so a regression in one cannot hide behind another.

/** Owner + editor of a1, with the editor already moved into `status`. */
async function ownerAndInactiveEditor(suffix: string, status: "disabled" | "archived" = "disabled") {
  const { app, db } = await appWithAuth();
  seedTwo(db);
  const owner = await signUp(app, `owner-${suffix}@capacitylens.dev`);
  upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
  const ed = await signUp(app, `editor-${suffix}@capacitylens.dev`);
  upsertMember(db, { accountId: "a1", userId: ed.userId, role: "editor", status: "active", createdAt: TS });
  expect(
    (await patchStatusReq({ app, accountId: "a1", userId: ed.userId, status, headers: { cookie: owner.cookie } }))
      .statusCode,
  ).toBe(200);
  return { app, db, owner, ed };
}

function registerDisabledInviteRedemptionTest(): void {
  it("a disabled member cannot redeem an invite back into the account, and the invite stays unused", async () => {
    const { app, db, owner, ed } = await ownerAndInactiveEditor("invite-bypass");
    // A link-only invite the disabled member holds (or is handed). Before this fix the accept path
    // probed membership with an ACTIVE-only read, saw "not a member", and upserted them back to
    // active at the invite's role — reversing the administrator's decision with no audit record.
    const created = await call(app, {
      method: "POST",
      url: "/api/invites",
      payload: { accountId: "a1", role: "admin" },
      headers: { cookie: owner.cookie },
    });
    expect(created.statusCode).toBe(201);
    const token = (created.json() as { token: string }).token;

    const accept = await call(app, {
      method: "POST",
      url: `/api/invites/${token}/accept`,
      headers: { cookie: ed.cookie },
    });
    expect(accept.statusCode).toBe(403);

    // The suspension held on every axis: status, role (no silent promotion to the invite's admin),
    // and entry to the account.
    expect(storedStatus(db, "a1", ed.userId)).toBe("disabled");
    expect(getMemberRole(db, "a1", ed.userId)).toBe("editor");
    expect(
      (await call(app, { method: "GET", url: "/api/state?accountId=a1", headers: { cookie: ed.cookie } })).statusCode,
    ).toBe(403);
    // And the invite is NOT burned — it still works once an admin restores the membership.
    const invite = getInvite(db, token);
    if (!invite) throw new Error("Expected the invitation to remain available.");
    expect(invite.usedAt).toBeNull();
  });
}

function registerArchivedInviteRedemptionTest(): void {
  it("an archived member is refused identically, so neither suspension is the weaker one", async () => {
    const { app, db, owner, ed } = await ownerAndInactiveEditor("invite-bypass-archived", "archived");
    const token = (
      (
        await call(app, {
          method: "POST",
          url: "/api/invites",
          payload: { accountId: "a1", role: "editor" },
          headers: { cookie: owner.cookie },
        })
      ).json() as { token: string }
    ).token;
    expect(
      (await call(app, { method: "POST", url: `/api/invites/${token}/accept`, headers: { cookie: ed.cookie } }))
        .statusCode,
    ).toBe(403);
    expect(storedStatus(db, "a1", ed.userId)).toBe("archived");
  });
}

function registerRestoredInviteRedemptionTest(): void {
  it("a restored member can then redeem that same invite, so the refusal is a pause and not a wall", async () => {
    const { app, db, owner, ed } = await ownerAndInactiveEditor("invite-after-restore");
    const token = (
      (
        await call(app, {
          method: "POST",
          url: "/api/invites",
          payload: { accountId: "a1", role: "editor" },
          headers: { cookie: owner.cookie },
        })
      ).json() as { token: string }
    ).token;
    expect(
      (await call(app, { method: "POST", url: `/api/invites/${token}/accept`, headers: { cookie: ed.cookie } }))
        .statusCode,
    ).toBe(403);

    expect(
      (
        await patchStatusReq({
          app,
          accountId: "a1",
          userId: ed.userId,
          status: "active",
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call(app, { method: "POST", url: `/api/invites/${token}/accept`, headers: { cookie: ed.cookie } }))
        .statusCode,
    ).toBe(200);
    const invite = getInvite(db, token);
    if (!invite) throw new Error("Expected the redeemed invitation.");
    expect(invite.usedAt).not.toBeNull();
  });
}

function registerDisabledMemberAuthorityTest(): void {
  it("an admin keeps reset-password and revoke-sessions authority over a member they just disabled", async () => {
    const { app, owner, ed } = await ownerAndInactiveEditor("identity-authority");
    // The compromised-account case: an admin disables first, THEN kills the live session. Before
    // this fix the target's authority map was active-only, so disabling someone reported them as
    // "not a member" and removed both controls — leaving the attacker's session running.
    const listed = await membersReq(app, "a1", { cookie: owner.cookie });
    expect(listed.statusCode).toBe(200);
    const row = (
      listed.json() as {
        members: Array<{ userId: string; mayResetPassword: boolean; mayRevokeSessions: boolean }>;
      }
    ).members.find((m) => m.userId === ed.userId);
    if (!row) throw new Error("Expected the disabled member authority row.");
    expect(row.mayResetPassword).toBe(true);
    expect(row.mayRevokeSessions).toBe(true);

    // Not merely advertised — the routes themselves still work on the disabled member.
    expect(
      (
        await call(app, {
          method: "POST",
          url: `/api/accounts/a1/members/${ed.userId}/reset-password`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call(app, {
          method: "POST",
          url: `/api/accounts/a1/members/${ed.userId}/revoke-sessions`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(204);
  });
}

function registerDisabledMemberRemovalTest(): void {
  it("removes a disabled membership without restoring its access first", async () => {
    const { app, db, owner, ed } = await ownerAndInactiveEditor("remove-suspended");
    // The gear offers Remove on a non-active row; before this fix the route's active-only lookup
    // 404'd, so the only way to delete the membership was to hand its access back first.
    const res = await call(app, {
      method: "DELETE",
      url: `/api/accounts/a1/members/${ed.userId}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(getMemberRole(db, "a1", ed.userId)).toBeNull();
    expect(storedStatus(db, "a1", ed.userId)).toBeUndefined();
  });
}

function registerDisabledMemberRoleChangeTest(): void {
  it("refuses a ROLE change on a non-active membership — restore is the only way back", async () => {
    const { app, db, owner, ed } = await ownerAndInactiveEditor("role-suspended");
    // Deliberately NOT widened. changeMemberRole writes `status: "active"`, so accepting it here
    // would make a role edit a silent reinstatement. The UI hides the pencil on these rows; this is
    // the server half of the same rule.
    const res = await call(app, {
      method: "PATCH",
      url: `/api/accounts/a1/members/${ed.userId}`,
      payload: { role: "viewer" },
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(getMemberRole(db, "a1", ed.userId)).toBe("editor");
    expect(storedStatus(db, "a1", ed.userId)).toBe("disabled");
  });
}

describe("disabling holds across every membership path (#175 review)", () => {
  registerDisabledInviteRedemptionTest();
  registerArchivedInviteRedemptionTest();
  registerRestoredInviteRedemptionTest();
  registerDisabledMemberAuthorityTest();
  registerDisabledMemberRemovalTest();
  registerDisabledMemberRoleChangeTest();
});

function registerRepeatedStatusNoOpTest(): void {
  it("succeeds without burning the member's outstanding reset link", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-noop-status@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    const ed = await signUp(app, "editor-noop-status@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: ed.userId, role: "editor", status: "active", createdAt: TS });

    // One admin mints a reset link and hands it over...
    const minted = await call(app, {
      method: "POST",
      url: `/api/accounts/a1/members/${ed.userId}/reset-password`,
      headers: { cookie: owner.cookie },
    });
    expect(minted.statusCode).toBe(201);
    const token = (minted.json() as { token: string }).token;

    // ...then a second admin, on a stale screen, re-applies the status the member already holds.
    // SQLite counts a MATCHED row as changed even when the written value is identical, so an
    // unguarded UPDATE would run the membership-write security protocol and silently kill the link.
    const res = await patchStatusReq({
      app,
      accountId: "a1",
      userId: ed.userId,
      status: "active",
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: ed.userId, status: "active" });
    expect(storedStatus(db, "a1", ed.userId)).toBe("active");

    // THE POINT: the link the first admin distributed still redeems.
    const redeemed = await call(app, {
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { newPassword: "a-brand-new-password-123", token },
    });
    expect(redeemed.statusCode).toBe(200);
  });
}

function registerChangedStatusResetTest(): void {
  it("still burns the link when the status genuinely changes", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-real-status@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
    const ed = await signUp(app, "editor-real-status@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: ed.userId, role: "editor", status: "active", createdAt: TS });
    const token = (
      (
        await call(app, {
          method: "POST",
          url: `/api/accounts/a1/members/${ed.userId}/reset-password`,
          headers: { cookie: owner.cookie },
        })
      ).json() as { token: string }
    ).token;

    // The guard must not become an excuse to skip the protocol on a REAL transition: a link minted
    // while the member was active must not redeem into a non-active one.
    expect(
      (
        await patchStatusReq({
          app,
          accountId: "a1",
          userId: ed.userId,
          status: "disabled",
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(storedStatus(db, "a1", ed.userId)).toBe("disabled");
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/auth/reset-password",
          payload: { newPassword: "should-not-work-456", token },
        })
      ).statusCode,
    ).toBe(400);
  });
}

describe("re-applying a member's current status is a no-op (#175 review)", () => {
  registerRepeatedStatusNoOpTest();
  registerChangedStatusResetTest();
});

// The directory is a list a person reads top to bottom, so its order is part of the feature, not an
// implementation detail. Join date first (that is how an administrator remembers the team), name as
// the tie-break — a bulk import stamps everyone with the same instant, and an id order there reads
// as random. principalId last, so two identically-named same-instant rows still list identically
// between reads.
describe("member listing order (#175)", () => {
  it("orders by join date, then by name", async () => {
    const { app, db } = await appWithAuth();
    seedTwo(db);
    const owner = await signUp(app, "owner-order@capacitylens.dev");
    upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });

    // Three members sharing ONE joinedAt, seeded in an order that is neither alphabetical nor the
    // one the id happens to produce, so a passing assertion cannot be an accident of insertion.
    const later = "2026-02-01T00:00:00.000Z";
    for (const name of ["Clark Kent", "alfred Pennyworth", "Barry Allen"]) {
      const firstName = name.split(" ")[0];
      if (!firstName) throw new Error("Expected a member first name.");
      const user = await signUp(app, `${firstName.toLowerCase()}-order@capacitylens.dev`);
      db.prepare(`UPDATE user SET name = ? WHERE id = ?`).run(name, user.userId);
      upsertMember(db, { accountId: "a1", userId: user.userId, role: "editor", status: "active", createdAt: later });
    }

    const res = await membersReq(app, "a1", { cookie: owner.cookie });
    expect(res.statusCode).toBe(200);
    const listed = (res.json() as { members: Array<{ name: string | null }> }).members.map((row) => row.name);
    // The owner joined first and stays first regardless of name; the rest sort case-insensitively,
    // so "alfred" is not exiled past "Barry" by a raw byte comparison.
    expect(listed).toEqual(["Tester", "alfred Pennyworth", "Barry Allen", "Clark Kent"]);
  });
});

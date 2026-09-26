import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app";
import { openDb, insertAll, type Db } from "./db";
import { upsertMember, getMemberRole, getInvite, isAccessRestricted } from "./controlTables";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { PASSWORD_ENV, call, signUp } from "./testHelpers";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";

const TS = "2026-01-01T00:00:00.000Z";
const account = (id: string) => ({ id, name: `Studio ${id}`, color: "#3b82f6", createdAt: TS, updatedAt: TS });

async function ownerAndEditor(suffix: string) {
  const db = openDb(":memory:");
  const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
  if (!configured.auth) throw new Error("Password test auth was not configured");
  await runAuthMigrations(configured.auth);
  const app = createApp(db, { authMode: configured.mode, auth: configured.auth });
  insertAll(db, { ...emptyAppData(), accounts: [account("a1"), account("a2")] } as AppData);
  const owner = await signUp(app, `owner-${suffix}@capacitylens.dev`);
  upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: TS });
  const ed = await signUp(app, `editor-${suffix}@capacitylens.dev`);
  upsertMember(db, { accountId: "a1", userId: ed.userId, role: "editor", status: "active", createdAt: TS });
  return { app, db, owner, ed };
}

const patchStatusReq = (input: {
  app: FastifyInstance;
  accountId: string;
  userId: string;
  status: string;
  headers?: Record<string, string>;
}) =>
  call(input.app, {
    method: "PATCH",
    url: `/api/accounts/${input.accountId}/members/${input.userId}/status`,
    payload: { status: input.status },
    headers: input.headers ?? {},
  });
// eslint-disable-next-line max-params
const enableAccessReq = (app: FastifyInstance, accountId: string, userId: string, cookie: string) =>
  call(app, {
    method: "POST",
    url: `/api/accounts/${accountId}/members/${userId}/enable-access`,
    headers: { cookie },
  });
const membersReq = (app: FastifyInstance, accountId: string, headers: Record<string, string>) =>
  call(app, { method: "GET", url: `/api/accounts/${accountId}/members`, headers });
const storedStatus = (db: Db, accountId: string, userId: string): string | undefined =>
  (
    db.prepare(`SELECT status FROM account_members WHERE accountId = ? AND userId = ?`).get(accountId, userId) as
      { status: string } | undefined
  )?.status;

function createRestoreMemberTest(): void {
  it("requires explicit Enable Access after a membership restore and keeps the role", async () => {
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
    ).toBe(403);
    expect((await enableAccessReq(app, "a1", ed.userId, owner.cookie)).statusCode).toBe(200);
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
    expect(row.status).toBe("active");
    expect((row as typeof row & { accessDisabled: boolean }).accessDisabled).toBe(true);
    expect(row.role).toBe("editor");
  });
}

// eslint-disable-next-line max-lines-per-function
describe("durable company access restriction", () => {
  it("keeps a removed restriction manageable and blocks invitation return until explicitly enabled", async () => {
    const { app, db, owner, ed } = await ownerAndEditor("removed-restriction");
    upsertMember(db, { accountId: "a2", userId: ed.userId, role: "viewer", status: "active", createdAt: TS });
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
    expect(
      (await call(app, { method: "GET", url: "/api/state?accountId=a1", headers: { cookie: ed.cookie } })).statusCode,
    ).toBe(403);
    expect(
      (await call(app, { method: "GET", url: "/api/state?accountId=a2", headers: { cookie: ed.cookie } })).statusCode,
    ).toBe(200);
    expect(
      (
        await call(app, {
          method: "DELETE",
          url: `/api/accounts/a1/members/${ed.userId}`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(204);
    const directory = (await membersReq(app, "a1", { cookie: owner.cookie })).json() as {
      members: Array<{ userId: string; membershipPresent: boolean; accessDisabled: boolean }>;
    };
    expect(directory.members.find((member) => member.userId === ed.userId)).toMatchObject({
      membershipPresent: false,
      accessDisabled: true,
    });
    const created = await call(app, {
      method: "POST",
      url: "/api/invites",
      payload: { accountId: "a1", role: "viewer" },
      headers: { cookie: owner.cookie },
    });
    const token = (created.json() as { token: string }).token;
    expect(
      (await call(app, { method: "POST", url: `/api/invites/${token}/accept`, headers: { cookie: ed.cookie } }))
        .statusCode,
    ).toBe(403);
    expect(isAccessRestricted(db, "a1", ed.userId)).toBe(true);
    expect((await enableAccessReq(app, "a1", ed.userId, owner.cookie)).statusCode).toBe(200);
    expect(getMemberRole(db, "a1", ed.userId)).toBeNull();
    expect(
      (await call(app, { method: "POST", url: `/api/invites/${token}/accept`, headers: { cookie: ed.cookie } }))
        .statusCode,
    ).toBe(200);
    expect(getMemberRole(db, "a1", ed.userId)).toBe("viewer");
  });
  it("rejects a new verified principal using the restricted address", async () => {
    const { app, db, owner, ed } = await ownerAndEditor("recreated-restriction");
    const address = "editor-recreated-restriction@capacitylens.dev";
    db.prepare("UPDATE user SET emailVerified = 1 WHERE id = ?").run(ed.userId);
    db.prepare(
      `INSERT INTO identity_email_proofs (principalId, email, source, provenAt)
      VALUES (?, ?, 'google', ?)`,
    ).run(ed.userId, address, TS);
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
    expect(
      (
        await call(app, {
          method: "DELETE",
          url: `/api/accounts/a1/members/${ed.userId}`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(204);
    db.prepare("UPDATE user SET email = ? WHERE id = ?").run("former-editor@capacitylens.dev", ed.userId);
    const recreated = await signUp(app, address);
    db.prepare("UPDATE user SET emailVerified = 1 WHERE id = ?").run(recreated.userId);
    db.prepare(
      `INSERT INTO identity_email_proofs (principalId, email, source, provenAt)
      VALUES (?, ?, 'google', ?)`,
    ).run(recreated.userId, address, TS);
    const created = await call(app, {
      method: "POST",
      url: "/api/invites",
      payload: { accountId: "a1", role: "viewer", preauthEmail: address },
      headers: { cookie: owner.cookie },
    });
    expect(created.statusCode).toBe(201);
    const token = (created.json() as { token: string }).token;
    expect(
      (await call(app, { method: "POST", url: `/api/invites/${token}/accept`, headers: { cookie: recreated.cookie } }))
        .statusCode,
    ).toBe(403);
    expect(getMemberRole(db, "a1", recreated.userId)).toBeNull();
    expect(getInvite(db, token)?.usedAt).toBeNull();
  });
  it("does not treat a legacy verified flag or addressed password invitation as mailbox proof", async () => {
    const { app, db, owner, ed } = await ownerAndEditor("flag-only");
    const address = "editor-flag-only@capacitylens.dev";
    db.prepare("UPDATE user SET emailVerified = 1 WHERE id = ?").run(ed.userId);
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
    const restriction = db
      .prepare(
        `SELECT verifiedEmail FROM account_access_restrictions
      WHERE accountId = 'a1' AND principalId = ?`,
      )
      .get(ed.userId);
    expect(restriction).toEqual({ verifiedEmail: null });
    db.prepare("UPDATE user SET email = ? WHERE id = ?").run("former-flag-only@capacitylens.dev", ed.userId);
    const recreated = await signUp(app, address);
    db.prepare("UPDATE user SET emailVerified = 1 WHERE id = ?").run(recreated.userId);
    expect(isAccessRestricted(db, "a1", recreated.userId)).toBe(false);
  });
  it("keeps access denied while another restriction still matches the proven address", async () => {
    const { app, db, owner, ed } = await ownerAndEditor("overlap");
    const address = "editor-overlap@capacitylens.dev";
    db.prepare(
      `INSERT INTO identity_email_proofs (principalId, email, source, provenAt)
      VALUES (?, ?, 'google', ?)`,
    ).run(ed.userId, address, TS);
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
    db.prepare("UPDATE user SET email = ? WHERE id = ?").run("former-overlap@capacitylens.dev", ed.userId);
    const replacement = await signUp(app, address);
    upsertMember(db, { accountId: "a1", userId: replacement.userId, role: "editor", status: "active", createdAt: TS });
    db.prepare(
      `INSERT INTO identity_email_proofs (principalId, email, source, provenAt)
      VALUES (?, ?, 'google', ?)`,
    ).run(replacement.userId, address, TS);
    expect(
      (
        await patchStatusReq({
          app,
          accountId: "a1",
          userId: replacement.userId,
          status: "disabled",
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(200);
    const enabled = await enableAccessReq(app, "a1", replacement.userId, owner.cookie);
    expect(enabled.statusCode).toBe(200);
    expect((enabled.json() as { accessDisabled: boolean }).accessDisabled).toBe(true);
    expect(isAccessRestricted(db, "a1", replacement.userId)).toBe(true);
  });
  it("enables an archived restriction without restoring membership", async () => {
    const { app, db, owner, ed } = await ownerAndEditor("archived-enable");
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
    expect((await enableAccessReq(app, "a1", ed.userId, owner.cookie)).statusCode).toBe(200);
    expect(storedStatus(db, "a1", ed.userId)).toBe("archived");
    expect(isAccessRestricted(db, "a1", ed.userId)).toBe(false);
  });
});

describe("membership restore and directory", () => {
  createRestoreMemberTest();
  createVisibleInactiveMemberTest();
});

import { describe, expect, it } from "vitest";
import { createAuthFromEnvironment, runAuthMigrations } from "../auth";
import { createApp } from "../app";
import { upsertMember } from "../controlTables";
import { createInvite } from "../controlTables/invites";
import { writeJoiningPolicy } from "../controlTables/joiningPolicies";
import { insertRow, openDb, type Db } from "../db";
import { PASSWORD_ENV, registerServerFixtureCleanup, signUp } from "../testHelpers";

const fixtures = registerServerFixtureCleanup();

async function fixture() {
  const db = fixtures.trackDb(openDb(":memory:"));
  const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
  if (!configured.auth) throw new Error("Expected configured authentication.");
  await runAuthMigrations(configured.auth);
  insertRow(db, "accounts", {
    id: "a-studio",
    name: "Wayne Enterprises",
    color: "#6366f1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const app = fixtures.trackApp(
    createApp(db, {
      authMode: configured.mode,
      auth: configured.auth,
      joiningProof: {
        secret: PASSWORD_ENV.SMALLSASS_ACCOUNT_SECRET,
        publicUrl: new URL(PASSWORD_ENV.SMALLSASS_ACCOUNT_PUBLIC_URL),
      },
    }),
  );
  const diana = await signUp(app, "diana@studio.example");
  return { app, db, diana };
}

function currentProof(db: Db, principalId: string, email = "diana@studio.example") {
  db.prepare(
    `INSERT INTO identity_email_proofs (principalId,email,source,provenAt)
    VALUES (?, ?, 'google', ?)`,
  ).run(principalId, email, new Date().toISOString());
}

async function complete(app: ReturnType<typeof createApp>, cookie: string, payload: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/accounts/a-studio/join/complete-existing",
    headers: { cookie },
    payload,
  });
}

// eslint-disable-next-line max-lines-per-function -- One fixture exercises the explicit policy route and retained invitation contract.
describe("existing password identity company joining", () => {
  it("accepts an addressed password invitation without creating global email proof", async () => {
    const { app, db, diana } = await fixture();
    writeJoiningPolicy(db, "a-studio", { policy: "invitation_only", approvedDomains: [] });
    createInvite(db, {
      id: "addressed-password",
      token: "addressed-password",
      accountId: "a-studio",
      role: "editor",
      preauthEmail: "diana@studio.example",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString(),
    });
    const accepted = await app.inject({
      method: "POST",
      url: "/api/invites/addressed-password/accept",
      headers: { cookie: diana.cookie },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toEqual({ accountId: "a-studio", role: "editor" });
    expect(db.prepare("SELECT 1 FROM identity_email_proofs WHERE principalId = ?").get(diana.userId)).toBeUndefined();
  });

  it("requires prior durable proof for an addressed invitation under domain-only policy", async () => {
    const { app, db, diana } = await fixture();
    writeJoiningPolicy(db, "a-studio", { policy: "approved_domains", approvedDomains: ["studio.example"] });
    createInvite(db, {
      id: "domain-password",
      token: "domain-password",
      accountId: "a-studio",
      role: "editor",
      preauthEmail: "diana@studio.example",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString(),
    });
    const denied = await app.inject({
      method: "POST",
      url: "/api/invites/domain-password/accept",
      headers: { cookie: diana.cookie },
    });
    expect(denied.statusCode).toBe(403);
    expect(db.prepare("SELECT usedAt FROM invites WHERE id = 'domain-password'").get()).toEqual({ usedAt: null });
  });

  it("admits only current trusted email proof under open and approved-domain policies", async () => {
    const { app, db, diana } = await fixture();
    writeJoiningPolicy(db, "a-studio", { policy: "open", approvedDomains: [] });
    expect((await complete(app, diana.cookie)).statusCode).toBe(401);
    expect(db.prepare("SELECT 1 FROM account_members WHERE userId = ?").get(diana.userId)).toBeUndefined();
    currentProof(db, diana.userId);
    writeJoiningPolicy(db, "a-studio", { policy: "approved_domains", approvedDomains: ["studio.example"] });
    const joined = await complete(app, diana.cookie);
    expect(joined.statusCode, joined.body).toBe(200);
    expect(joined.json()).toEqual({ accountId: "a-studio", role: "viewer" });
  });

  it("rejects stale proof, caller-supplied email, and invitation-only policy", async () => {
    const { app, db, diana } = await fixture();
    writeJoiningPolicy(db, "a-studio", { policy: "open", approvedDomains: [] });
    currentProof(db, diana.userId, "old@studio.example");
    expect((await complete(app, diana.cookie)).statusCode).toBe(401);
    expect((await complete(app, diana.cookie, { email: "old@studio.example" })).statusCode).toBe(400);
    db.prepare("DELETE FROM identity_email_proofs").run();
    currentProof(db, diana.userId);
    writeJoiningPolicy(db, "a-studio", { policy: "invitation_only", approvedDomains: [] });
    expect((await complete(app, diana.cookie)).statusCode).toBe(403);
  });

  it("retains an active elevated role and denies a disabled member", async () => {
    const { app, db, diana } = await fixture();
    currentProof(db, diana.userId);
    writeJoiningPolicy(db, "a-studio", { policy: "open", approvedDomains: [] });
    upsertMember(db, {
      accountId: "a-studio",
      userId: diana.userId,
      role: "admin",
      status: "active",
      createdAt: new Date().toISOString(),
    });
    expect((await complete(app, diana.cookie)).json()).toEqual({ accountId: "a-studio", role: "admin" });
    db.prepare("UPDATE account_members SET status = 'disabled' WHERE userId = ?").run(diana.userId);
    expect((await complete(app, diana.cookie)).statusCode).toBe(403);
  });

  it("does not expose deferred password-mail routes", async () => {
    const { app, diana } = await fixture();
    for (const url of [
      "/api/accounts/a-studio/join/start",
      "/api/company-join/resend",
      "/api/company-join/confirm",
      "/api/company-join/complete-password",
      "/api/company-join/complete-existing",
    ]) {
      expect(
        (await app.inject({ method: "POST", url, headers: { cookie: diana.cookie }, payload: {} })).statusCode,
      ).toBe(404);
    }
  });
});

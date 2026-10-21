import { describe, expect, it, vi } from "vitest";
import { mintJoinEmailProofToken, verifyJoinEmailProofToken } from "../accounts/adminPort/joiningIntentSecrets";
import { createAuthFromEnvironment, runAuthMigrations } from "../auth";
import { createApp } from "../app";
import { upsertMember } from "../controlTables";
import { createInvite } from "../controlTables/invites";
import { writeJoiningPolicy } from "../controlTables/joiningPolicies";
import { insertRow, openDb } from "../db";
import type { Db } from "../db";
import { PASSWORD_ENV, signUp } from "../testHelpers/passwordAuth";
import { registerServerFixtureCleanup } from "../testHelpers/registerServerFixtureCleanup";

const fixtures = registerServerFixtureCleanup();

async function fixture(options: { mail?: boolean; passwordAllowed?: boolean } = {}) {
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
  const send = vi
    .fn<(message: { to: string; subject: string; text: string }) => Promise<void>>()
    .mockResolvedValue(undefined);
  configured.auth.mail = options.mail ? { send } : null;
  let app = fixtures.trackApp(
    createApp(db, {
      authMode: configured.mode,
      auth: configured.auth,
      joiningProof: {
        secret: PASSWORD_ENV.CAPACITYLENS_SECRET,
        publicUrl: new URL(PASSWORD_ENV.CAPACITYLENS_PUBLIC_URL),
      },
    }),
  );
  const diana = await signUp(app, "diana@studio.example");
  if (options.passwordAllowed === false) {
    app = fixtures.trackApp(
      createApp(db, {
        authMode: "sso-only",
        auth: configured.auth,
        joiningProof: {
          secret: PASSWORD_ENV.CAPACITYLENS_SECRET,
          publicUrl: new URL(PASSWORD_ENV.CAPACITYLENS_PUBLIC_URL),
        },
      }),
    );
  }
  return { app, db, diana, send };
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

const secret = PASSWORD_ENV.CAPACITYLENS_SECRET;
const sendPath = "/api/accounts/a-studio/join/verify-email";

async function confirm(app: ReturnType<typeof createApp>, cookie: string, token: string) {
  return app.inject({ method: "POST", url: "/api/company-join/verify-email", headers: { cookie }, payload: { token } });
}

it("round-trips email proof tokens and rejects malformed, tampered and expired tokens", () => {
  const identity = { principalId: "diana", email: "diana@studio.example" };
  const token = mintJoinEmailProofToken(secret, { ...identity, expiresAt: 1000 });
  expect(verifyJoinEmailProofToken(secret, token, 999)).toEqual(identity);
  expect(verifyJoinEmailProofToken(secret, token, 1000)).toBeNull();
  expect(verifyJoinEmailProofToken(secret, token + "x", 999)).toBeNull();
  expect(verifyJoinEmailProofToken("another-secret", token, 999)).toBeNull();
  expect(verifyJoinEmailProofToken(secret, "malformed", 999)).toBeNull();
});

it("emails one link that proves the current address and permits open-policy joining", async () => {
  const { app, db, diana, send } = await fixture({ mail: true });
  writeJoiningPolicy(db, "a-studio", { policy: "open", approvedDomains: [] });
  expect((await complete(app, diana.cookie)).statusCode).toBe(401);
  const sent = await app.inject({ method: "POST", url: sendPath, headers: { cookie: diana.cookie }, payload: {} });
  expect(sent.statusCode, sent.body).toBe(200);
  expect(sent.json()).toEqual({ sent: true });
  expect(send).toHaveBeenCalledTimes(1);
  const message = send.mock.calls[0]?.[0];
  expect(message).toMatchObject({ to: "diana@studio.example", subject: "Verify your email to join a company" });
  expect(message?.text).toContain("60 minutes");
  const links = message?.text.match(/https?:\/\/\S+/g);
  expect(links).toHaveLength(1);
  if (!links?.[0]) throw new Error("Expected a verification link.");
  const link = new URL(links[0]);
  expect(link.pathname).toBe("/join/a-studio");
  expect(link.search).toBe("");
  expect(link.href).not.toContain("diana@studio.example");
  const token = new URLSearchParams(link.hash.slice(1)).get("verify");
  if (!token) throw new Error("Expected a verification token.");
  const before = db.prepare("SELECT * FROM user WHERE id = ?").get(diana.userId);
  const result = await confirm(app, diana.cookie, token);
  expect(result.statusCode, result.body).toBe(200);
  expect(db.prepare("SELECT * FROM user WHERE id = ?").get(diana.userId)).toEqual(before);
  expect(db.prepare("SELECT 1 FROM account_members WHERE userId = ?").get(diana.userId)).toBeUndefined();
  expect(result.json()).toEqual({ ok: true });
  expect(db.prepare("SELECT email, source FROM identity_email_proofs WHERE principalId = ?").get(diana.userId)).toEqual(
    { email: "diana@studio.example", source: "password" },
  );
  expect((await confirm(app, diana.cookie, token)).statusCode).toBe(200);
  expect((await complete(app, diana.cookie)).statusCode).toBe(200);
});

it.each(["expired", "tampered", "other-principal", "changed-email"])("rejects %s confirmation", async (kind) => {
  const { app, db, diana } = await fixture({ mail: true });
  let token = mintJoinEmailProofToken(secret, {
    principalId: kind === "other-principal" ? "barbara" : diana.userId,
    email: "diana@studio.example",
    expiresAt: Date.now() + (kind === "expired" ? -1000 : 60_000),
  });
  if (kind === "tampered") token = token.replace(/\.[A-Za-z0-9_-]/, (prefix) => (prefix === ".A" ? ".B" : ".A"));
  if (kind === "changed-email")
    db.prepare("UPDATE user SET email = ? WHERE id = ?").run("diana@wayne.example", diana.userId);
  const result = await confirm(app, diana.cookie, token);
  expect(result.statusCode, result.body).toBe(400);
  expect(db.prepare("SELECT 1 FROM identity_email_proofs WHERE principalId = ?").get(diana.userId)).toBeUndefined();
});

it("refuses proof that conflicts with Owner access without overwriting existing proof", async () => {
  const { app, db, diana } = await fixture({ mail: true });
  upsertMember(db, {
    accountId: "a-studio",
    userId: diana.userId,
    role: "owner",
    status: "active",
    createdAt: new Date().toISOString(),
  });
  currentProof(db, diana.userId, "old@studio.example");
  db.prepare(
    "INSERT INTO account_access_restrictions (accountId, principalId, verifiedEmail, role, createdAt) VALUES (?, ?, ?, ?, ?)",
  ).run("a-studio", "barbara", "diana@studio.example", "viewer", new Date().toISOString());
  const token = mintJoinEmailProofToken(secret, {
    principalId: diana.userId,
    email: "diana@studio.example",
    expiresAt: Date.now() + 60_000,
  });
  expect((await confirm(app, diana.cookie, token)).statusCode).toBe(403);
  expect(db.prepare("SELECT email, source FROM identity_email_proofs WHERE principalId = ?").get(diana.userId)).toEqual(
    { email: "old@studio.example", source: "google" },
  );
});

it.each([
  { mail: false, passwordAllowed: true, status: 400 },
  { mail: true, passwordAllowed: false, status: 401 },
])("refuses unavailable email verification: %j", async (options) => {
  const { app, diana, send } = await fixture(options);
  const result = await app.inject({ method: "POST", url: sendPath, headers: { cookie: diana.cookie }, payload: {} });
  expect(result.statusCode, result.body).toBe(options.status);
  expect(send).not.toHaveBeenCalled();
});

it("surfaces failed delivery and rejects caller-supplied addresses", async () => {
  const { app, diana, send } = await fixture({ mail: true });
  const invalid = await app.inject({
    method: "POST",
    url: sendPath,
    headers: { cookie: diana.cookie },
    payload: { email: "barbara@studio.example" },
  });
  expect(invalid.statusCode).toBe(400);
  expect(send).not.toHaveBeenCalled();
  send.mockRejectedValueOnce(new Error("private transport detail"));
  const failed = await app.inject({ method: "POST", url: sendPath, headers: { cookie: diana.cookie }, payload: {} });
  expect(failed.statusCode, failed.body).toBe(503);
  expect(failed.body).not.toContain("private transport detail");
});

type MetadataOptions = { mail: boolean };
it("reports email verification as available only when mail can be sent", async () => {
  const metadata = async ({ mail }: MetadataOptions) => {
    const { app } = await fixture({ mail });
    return (await app.inject({ method: "GET", url: "/api/accounts/a-studio/join/metadata" })).json();
  };
  expect(await metadata({ mail: true })).toMatchObject({ passwordAvailable: true, emailVerificationAvailable: true });
  expect(await metadata({ mail: false })).toMatchObject({ passwordAvailable: true, emailVerificationAvailable: false });
});

it("stops sending verification email to one address after the hourly budget", async () => {
  const { app, diana, send } = await fixture({ mail: true });
  const statuses: number[] = [];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await app.inject({
      method: "POST",
      url: sendPath,
      headers: { cookie: diana.cookie },
      payload: {},
      remoteAddress: `198.51.100.${attempt}`,
    });
    statuses.push(response.statusCode);
  }
  expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  expect(send).toHaveBeenCalledTimes(5);
});

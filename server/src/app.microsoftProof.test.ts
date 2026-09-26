import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { insertRow, openDb } from "./db";
import { createInvite } from "./controlTables";
import { PASSWORD_ENV, readCookies, registerServerFixtureCleanup } from "./testHelpers";

const fixtures = registerServerFixtureCleanup();
const origin = "http://localhost:8787";
const bootstrap = {
  purpose: "bootstrap",
  email: "bruce@example.test",
  callbackURL: `${origin}/`,
  errorCallbackURL: `${origin}/`,
};

async function configured(options: { mode?: "password-and-sso" | "sso-only"; trustProxyHeaders?: boolean } = {}) {
  const db = fixtures.trackDb(openDb(":memory:"));
  const { mode, auth } = createAuthFromEnvironment(db, {
    ...PASSWORD_ENV,
    SMALLSASS_ACCOUNT_MODE: options.mode ?? "sso-only",
    SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS: bootstrap.email,
    SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID: "microsoft-client",
    SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
    SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID: "01234567-89ab-cdef-0123-456789abcdef",
    SMALLSASS_ACCOUNT_MAIL_HOST: "mail.example.test",
    SMALLSASS_ACCOUNT_MAIL_PORT: "587",
    SMALLSASS_ACCOUNT_MAIL_USER: "mailer",
    SMALLSASS_ACCOUNT_MAIL_PASSWORD: "mail-secret",
    SMALLSASS_ACCOUNT_MAIL_FROM: "identity@example.test",
  });
  if (!auth) throw new Error("Expected configured Microsoft authentication.");
  await runAuthMigrations(auth);
  return {
    db,
    app: fixtures.trackApp(
      createApp(db, { authMode: mode, auth, trustProxyHeaders: options.trustProxyHeaders ?? false }),
    ),
  };
}

describe("Microsoft verification HTTP boundary", () => {
  it("starts without tenant access, isolates status by cookie, and cancels the browser intent", async () => {
    const { app, db } = await configured();
    const started = await app.inject({ method: "POST", url: "/api/account/microsoft/start", payload: bootstrap });
    expect(started.statusCode).toBe(200);
    expect(new URL(started.json<{ url: string }>().url).hostname).toBe("login.microsoftonline.com");
    const cookie = readCookies(started);
    expect(cookie).toContain("microsoft-proof=");
    const pending = await app.inject({ url: "/api/account/microsoft/status", headers: { cookie } });
    expect(pending.json()).toMatchObject({ state: "pending" });
    expect(pending.headers["cache-control"]).toBe("no-store");
    expect((await app.inject({ url: "/api/account/microsoft/status" })).json()).toEqual({ state: "expired" });
    expect((await app.inject({ url: "/api/state", headers: { cookie } })).statusCode).toBe(401);
    expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 0 });
    const cancelled = await app.inject({
      method: "POST",
      url: "/api/account/microsoft/cancel",
      headers: { cookie },
      payload: {},
    });
    expect(cancelled.statusCode).toBe(200);
    expect((await app.inject({ url: "/api/account/microsoft/status", headers: { cookie } })).json()).toEqual({
      state: "expired",
    });
  });

  it.each(["start", "confirm", "resend", "cancel"])("rejects cross-site %s mutations", async (action) => {
    const { app, db } = await configured();
    const response = await app.inject({
      method: "POST",
      url: `/api/account/microsoft/${action}`,
      headers: { origin: "https://untrusted.example", "sec-fetch-site": "cross-site" },
      payload: action === "start" ? bootstrap : {},
    });
    expect(response.statusCode).toBe(403);
    expect(db.prepare("SELECT COUNT(*) AS count FROM microsoft_identity_proofs").get()).toEqual({ count: 0 });
  });

  it("rejects untrusted return URLs and malformed fields before persisting proof", async () => {
    const { app, db } = await configured();
    for (const payload of [
      { ...bootstrap, callbackURL: "https://untrusted.example/" },
      { ...bootstrap, inviteToken: 123 },
    ]) {
      const response = await app.inject({ method: "POST", url: "/api/account/microsoft/start", payload });
      expect(response.statusCode).toBe(400);
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM microsoft_identity_proofs").get()).toEqual({ count: 0 });
  });
});

it.each([true, false])(
  "applies forwarded client addresses only with proxy trust enabled (%s)",
  async (trustProxyHeaders) => {
    const { app, db } = await configured({ trustProxyHeaders });
    for (const address of ["192.0.2.1", "192.0.2.2"]) {
      const started = await app.inject({
        method: "POST",
        url: "/api/account/microsoft/start",
        headers: { "x-forwarded-for": address },
        payload: bootstrap,
      });
      expect(started.statusCode, started.body).toBe(200);
    }
    const rows = db.prepare("SELECT sourceIpHash FROM microsoft_identity_proofs").all() as Array<{
      sourceIpHash: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.sourceIpHash)).size).toBe(trustProxyHeaders ? 2 : 1);
    expect(rows.every((row) => !row.sourceIpHash.includes("192.0.2"))).toBe(true);
  },
);

it("cancels a browser bootstrap intent on native sign-out even without a login session", async () => {
  const { app, db } = await configured();
  const started = await app.inject({ method: "POST", url: "/api/account/microsoft/start", payload: bootstrap });
  expect(started.statusCode).toBe(200);
  const cookie = readCookies(started);
  const signedOut = await app.inject({ method: "POST", url: "/api/auth/sign-out", headers: { cookie }, payload: {} });
  expect(signedOut.statusCode, signedOut.body).toBe(200);
  expect(db.prepare("SELECT state FROM microsoft_identity_proofs").all()).toEqual([{ state: "cancelled" }]);
  expect((await app.inject({ url: "/api/account/microsoft/status", headers: { cookie } })).json()).toEqual({
    state: "expired",
  });
});

it("cancels an invitation intent on application sign-out", async () => {
  const { app, db } = await configured({ mode: "password-and-sso" });
  const local = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Bruce Wayne", email: "bruce@example.test", password: "password-123456" },
  });
  expect(local.statusCode, local.body).toBe(200);
  const now = new Date().toISOString();
  insertRow(db, "accounts", {
    id: "a-studio",
    name: "Wayne Enterprises",
    color: "#6366f1",
    createdAt: now,
    updatedAt: now,
  });
  const inviteToken = "pending-microsoft-invitation";
  createInvite(db, {
    token: inviteToken,
    id: "invite-1",
    accountId: "a-studio",
    role: "editor",
    preauthEmail: "diana@example.test",
    createdAt: now,
    usedAt: null,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
  const started = await app.inject({
    method: "POST",
    url: "/api/account/microsoft/start",
    headers: { cookie: readCookies(local) },
    payload: {
      purpose: "invite",
      inviteToken,
      callbackURL: `${origin}/invite/${inviteToken}`,
      errorCallbackURL: `${origin}/`,
    },
  });
  expect(started.statusCode, started.body).toBe(200);
  const cookie = `${readCookies(local)}; ${readCookies(started)}`;
  const signedOut = await app.inject({
    method: "POST",
    url: "/api/account/sign-out",
    headers: { cookie },
    payload: {},
  });
  expect(signedOut.statusCode, signedOut.body).toBe(200);
  expect(db.prepare("SELECT state FROM microsoft_identity_proofs").all()).toEqual([{ state: "cancelled" }]);
  expect(db.prepare("SELECT id FROM session").all()).toEqual([]);
});

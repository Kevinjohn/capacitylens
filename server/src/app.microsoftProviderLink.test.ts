import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { openDb } from "./db";
import { PASSWORD_ENV, readCookies } from "./testHelpers/passwordAuth";
import { registerServerFixtureCleanup } from "./testHelpers/registerServerFixtureCleanup";

const fixtures = registerServerFixtureCleanup();
const origin = "http://localhost:8787";
const payload = {
  providerId: "microsoft",
  callbackURL: `${origin}/account?capacitylensIdentityProvider=microsoft`,
  errorCallbackURL: `${origin}/account?capacitylensIdentityProvider=microsoft`,
};

type ConfiguredOptions = { verifyEmail?: boolean };
async function configured({ verifyEmail = true }: ConfiguredOptions = {}) {
  const db = fixtures.trackDb(openDb(":memory:"));
  const { auth } = createAuthFromEnvironment(db, {
    ...PASSWORD_ENV,
    CAPACITYLENS_MODE: "password-and-sso",
    CAPACITYLENS_MICROSOFT_CLIENT_ID: "microsoft-client",
    CAPACITYLENS_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
    CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
    CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
    CAPACITYLENS_MICROSOFT_TENANT_ID: "01234567-89ab-cdef-0123-456789abcdef",
    CAPACITYLENS_MAIL_HOST: "mail.example.test",
    CAPACITYLENS_MAIL_PORT: "587",
    CAPACITYLENS_MAIL_USER: "mailer",
    CAPACITYLENS_MAIL_PASSWORD: "mail-secret",
    CAPACITYLENS_MAIL_FROM: "identity@example.test",
  });
  if (!auth) throw new Error("Expected configured authentication.");
  await runAuthMigrations(auth);
  const app = fixtures.trackApp(createApp(db, { authMode: "password-and-sso", auth }));
  const signedUp = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: {
      email: "bruce@example.test",
      name: "Bruce Wayne",
      password: "correct-horse-battery-staple",
    },
  });
  expect(signedUp.statusCode).toBe(200);
  if (verifyEmail) db.prepare("UPDATE user SET emailVerified = 1 WHERE email = 'bruce@example.test'").run();
  return { db, app, auth, cookie: readCookies(signedUp) };
}

describe("Microsoft link through the common identity route", () => {
  it("starts an exact fresh-session proof without binding an account", async () => {
    const { db, app, auth, cookie } = await configured({});
    const response = await app.inject({
      method: "POST",
      url: "/api/identity/link-provider",
      headers: { cookie },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ url: string }>().url).toContain("login.microsoftonline.com");
    expect(response.headers["set-cookie"]).toBeDefined();
    const proof = db
      .prepare(
        "SELECT purpose,targetEmail,principalId,sessionId,callbackUrl,errorCallbackUrl FROM microsoft_identity_proofs",
      )
      .get() as {
      purpose: string;
      targetEmail: string;
      principalId: string;
      sessionId: string;
      callbackUrl: string;
      errorCallbackUrl: string;
    };
    expect(proof).toMatchObject({ purpose: "link", targetEmail: "bruce@example.test" });
    expect(proof.principalId).toBeTruthy();
    expect(proof.sessionId).toBeTruthy();
    expect(proof.callbackUrl).not.toContain("capacitylensSsoLinked");
    const proofCookies = readCookies(response);
    const errorUrl = auth.microsoftProof?.errorReturnUrl(new Headers({ cookie: proofCookies }), "TEST_ERROR");
    expect(errorUrl?.searchParams.get("capacitylensIdentityProvider")).toBe("microsoft");
    expect(errorUrl?.searchParams.has("capacitylensSsoLinkFailed")).toBe(true);
    expect(db.prepare("SELECT id FROM account WHERE providerId = 'microsoft'").get()).toBeUndefined();
  });

  it("rejects a stale session before creating a proof", async () => {
    const { db, app, cookie } = await configured({});
    db.prepare("UPDATE session SET createdAt = ?").run("2000-01-01T00:00:00.000Z");
    const response = await app.inject({
      method: "POST",
      url: "/api/identity/link-provider",
      headers: { cookie },
      payload,
    });
    expect(response.statusCode).toBe(403);
    expect(db.prepare("SELECT COUNT(*) AS count FROM microsoft_identity_proofs").get()).toEqual({ count: 0 });
  });

  it.each(["google", "microsoft"])("requires a verified local mailbox for explicit %s linking", async (providerId) => {
    const { db, app, cookie } = await configured({ verifyEmail: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/identity/link-provider",
      headers: { cookie },
      payload: { ...payload, providerId },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "LOCAL_EMAIL_NOT_VERIFIED" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM microsoft_identity_proofs").get()).toEqual({ count: 0 });
  });
});

describe("company-provider sign-in policy", () => {
  it("blocks GitHub and permits Microsoft initiation in SSO-only mode", async () => {
    const db = fixtures.trackDb(openDb(":memory:"));
    const { auth } = createAuthFromEnvironment(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_MODE: "sso-only",
      CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS: "bruce@example.test",
      CAPACITYLENS_MICROSOFT_CLIENT_ID: "microsoft-client",
      CAPACITYLENS_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
      CAPACITYLENS_MICROSOFT_TENANT_ID: "01234567-89ab-cdef-0123-456789abcdef",
      CAPACITYLENS_GITHUB_CLIENT_ID: "github-client",
      CAPACITYLENS_GITHUB_CLIENT_SECRET: "github-secret",
      CAPACITYLENS_MAIL_HOST: "mail.example.test",
      CAPACITYLENS_MAIL_PORT: "587",
      CAPACITYLENS_MAIL_USER: "mailer",
      CAPACITYLENS_MAIL_PASSWORD: "mail-secret",
      CAPACITYLENS_MAIL_FROM: "identity@example.test",
    });
    if (!auth) throw new Error("Expected configured authentication.");
    await runAuthMigrations(auth);
    const app = fixtures.trackApp(createApp(db, { authMode: "sso-only", auth }));
    const github = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/social",
      payload: { provider: "github" },
    });
    expect(github.statusCode).toBe(403);
    expect(github.json()).toMatchObject({ code: "COMPANY_PROVIDER_REQUIRED" });
    const microsoft = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/social",
      payload: {
        provider: "microsoft",
        callbackURL: `${origin}/`,
        errorCallbackURL: `${origin}/`,
      },
    });
    expect(microsoft.statusCode).toBe(200);
  });
});

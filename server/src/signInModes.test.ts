import { expect, it } from "vitest";
import { createApp } from "./app";
import { recordSessionAssurance } from "./accounts/state";
import { createAuthFromEnvironment, parseAuthMode, runAuthMigrations } from "./auth";
import { openDb } from "./db";
import { PASSWORD_ENV, readCookies } from "./testHelpers";

const google = {
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
};
const github = {
  SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID: "github-client",
  SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET: "github-secret",
};

function configured(mode: "password-only" | "password-and-sso" | "sso-only", providers = {}) {
  const db = openDb(":memory:");
  const result = createAuthFromEnvironment(db, {
    ...PASSWORD_ENV,
    SMALLSASS_ACCOUNT_MODE: mode,
    ...providers,
  });
  if (!result.auth) throw new Error("Expected authentication to be configured.");
  return { db, auth: result.auth };
}

it("rejects legacy modes with actionable migration guidance", () => {
  expect(() => parseAuthMode("password")).toThrow(/password-only or password-and-sso/);
  expect(() => parseAuthMode("sso")).toThrow(/sso-only/);
  expect(parseAuthMode("off")).toBe("off");
  expect(parseAuthMode("password-only")).toBe("password-only");
  expect(parseAuthMode("password-and-sso")).toBe("password-and-sso");
  expect(parseAuthMode("sso-only")).toBe("sso-only");
});

it("ignores retained provider credentials in password-only mode, including direct routes", async () => {
  const { db, auth } = configured("password-only", google);
  try {
    await runAuthMigrations(auth);
    expect(auth.providers).toEqual([]);
    expect(auth.federatedIssuers.size).toBe(0);
    const app = createApp(db, { authMode: "password-only", auth });
    const social = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/social",
      payload: { provider: "google", callbackURL: "http://localhost:8787/" },
    });
    expect(social.statusCode).toBe(404);
    const callback = await app.inject({ url: "/api/auth/callback/google?code=ignored&state=ignored" });
    expect(callback.statusCode).toBe(404);
    await app.close();
  } finally {
    db.close();
  }
});

it("requires configured providers and keeps GitHub restricted to mixed mode", () => {
  expect(() => configured("password-and-sso")).toThrow(/at least one configured sign-in provider/);
  expect(() => configured("sso-only", github)).toThrow(/Google or tenant-specific Microsoft/);
  const { db, auth } = configured("password-and-sso", { ...google, ...github });
  try {
    expect(auth.providers.map((provider) => provider.id)).toEqual(["google", "github"]);
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
  } finally {
    db.close();
  }
});

it("does not accept an existing password session after switching to sso-only", async () => {
  const db = openDb(":memory:");
  try {
    const password = createAuthFromEnvironment(db, PASSWORD_ENV);
    if (!password.auth) throw new Error("Expected password authentication.");
    await runAuthMigrations(password.auth);
    const passwordApp = createApp(db, { authMode: password.mode, auth: password.auth });
    const signedUp = await passwordApp.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "Bruce Wayne", email: "bruce@example.test", password: "password-123456" },
    });
    expect(signedUp.statusCode).toBe(200);
    const cookie = readCookies(signedUp);
    await passwordApp.close();

    const sso = createAuthFromEnvironment(db, {
      ...PASSWORD_ENV,
      SMALLSASS_ACCOUNT_MODE: "sso-only",
      ...google,
    });
    if (!sso.auth) throw new Error("Expected SSO authentication.");
    await runAuthMigrations(sso.auth);
    const ssoApp = createApp(db, { authMode: sso.mode, auth: sso.auth });
    const me = await ssoApp.inject({ url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
    await ssoApp.close();
  } finally {
    db.close();
  }
});

it("does not accept an existing provider session after switching to password-only", async () => {
  const { db, auth } = configured("password-only", google);
  try {
    await runAuthMigrations(auth);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('provider-user', 'Bruce Wayne', 'bruce@example.test', 1, ?, ?)`,
    ).run(createdAt, createdAt);
    recordSessionAssurance({
      db,
      sessionId: "prior-provider-session",
      principalId: "provider-user",
      assurance: "federated",
      providerId: "google",
    });
    const priorSession = {
      ...auth,
      api: {
        ...auth.api,
        getSession: async () => ({
          user: {
            id: "provider-user",
            name: "Bruce Wayne",
            email: "bruce@example.test",
            emailVerified: true,
            image: null,
          },
          session: {
            id: "prior-provider-session",
            createdAt,
            expiresAt,
          },
        }),
      },
    };
    const app = createApp(db, { authMode: "password-only", auth: priorSession });
    const me = await app.inject({ url: "/api/auth/me", headers: { cookie: "capacitylens.session_token=prior" } });
    expect(me.statusCode).toBe(401);
    await app.close();
  } finally {
    db.close();
  }
});

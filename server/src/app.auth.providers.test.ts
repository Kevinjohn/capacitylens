import { describe, it, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app";
import { openDb } from "./db";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { call, PASSWORD_ENV, signUp } from "./testHelpers";
import {
  createInvite,
  listResourceAvatarProjection,
  setAccountMemberResourceLink,
  upsertMember,
} from "./controlTables";
import { microsoftCallbackCapture } from "./authConfig/captureContexts";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

// P3.1/P3.2/P3.5 (flag SMALLSASS_ACCOUNT_MODE → opts.authMode/auth). The load-bearing assertion set:
// OFF is byte-for-byte today (the whole existing app.test.ts suite already enforces that
// by running unchanged — these tests add the /api/auth/me surface and the absence of the
// Better Auth routes); password gates every data route on a real session; sso issues a
// provider redirect; any misconfiguration refuses to boot via AuthConfigError.

function parseConfiguredAuth(auth: ReturnType<typeof createAuthFromEnvironment>["auth"]) {
  if (auth === null) throw new Error("Expected authentication to be configured.");
  return auth;
}

const SSO_ENV = {
  ...PASSWORD_ENV,
  SMALLSASS_ACCOUNT_MODE: "sso",
  SMALLSASS_ACCOUNT_OIDC_CLIENT_ID: "client-id",
  SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET: "client-secret",
  SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: "https://idp.test/.well-known/openid-configuration",
  SMALLSASS_ACCOUNT_OIDC_ISSUER: "https://idp.test",
};

const MICROSOFT_ENV = {
  SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID: "ms-id",
  SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET: "ms-secret",
  SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID: "01234567-89ab-cdef-0123-456789abcdef",
  SMALLSASS_ACCOUNT_MAIL_HOST: "mail.example.test",
  SMALLSASS_ACCOUNT_MAIL_PORT: "587",
  SMALLSASS_ACCOUNT_MAIL_USER: "mailer",
  SMALLSASS_ACCOUNT_MAIL_PASSWORD: "test-mail-password",
  SMALLSASS_ACCOUNT_MAIL_FROM: "identity@example.test",
};

const NAMED_SSO_ENV = {
  ...PASSWORD_ENV,
  SMALLSASS_ACCOUNT_MODE: "sso",
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
};

async function appWithAuth(env: Record<string, string>): Promise<FastifyInstance> {
  const db = openDb(":memory:");
  const { mode, auth } = createAuthFromEnvironment(db, env);
  await runAuthMigrations(parseConfiguredAuth(auth));
  return createApp(db, { authMode: mode, auth });
}

function registerSsoClosedRouteTests(): void {
  it("publishes the configured strict OIDC presentation brand to signed-out clients", async () => {
    const app = await appWithAuth({ ...SSO_ENV, SMALLSASS_ACCOUNT_OIDC_BRAND: "google" });
    const response = await call(app, { method: "GET", url: "/api/auth/me" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      providers: [{ id: "sso", label: "Single sign-on", kind: "oidc", brand: "google", experimental: false }],
    });
    await app.close();
  });

  it.each([SSO_ENV, NAMED_SSO_ENV])(
    "keeps password mutation and invitation password signup closed (profile %#)",
    async (environment) => {
      const app = await appWithAuth(environment);
      expect(
        (
          await call(app, {
            method: "POST",
            url: "/api/auth/reset-password",
            payload: { token: "old-token", newPassword: "replacement-password-123" },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await call(app, {
            method: "POST",
            url: "/api/auth/change-password",
            payload: { currentPassword: "old-password", newPassword: "replacement-password-123" },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await call(app, {
            method: "POST",
            url: "/api/invites/invite-token/signup",
            payload: {
              email: "new@example.com",
              name: "New Member",
              password: "replacement-password-123",
            },
          })
        ).statusCode,
      ).toBe(404);
    },
  );
}

it("publishes Microsoft first-owner setup in provider-required mode", async () => {
  const app = await appWithAuth({ ...PASSWORD_ENV, ...MICROSOFT_ENV, SMALLSASS_ACCOUNT_MODE: "sso" });
  try {
    const response = await call(app, { method: "GET", url: "/api/auth/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      authMode: "sso",
      needsSetup: true,
      providers: [{ id: "microsoft", kind: "social", experimental: false }],
    });
  } finally {
    await app.close();
  }
});

function registerSsoRedirectTests(): void {
  it("discovers strict OIDC and issues a stateful PKCE redirect", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === SSO_ENV.SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL) {
        return new Response(
          JSON.stringify({
            issuer: "https://idp.test",
            authorization_endpoint: "https://idp.test/authorize",
            token_endpoint: "https://idp.test/token",
            userinfo_endpoint: "https://idp.test/userinfo",
            jwks_uri: "https://idp.test/jwks",
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            code_challenge_methods_supported: ["S256"],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    });
    try {
      const app = await appWithAuth(SSO_ENV);
      const res = await call(app, {
        method: "POST",
        url: "/api/auth/sign-in/social",
        payload: { provider: "sso", callbackURL: "/" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { url: string; redirect: boolean };
      const proxy = new URL(body.url);
      expect(body.redirect).toBe(true);
      expect(proxy.origin + proxy.pathname).toBe("http://localhost:8787/api/auth/oidc/authorize/sso");
      const resolved = await call(app, {
        method: "GET",
        url: proxy.pathname + proxy.search,
      });
      expect(resolved.statusCode).toBe(302);
      const redirect = new URL(String(resolved.headers.location));
      expect(redirect.origin + redirect.pathname).toBe("https://idp.test/authorize");
      expect(redirect.searchParams.get("response_type")).toBe("code");
      expect(redirect.searchParams.get("scope")?.split(" ")).toEqual(expect.arrayContaining(["openid"]));
      expect(redirect.searchParams.get("state")).toBeTruthy();
      expect(redirect.searchParams.get("code_challenge")).toBeTruthy();
      expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
}

// The suite owns one contiguous configured strict-OIDC lifecycle in addition to the small route checks.
// eslint-disable-next-line max-lines-per-function
describe("SMALLSASS_ACCOUNT_MODE sso", () => {
  registerSsoClosedRouteTests();
  registerSsoRedirectTests();

  // One stateful runtime sequence proves the configured generic OAuth plugin actually invokes
  // strict discovery, token and userinfo validation and persists the adapter's null clears.
  // eslint-disable-next-line max-lines-per-function
  it("persists strict-OIDC avatar updates and clears through the configured callback", async () => {
    const pair = await generateKeyPair("RS256");
    const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "strict-key", use: "sig", alg: "RS256" };
    let picture: unknown = "https://images.example/strict-a.png";
    let providerEmail = "bruce@wayne.test";
    let providerName = "Bruce Wayne";
    const token = () =>
      new SignJWT({ email: providerEmail, email_verified: true })
        .setProtectedHeader({ alg: "RS256", kid: "strict-key" })
        .setIssuer(SSO_ENV.SMALLSASS_ACCOUNT_OIDC_ISSUER)
        .setAudience(SSO_ENV.SMALLSASS_ACCOUNT_OIDC_CLIENT_ID)
        .setSubject("strict-subject")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(pair.privateKey);
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === SSO_ENV.SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL)
        return Response.json({
          issuer: SSO_ENV.SMALLSASS_ACCOUNT_OIDC_ISSUER,
          authorization_endpoint: "https://idp.test/authorize",
          token_endpoint: "https://idp.test/token",
          userinfo_endpoint: "https://idp.test/userinfo",
          jwks_uri: "https://idp.test/jwks",
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
        });
      if (url === "https://idp.test/token")
        return Response.json({ access_token: "strict-access", token_type: "Bearer", id_token: await token() });
      if (url === "https://idp.test/jwks") return Response.json({ keys: [publicJwk] });
      if (url === "https://idp.test/userinfo")
        return Response.json({
          sub: "strict-subject",
          email: providerEmail,
          email_verified: true,
          name: providerName,
          ...(picture === undefined ? {} : { picture }),
        });
      throw new Error(`Unexpected strict OIDC fetch: ${url}`);
    });
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, SSO_ENV, { externalIdentityAdmission: async () => true });
    const auth = parseConfiguredAuth(configured.auth);
    await runAuthMigrations(auth);
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('collision-user', 'Clark Kent', 'collision@wayne.test', 1, ?, ?)`,
    ).run("2026-09-14T10:00:00.000Z", "2026-09-14T10:00:00.000Z");
    db.prepare(
      `INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a1', 'Wayne Enterprises', '#6366f1', ?, ?)`,
    ).run("2026-09-14T10:00:00.000Z", "2026-09-14T10:00:00.000Z");
    db.prepare(
      `INSERT INTO resources (id, accountId, kind, name, role, color, employmentType, engagement, workingHoursPerDay, workingDays, halfDays, createdAt, updatedAt)
       VALUES ('bruce', 'a1', 'person', 'Bruce Wayne', 'Director', '#6366f1', 'employee', 'studio', 8, '[1,2,3,4,5]', '[]', ?, ?)`,
    ).run("2026-09-14T10:00:00.000Z", "2026-09-14T10:00:00.000Z");
    const app = createApp(db, { authMode: configured.mode, auth });
    const signIn = async () => {
      const start = await call(app, {
        method: "POST",
        url: "/api/auth/sign-in/social",
        payload: { provider: "sso", callbackURL: "/" },
      });
      const proxy = new URL((start.json() as { url: string }).url);
      const startCookie = String(start.headers["set-cookie"] ?? "").split(";", 1)[0];
      const authorize = await call(app, {
        method: "GET",
        url: proxy.pathname + proxy.search,
        headers: { cookie: startCookie },
      });
      const provider = new URL(String(authorize.headers.location));
      const callbackCookie = [startCookie, String(authorize.headers["set-cookie"] ?? "").split(";", 1)[0]].join("; ");
      return call(app, {
        method: "GET",
        url: `/api/auth/callback/sso?code=code&state=${encodeURIComponent(provider.searchParams.get("state") ?? "")}`,
        headers: { cookie: callbackCookie },
      });
    };
    let principalId: string | null = null;
    for (const [claim, expected, assertedEmail] of [
      ["https://images.example/strict-a.png", "https://images.example/strict-a.png", "bruce@wayne.test"],
      ["https://images.example/strict-b.png", "https://images.example/strict-b.png", "changed@wayne.test"],
      [undefined, null, "collision@wayne.test"],
      [null, null, "changed-again@wayne.test"],
      ["https://images.example/strict-a.png", "https://images.example/strict-a.png", "bruce@wayne.test"],
      ["javascript:alert(1)", null, "collision@wayne.test"],
    ] as const) {
      picture = claim;
      providerEmail = assertedEmail;
      providerName = assertedEmail === "bruce@wayne.test" ? "Bruce Wayne" : "Provider Renamed Bruce";
      expect((await signIn()).statusCode).toBe(302);
      principalId ??= (db.prepare(`SELECT id FROM user WHERE email = 'bruce@wayne.test'`).get() as { id: string }).id;
      expect(db.prepare(`SELECT email, name, image FROM user WHERE id = ?`).get(principalId)).toEqual({
        email: "bruce@wayne.test",
        name: "Bruce Wayne",
        image: expected,
      });
      if (!db.prepare(`SELECT 1 FROM account_member_resources WHERE userId = ?`).get(principalId)) {
        upsertMember(db, {
          accountId: "a1",
          userId: principalId,
          role: "viewer",
          status: "active",
          createdAt: "2026-09-14T10:00:00.000Z",
        });
        setAccountMemberResourceLink({
          db,
          accountId: "a1",
          userId: principalId,
          resourceId: "bruce",
          expectedRevision: null,
          now: "2026-09-14T10:00:00.000Z",
        });
      }
      expect(listResourceAvatarProjection(db, "a1")).toEqual(
        expected === null ? [] : [{ resourceId: "bruce", imageUrl: expected }],
      );
    }
    await app.close();
    db.close();
  });
});

// P1.7 — native social providers wired from env. Assert against the resolved betterAuth
// options (auth.options is the exact object we passed; see better-auth createBetterAuth),
// which is the robust introspection point in Better Auth 1.7.5.
// Keep the provider configuration and its real callback acceptance sequence together so the
// runtime overrides exercised below cannot drift from the configuration assertions.
// eslint-disable-next-line max-lines-per-function
describe("social providers (P1.7)", () => {
  const SOCIAL_ENV = {
    ...PASSWORD_ENV,
    SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-id",
    SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    ...MICROSOFT_ENV,
    SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID: "gh-id",
    SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET: "gh-secret",
  };

  it("inits all three (Google/Microsoft/GitHub) from env without throwing", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), SOCIAL_ENV);
    const social = parseConfiguredAuth(auth).options.socialProviders ?? {};
    expect(Object.keys(social).sort()).toEqual(["github", "google", "microsoft"]);
    expect(social.google).toMatchObject({
      clientId: "google-id",
      clientSecret: "google-secret",
    });
    expect(social.github).toMatchObject({
      clientId: "gh-id",
      clientSecret: "gh-secret",
    });
    // Microsoft always uses the configured work/school tenant.
    expect(social.microsoft).toMatchObject({
      clientId: "ms-id",
      clientSecret: "ms-secret",
      tenantId: SOCIAL_ENV.SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID,
    });
  });

  it("honours an explicit Microsoft tenant id", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), {
      ...SOCIAL_ENV,
      SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID: "abcdef01-2345-6789-abcd-ef0123456789",
    });
    expect(parseConfiguredAuth(auth).options.socialProviders?.microsoft).toMatchObject({
      tenantId: "abcdef01-2345-6789-abcd-ef0123456789",
    });
  });

  it("refreshes and clears Microsoft avatars by oid when sub and profile id differ", async () => {
    const db = openDb(":memory:");
    // Seed an established identity before installing the new-connection gate.
    const initial = createAuthFromEnvironment(db, PASSWORD_ENV);
    await runAuthMigrations(parseConfiguredAuth(initial.auth));
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES ('microsoft-user', 'Diana Prince', 'diana@wayne.test', 1, ?, ?)`,
    ).run("2026-09-14T10:00:00.000Z", "2026-09-14T10:00:00.000Z");
    db.prepare(
      `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
       VALUES ('microsoft-link', 'microsoft', 'microsoft-subject', 'microsoft-user', ?, ?)`,
    ).run("2026-09-14T10:00:00.000Z", "2026-09-14T10:00:00.000Z");
    const configured = parseConfiguredAuth(createAuthFromEnvironment(db, SOCIAL_ENV).auth);
    await runAuthMigrations(configured);
    const microsoft = configured.options.socialProviders?.microsoft;
    if (!microsoft || typeof microsoft === "function" || !microsoft.mapProfileToUser) {
      throw new Error("Expected configured Microsoft profile mapping.");
    }

    const profile = {
      id: "different-profile-id",
      sub: "different-pairwise-subject",
      oid: "microsoft-subject",
      iss: `https://login.microsoftonline.com/${SOCIAL_ENV.SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID}/v2.0`,
      tid: SOCIAL_ENV.SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID,
      aud: "ms-id",
      exp: Math.floor(Date.now() / 1000) + 300,
    };
    const capture = {
      request: new Request("http://localhost:8787/api/auth/callback/microsoft"),
      proofId: null,
      bootstrapClaimToken: null,
      pending: false,
    };
    const mapper = microsoft.mapProfileToUser;
    await microsoftCallbackCapture.run(capture, () =>
      mapper({
        ...profile,
        picture: "https://images.example/microsoft.png",
      } as never),
    );
    expect(db.prepare(`SELECT image FROM user WHERE id = 'microsoft-user'`).get()).toEqual({
      image: "https://images.example/microsoft.png",
    });
    await microsoftCallbackCapture.run(capture, () => mapper(profile as never));
    expect(db.prepare(`SELECT image FROM user WHERE id = 'microsoft-user'`).get()).toEqual({ image: null });
    db.close();
  });

  it("refuses a half-configured provider instead of silently hiding it", () => {
    expect(() =>
      createAuthFromEnvironment(openDb(":memory:"), {
        ...PASSWORD_ENV,
        SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID: "gh-id-only",
      }),
    ).toThrow(/must both be set/i);
  });

  it("is empty (no providers) when no social env is set", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), PASSWORD_ENV);
    expect(Object.keys(parseConfiguredAuth(auth).options.socialProviders ?? {})).toEqual([]);
  });

  // This intentionally follows one persisted subject through the complete sequential callback
  // lifecycle; splitting the sequence would replace the stateful integration guarantee with mocks.
  // eslint-disable-next-line max-lines-per-function
  it("persists repeated provider picture updates and explicit clears for the same subject", async () => {
    const db = openDb(":memory:");
    const { mode, auth } = createAuthFromEnvironment(
      db,
      { ...SOCIAL_ENV, SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP: "1" },
      { externalIdentityAdmission: async () => true },
    );
    const configured = parseConfiguredAuth(auth);
    const google = configured.options.socialProviders?.google;
    if (!google || typeof google === "function") throw new Error("Expected resolved Google provider options.");
    const mapProfileToUser = google.mapProfileToUser;
    if (!mapProfileToUser) throw new Error("Expected configured Google profile mapping.");
    let picture: string | null | undefined = "https://images.example/a.png";
    let providerEmail = "bruce@wayne.test";
    let providerName = "Bruce Wayne";
    google.verifyIdToken = async () => true;
    google.getUserInfo = async () => {
      const mapped = await mapProfileToUser({ sub: "google-subject-1", picture } as never);
      return {
        user: {
          name: providerName,
          email: providerEmail,
          emailVerified: true,
          ...mapped,
        },
        data: {
          aud: "test-audience",
          azp: "test-authorized-party",
          email: providerEmail,
          email_verified: true,
          exp: 4_102_444_800,
          family_name: "Wayne",
          given_name: "Bruce",
          iss: "https://accounts.google.com",
          iat: 0,
          name: providerName,
          picture: picture ?? "",
          sub: "google-subject-1",
        },
      };
    };
    await runAuthMigrations(configured);
    db.prepare(
      `INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a1', 'Wayne Enterprises', '#6366f1', ?, ?)`,
    ).run("2026-09-14T10:00:00.000Z", "2026-09-14T10:00:00.000Z");
    createInvite(db, {
      token: "provider-invite-token",
      id: "provider-invite",
      accountId: "a1",
      role: "viewer",
      preauthEmail: "bruce@wayne.test",
      expiresAt: "2099-01-01T00:00:00.000Z",
      usedAt: null,
      createdAt: "2026-09-14T10:00:00.000Z",
    });
    const app = createApp(db, { authMode: mode, auth: configured });
    const collision = await signUp(app, "collision@wayne.test");
    const collisionBefore = db.prepare(`SELECT email, name, image FROM user WHERE id = ?`).get(collision.userId);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
      if (String(input) === "https://oauth2.googleapis.com/token")
        return new Response(JSON.stringify({ access_token: "access", id_token: "header.payload.signature" }), {
          headers: { "content-type": "application/json" },
        });
      return originalFetch(input);
    });
    const signIn = async () => {
      const start = await call(app, {
        method: "POST",
        url: "/api/auth/sign-in/social",
        payload: { provider: "google", callbackURL: "/" },
      });
      const startBody = start.json() as { url: string };
      const authorization = new URL(startBody.url);
      const cookie = String(start.headers["set-cookie"] ?? "")
        .split(",")
        .map((value) => value.split(";", 1)[0])
        .join("; ");
      return call(app, {
        method: "GET",
        url: `/api/auth/callback/google?code=code&state=${encodeURIComponent(authorization.searchParams.get("state") ?? "")}`,
        headers: { cookie },
      });
    };
    let principalId: string | null = null;
    for (const [claim, expected, assertedEmail] of [
      ["https://images.example/a.png", "https://images.example/a.png", "bruce@wayne.test"],
      ["https://images.example/b.png", "https://images.example/b.png", "changed@wayne.test"],
      [undefined, null, "collision@wayne.test"],
      [null, null, "changed-again@wayne.test"],
      ["https://images.example/a.png", "https://images.example/a.png", "bruce@wayne.test"],
      ["javascript:alert(1)", null, "collision@wayne.test"],
    ] as const) {
      picture = claim;
      providerEmail = assertedEmail;
      providerName = assertedEmail === "bruce@wayne.test" ? "Bruce Wayne" : "Provider Renamed Bruce";
      expect((await signIn()).statusCode).toBe(302);
      principalId ??= (db.prepare(`SELECT id FROM user WHERE email = 'bruce@wayne.test'`).get() as { id: string }).id;
      expect(db.prepare(`SELECT email, name, image FROM user WHERE id = ?`).get(principalId)).toEqual({
        email: "bruce@wayne.test",
        name: "Bruce Wayne",
        image: expected,
      });
      expect(db.prepare(`SELECT email, name, image FROM user WHERE id = ?`).get(collision.userId)).toEqual(
        collisionBefore,
      );
    }
    if (principalId === null) throw new Error("Expected the configured provider callback to create a principal.");
    upsertMember(db, {
      accountId: "a1",
      userId: principalId,
      role: "viewer",
      status: "active",
      createdAt: "2026-09-14T10:00:00.000Z",
    });
    db.prepare(
      `INSERT INTO resources (id, accountId, kind, name, role, color, employmentType, engagement, workingHoursPerDay, workingDays, halfDays, createdAt, updatedAt) VALUES ('bruce', 'a1', 'person', 'Bruce Wayne', 'Director', '#6366f1', 'employee', 'studio', 8, '[1,2,3,4,5]', '[]', ?, ?)`,
    ).run("2026-09-14T10:00:00.000Z", "2026-09-14T10:00:00.000Z");
    setAccountMemberResourceLink({
      db,
      accountId: "a1",
      userId: principalId,
      resourceId: "bruce",
      expectedRevision: null,
      now: "2026-09-14T10:00:00.000Z",
    });
    expect(listResourceAvatarProjection(db, "a1")).toEqual([]);
    await app.close();
    db.close();
    vi.stubGlobal("fetch", originalFetch);
  });
});

// P1.7 + first-run setup — open email self-registration is closed by default. The single
// bootstrap exception is an empty user table plus the operator's setup token; the gate is enforced
// live per request, so it closes on the very next request after the first identity. The explicit
// SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP=1 escape still re-opens registration unconditionally.

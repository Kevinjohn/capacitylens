import { describe, it, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app";
import { openDb } from "./db";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { call, PASSWORD_ENV } from "./testHelpers";

// P3.1/P3.2/P3.5 (flag CAPACITYLENS_AUTH → opts.authMode/auth). The load-bearing assertion set:
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
  CAPACITYLENS_AUTH: "sso",
  CAPACITYLENS_SSO_CLIENT_ID: "client-id",
  CAPACITYLENS_SSO_CLIENT_SECRET: "client-secret",
  CAPACITYLENS_SSO_DISCOVERY_URL: "https://idp.test/.well-known/openid-configuration",
  CAPACITYLENS_SSO_ISSUER: "https://idp.test",
};

async function appWithAuth(env: Record<string, string>): Promise<FastifyInstance> {
  const db = openDb(":memory:");
  const { mode, auth } = createAuthFromEnvironment(db, env);
  await runAuthMigrations(parseConfiguredAuth(auth));
  return createApp(db, { authMode: mode, auth });
}

function registerSsoClosedRouteTests(): void {
  it("keeps password mutation and invitation password signup closed", async () => {
    const app = await appWithAuth(SSO_ENV);
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
  });
}

function registerSsoRedirectTests(): void {
  it("discovers strict OIDC and issues a stateful PKCE redirect", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === SSO_ENV.CAPACITYLENS_SSO_DISCOVERY_URL) {
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
        url: "/api/auth/sign-in/oauth2",
        payload: { providerId: "sso", callbackURL: "/" },
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

describe("CAPACITYLENS_AUTH sso", () => {
  registerSsoClosedRouteTests();
  registerSsoRedirectTests();
});

// P1.7 — native social providers wired from env. Assert against the resolved betterAuth
// options (auth.options is the exact object we passed; see better-auth createBetterAuth),
// which is the robust introspection point in this version (1.6.23).
describe("social providers (P1.7)", () => {
  const SOCIAL_ENV = {
    ...PASSWORD_ENV,
    CAPACITYLENS_GOOGLE_CLIENT_ID: "google-id",
    CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
    CAPACITYLENS_MICROSOFT_CLIENT_ID: "ms-id",
    CAPACITYLENS_MICROSOFT_CLIENT_SECRET: "ms-secret",
    CAPACITYLENS_GITHUB_CLIENT_ID: "gh-id",
    CAPACITYLENS_GITHUB_CLIENT_SECRET: "gh-secret",
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
    // Microsoft tenantId defaults to 'common' when not pinned.
    expect(social.microsoft).toMatchObject({
      clientId: "ms-id",
      clientSecret: "ms-secret",
      tenantId: "common",
    });
  });

  it("honours an explicit Microsoft tenant id", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), {
      ...SOCIAL_ENV,
      CAPACITYLENS_MICROSOFT_TENANT_ID: "tenant-123",
    });
    expect(parseConfiguredAuth(auth).options.socialProviders?.microsoft).toMatchObject({
      tenantId: "tenant-123",
    });
  });

  it("refuses a half-configured provider instead of silently hiding it", () => {
    expect(() =>
      createAuthFromEnvironment(openDb(":memory:"), {
        ...PASSWORD_ENV,
        CAPACITYLENS_GITHUB_CLIENT_ID: "gh-id-only",
      }),
    ).toThrow(/must both be set/i);
  });

  it("is empty (no providers) when no social env is set", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), PASSWORD_ENV);
    expect(Object.keys(parseConfiguredAuth(auth).options.socialProviders ?? {})).toEqual([]);
  });
});

// P1.7 + first-run setup — open email self-registration is closed by default. The single
// bootstrap exception is an empty user table plus the operator's setup token; the gate is enforced
// live per request, so it closes on the very next request after the first identity. The explicit
// CAPACITYLENS_ALLOW_OPEN_SIGNUP=1 escape still re-opens registration unconditionally.

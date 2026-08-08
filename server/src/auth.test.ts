import { afterEach, describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { initializeOpenDb, openDb as openDbRaw, planDatabaseMigrations } from "./db";
import {
  authFromEnv,
  assertStrictOidcEmailAdmission,
  assertFederatedIdentitySchemaCurrent,
  ensureAuthControlTables,
  planAuthSchemaMigrations,
  providerIdFromExternalContext,
  revokeFederatedLinkStateInTx,
  runAuthMigrations,
  hashPasswordWithBackpressure,
  verifyPasswordWithBackpressure,
  countUsers,
} from "./auth";
import type { PasswordHasher } from "./passwordSecurity";
import { WorkQueueFullError } from "./workQueue";
import { assertBootstrapClaimCurrent } from "./bootstrapClaim";
import { localExternalIdentityAdmission } from "./accounts/externalIdentityAdmission";
import { hasLivePreauthorizedInvitation } from "./accounts/sqliteAccountAdminPort";
import { betterAuthIdentityPort } from "./accounts/betterAuthIdentityPort";
import { evaluateSsoCutoverReadiness } from "./accounts/ssoCutover";
import { createFederatedLinkCeremony, reconcileObservedFederatedLinks } from "./federatedLinkLifecycle";

const admissionDependencies = (db: ReturnType<typeof openDbRaw>) => ({
  identityHasAnyPrincipal: () => countUsers(db) !== 0,
  hasLivePreauthorizedInvitation: (email: string) => hasLivePreauthorizedInvitation(db, email),
});
import { TENANT_ENTITY_ACCOUNT_INDEXES_V21 } from "./tenantIndexes";
import { registerServerFixtureCleanup } from "./testHelpers";

// P1.16 — session-cookie + session-lifetime hardening, asserted by INTROSPECTING the resolved
// betterAuth options (auth.options is the exact object we passed; same robust point P1.7 uses for
// socialProviders). These are auth-ON-only: in OFF mode betterAuth is never constructed, so there
// are no options to harden — authFromEnv returns { mode:'off', auth:null } untouched.

const PASSWORD_ENV = {
  CAPACITYLENS_AUTH: "password",
  BETTER_AUTH_SECRET: "unit-test-secret-0123456789abcdef-0123", // 32+ chars (MIN_BETTER_AUTH_SECRET_LENGTH)
  BETTER_AUTH_URL: "http://localhost:8787",
};

const fixtures = registerServerFixtureCleanup();
const openDb = (...args: Parameters<typeof openDbRaw>) => fixtures.trackDb(openDbRaw(...args));

describe("password verification backpressure", () => {
  it("maps scrypt saturation to a retryable service-unavailable API error", async () => {
    const hasher: PasswordHasher = {
      hash: vi.fn(),
      verify: vi.fn().mockRejectedValue(new WorkQueueFullError("Password processing is at capacity.", "full")),
    };

    await expect(
      verifyPasswordWithBackpressure(hasher, { hash: "stored", password: "correct password" }),
    ).rejects.toMatchObject({
      status: "SERVICE_UNAVAILABLE",
      body: expect.objectContaining({ code: "PASSWORD_PROCESSING_UNAVAILABLE" }),
    });
  });

  it("maps new-hash saturation to the same retryable service-unavailable API error", async () => {
    const hasher: PasswordHasher = {
      hash: vi.fn().mockRejectedValue(new WorkQueueFullError("Password processing is at capacity.", "full")),
      verify: vi.fn(),
    };

    await expect(hashPasswordWithBackpressure(hasher, "correct horse battery staple")).rejects.toMatchObject({
      status: "SERVICE_UNAVAILABLE",
      body: expect.objectContaining({ code: "PASSWORD_PROCESSING_UNAVAILABLE" }),
    });
  });
});

describe("federated link observation reconciliation", () => {
  it("rejects a reserved observation trigger whose body does not match the v25 definition", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(configured.auth!);
    db.exec(`
      DROP TRIGGER capacitylens_observe_federated_account;
      CREATE TRIGGER capacitylens_observe_federated_account
      AFTER INSERT ON account
      WHEN NEW.providerId <> 'credential' AND 0
      BEGIN
        SELECT 'capacitylens_federated_link_observations';
      END;
    `);

    expect(() => assertFederatedIdentitySchemaCurrent(db)).toThrow(/invalid capacitylens_observe_federated_account/i);
  });

  it("requires verified email for admission/linking unless a returning subject has durable proof", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_SSO_CLIENT_ID: "client-id",
      CAPACITYLENS_SSO_CLIENT_SECRET: "client-secret",
      CAPACITYLENS_SSO_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
      CAPACITYLENS_SSO_ISSUER: "https://idp.example",
      CAPACITYLENS_SSO_PROVIDER_ID: "workforce",
    });
    await runAuthMigrations(configured.auth!);
    const timestamp = "2026-08-07T00:00:00.000Z";
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run("principal-1", "Member", "member@example.com", timestamp, timestamp);
    db.prepare(
      `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("link-1", "workforce", "known-subject", "principal-1", timestamp, timestamp);

    expect(() => assertStrictOidcEmailAdmission(db, "workforce", { sub: "new-subject", emailVerified: false })).toThrow(
      /verified email/i,
    );
    expect(() =>
      assertStrictOidcEmailAdmission(db, "workforce", { sub: "known-subject", emailVerified: false }),
    ).not.toThrow();
    db.prepare(`DELETE FROM capacitylens_federated_link_observations WHERE accountRowId = ?`).run("link-1");
    expect(() =>
      assertStrictOidcEmailAdmission(db, "workforce", { sub: "known-subject", emailVerified: false }),
    ).toThrow(/verified email/i);
    expect(() =>
      assertStrictOidcEmailAdmission(db, "workforce", { sub: "new-subject", emailVerified: true }),
    ).not.toThrow();
  });

  it("admits a direct OIDC identity as verified on SSO-only restart and emits one stable audit", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_SSO_CLIENT_ID: "client-id",
      CAPACITYLENS_SSO_CLIENT_SECRET: "client-secret",
      CAPACITYLENS_SSO_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
      CAPACITYLENS_SSO_ISSUER: "https://idp.example",
      CAPACITYLENS_SSO_PROVIDER_ID: "workforce",
    });
    await runAuthMigrations(configured.auth!);
    const timestamp = "2026-08-07T00:00:00.000Z";
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run("principal-1", "Member", "member@example.com", timestamp, timestamp);
    db.prepare(
      `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("link-1", "workforce", "subject-1", "principal-1", timestamp, timestamp);
    db.prepare(
      `INSERT INTO capacitylens_federated_link_ceremonies
        (id, principalId, providerId, createdAt, expiresAt, completedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("ceremony-1", "principal-1", "workforce", timestamp, "2099-01-01T00:00:00.000Z", timestamp);

    const identity = betterAuthIdentityPort({
      applicationId: "capacitylens",
      auth: configured.auth!,
      authMode: "sso",
      db,
    }).inspectSsoCutover("workforce");
    expect(
      evaluateSsoCutoverReadiness({
        provider: configured.auth!.strictProvider!,
        providers: configured.auth!.providers,
        identity,
        workspaces: [
          {
            workspaceId: "workspace-1",
            workspaceName: "Studio",
            members: [{ principalId: "principal-1", role: "owner", status: "active" }],
          },
        ],
        openSignup: false,
      }).ready,
    ).toBe(true);

    configured.auth!.reconcileFederatedLinks!();
    configured.auth!.reconcileFederatedLinks!();

    expect(db.prepare(`SELECT * FROM capacitylens_federated_link_observations`).all()).toEqual([
      expect.objectContaining({
        accountRowId: "link-1",
        principalId: "principal-1",
        providerId: "workforce",
        subject: "subject-1",
        verifiedAt: expect.any(String),
        auditedAt: expect.any(String),
      }),
    ]);
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
    expect(db.prepare(`SELECT id FROM capacitylens_audit_outbox`).all()).toEqual([{ id: "identity-link:link-1" }]);
  });

  it("keeps an interrupted zero-row ceremony until expiry and then removes it", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_SSO_CLIENT_ID: "client-id",
      CAPACITYLENS_SSO_CLIENT_SECRET: "client-secret",
      CAPACITYLENS_SSO_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
      CAPACITYLENS_SSO_ISSUER: "https://idp.example",
      CAPACITYLENS_SSO_PROVIDER_ID: "workforce",
    });
    await runAuthMigrations(configured.auth!);
    const ceremony = createFederatedLinkCeremony(db, "principal-1", "workforce");

    configured.auth!.reconcileFederatedLinks!();
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([{ id: ceremony.id }]);

    db.prepare(`UPDATE capacitylens_federated_link_ceremonies SET expiresAt = ? WHERE id = ?`).run(
      "2000-01-01T00:00:00.000Z",
      ceremony.id,
    );
    configured.auth!.reconcileFederatedLinks!();
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
  });

  it("does not acquire a SQLite write lock when reconciliation has no work", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(configured.auth!);
    let immediateTransactions = 0;
    const observedDb = new Proxy(db, {
      get(target, property) {
        if (property === "exec") {
          return (sql: string) => {
            if (sql === "BEGIN IMMEDIATE") immediateTransactions += 1;
            return target.exec(sql);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    reconcileObservedFederatedLinks(observedDb, "capacitylens", () => []);

    expect(immediateTransactions).toBe(0);
  });

  it("supersedes an abandoned link ceremony when the same principal begins again", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_SSO_CLIENT_ID: "client-id",
      CAPACITYLENS_SSO_CLIENT_SECRET: "client-secret",
      CAPACITYLENS_SSO_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
      CAPACITYLENS_SSO_ISSUER: "https://idp.example",
      CAPACITYLENS_SSO_PROVIDER_ID: "workforce",
    });
    await runAuthMigrations(configured.auth!);
    createFederatedLinkCeremony(db, "principal-1", "workforce", "abandoned");
    db.prepare(
      `INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "old-oauth-state",
      "old-state",
      JSON.stringify({ oauthState: "old-state", link: { userId: "principal-1", email: "one@example.com" } }),
      Date.now() + 60_000,
      Date.now(),
      Date.now(),
    );

    expect(
      createFederatedLinkCeremony(db, "principal-1", "workforce", "replacement", () =>
        revokeFederatedLinkStateInTx(db, "principal-1"),
      ).id,
    ).toBe("replacement");
    expect(
      db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies WHERE principalId = ?`).all("principal-1"),
    ).toEqual([{ id: "replacement" }]);
    expect(db.prepare(`SELECT id FROM verification`).all()).toEqual([]);
  });

  it("preserves one observed row when an interrupted callback attempts a second subject", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_SSO_CLIENT_ID: "client-id",
      CAPACITYLENS_SSO_CLIENT_SECRET: "client-secret",
      CAPACITYLENS_SSO_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
      CAPACITYLENS_SSO_ISSUER: "https://idp.example",
      CAPACITYLENS_SSO_PROVIDER_ID: "workforce",
    });
    await runAuthMigrations(configured.auth!);
    const timestamp = "2026-08-07T00:00:00.000Z";
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run("principal-1", "Member", "member@example.com", timestamp, timestamp);
    createFederatedLinkCeremony(db, "principal-1", "workforce");
    db.prepare(
      `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("link-1", "workforce", "subject-1", "principal-1", timestamp, timestamp);

    expect(() =>
      db
        .prepare(
          `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("link-2", "workforce", "subject-2", "principal-1", timestamp, timestamp),
    ).toThrow(/unique constraint/i);
    configured.auth!.reconcileFederatedLinks!();

    expect(db.prepare(`SELECT id, accountId FROM account WHERE providerId = 'workforce'`).all()).toEqual([
      { id: "link-1", accountId: "subject-1" },
    ]);
    expect(db.prepare(`SELECT accountRowId FROM capacitylens_federated_link_observations`).all()).toEqual([
      { accountRowId: "link-1" },
    ]);
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
  });
});

describe("startup configuration before database migration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("can resolve auth options without DDL, then maintains controls after app migration", () => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    const configured = authFromEnv(db, PASSWORD_ENV, { deferDatabaseSetup: true });
    expect(configured.auth).not.toBeNull();
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()).toEqual([]);
    expect(() => ensureAuthControlTables(db, PASSWORD_ENV)).toThrow(/does not match the current application schema/i);

    expect(planDatabaseMigrations(db).migrations.at(-1)).toEqual(expect.objectContaining({ version: 25 }));
    initializeOpenDb(db, ":memory:");
    ensureAuthControlTables(db, PASSWORD_ENV);
    expect(() => assertBootstrapClaimCurrent(db)).not.toThrow();
    db.close();
  });

  it("verifies owned federated constraints even before Better Auth creates account tables", () => {
    const db = openDb(":memory:");
    db.exec(`DROP INDEX idx_capacitylens_federated_link_ceremonies_principal`);

    expect(() => assertFederatedIdentitySchemaCurrent(db)).toThrow(/ceremony index definition/i);
  });

  it.each(["not-a-timestamp", "2999-01-01T00:00:00.000Z"])(
    "repairs a stranded bootstrap claim with invalid timing metadata: %s",
    (claimedAt) => {
      const db = openDb(":memory:");
      db.prepare(`INSERT INTO capacitylens_bootstrap_claim (id, claimedAt, claimToken) VALUES (1, ?, ?)`).run(
        claimedAt,
        "stranded-claim",
      );
      ensureAuthControlTables(db, PASSWORD_ENV);
      expect(db.prepare(`SELECT id FROM capacitylens_bootstrap_claim`).get()).toBeUndefined();
      db.close();
    },
  );

  it("leaves a bare database untouched when provider configuration is invalid", () => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    expect(() => authFromEnv(db, { ...PASSWORD_ENV, CAPACITYLENS_GOOGLE_CLIENT_ID: "id-without-secret" })).toThrow(
      /google/i,
    );
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()).toEqual([]);
    db.close();
  });

  it("rejects a malformed configured trusted origin instead of silently dropping it", () => {
    const db = openDb(":memory:");

    expect(() => authFromEnv(db, PASSWORD_ENV, { trustedOrigins: ["not an absolute URL"] })).toThrow(
      /trusted origin.*absolute URL/i,
    );
  });

  it("refuses an OIDC issuer with query or fragment identity ambiguity", () => {
    expect(() =>
      authFromEnv(openDb(":memory:"), {
        ...PASSWORD_ENV,
        CAPACITYLENS_SSO_CLIENT_ID: "client",
        CAPACITYLENS_SSO_CLIENT_SECRET: "secret",
        CAPACITYLENS_SSO_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
        CAPACITYLENS_SSO_ISSUER: "https://idp.example/tenant?version=2",
      }),
    ).toThrow(/query string or fragment/i);
  });

  it.each([
    ["openid profile", "email"],
    ["openid email", "profile"],
    ["profile email", "openid"],
    ["openid", "profile, email"],
  ])("refuses strict OIDC scopes %j because %s is required", (scopes, missing) => {
    expect(() =>
      authFromEnv(openDb(":memory:"), {
        ...PASSWORD_ENV,
        CAPACITYLENS_SSO_CLIENT_ID: "client",
        CAPACITYLENS_SSO_CLIENT_SECRET: "secret",
        CAPACITYLENS_SSO_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
        CAPACITYLENS_SSO_ISSUER: "https://idp.example",
        CAPACITYLENS_SSO_SCOPES: scopes,
      }),
    ).toThrow(new RegExp(`requires the ${missing} scope`));
  });

  it("refuses public URLs that are not a bare origin", () => {
    for (const publicUrl of [
      "https://user:pass@capacity.example",
      "https://capacity.example/deployment",
      "https://capacity.example?tenant=one",
      "https://capacity.example#fragment",
    ]) {
      expect(() =>
        authFromEnv(openDb(":memory:"), {
          ...PASSWORD_ENV,
          BETTER_AUTH_URL: publicUrl,
        }),
      ).toThrow(/must be an origin/);
    }
  });

  it("issuer-validates discovery before the browser reaches its authorization endpoint", async () => {
    const discoveryUrl = "https://idp.example/.well-known/openid-configuration";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          issuer: "https://idp.example",
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          authorization_endpoint: "https://login.idp.example/authorize",
          token_endpoint: "https://idp.example/token",
          jwks_uri: "https://idp.example/keys",
          userinfo_endpoint: "https://idp.example/userinfo",
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
    );
    const { auth } = authFromEnv(openDb(":memory:"), {
      ...PASSWORD_ENV,
      CAPACITYLENS_SSO_CLIENT_ID: "client",
      CAPACITYLENS_SSO_CLIENT_SECRET: "secret",
      CAPACITYLENS_SSO_DISCOVERY_URL: discoveryUrl,
      CAPACITYLENS_SSO_ISSUER: "https://idp.example",
    });
    const response = await auth!.handler(
      new Request("http://localhost:8787/api/auth/oidc/authorize/sso?client_id=client&state=opaque&scope=openid"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://login.idp.example/authorize?client_id=client&state=opaque&scope=openid",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed before redirect when discovery does not match the pinned issuer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          issuer: "https://attacker.example",
          authorization_endpoint: "https://attacker.example/authorize",
          token_endpoint: "https://attacker.example/token",
          jwks_uri: "https://attacker.example/keys",
          userinfo_endpoint: "https://attacker.example/userinfo",
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      ),
    );
    const { auth } = authFromEnv(openDb(":memory:"), {
      ...PASSWORD_ENV,
      CAPACITYLENS_SSO_CLIENT_ID: "client",
      CAPACITYLENS_SSO_CLIENT_SECRET: "secret",
      CAPACITYLENS_SSO_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
      CAPACITYLENS_SSO_ISSUER: "https://idp.example",
    });

    const response = await auth!.handler(
      new Request("http://localhost:8787/api/auth/oidc/authorize/sso?client_id=client&state=opaque"),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:8787/?externalSignInError=1&error=provider_unavailable",
    );
    expect(response.headers.get("location")).not.toContain("attacker.example");
  });

  it("plans both the app-owned control migration and Better Auth DDL before executing either", async () => {
    const db = openDb(":memory:");
    for (const { index } of TENANT_ENTITY_ACCOUNT_INDEXES_V21) db.exec(`DROP INDEX ${index}`);
    db.exec(`
      DROP TABLE capacitylens_bootstrap_claim;
      DELETE FROM capacitylens_schema_migrations WHERE version >= 20;
      PRAGMA user_version = 19;
    `);
    const configured = authFromEnv(db, PASSWORD_ENV, { deferDatabaseSetup: true });
    expect(planDatabaseMigrations(db).migrations).toEqual([
      expect.objectContaining({ version: 20, name: "version-bootstrap-claim-control" }),
      expect.objectContaining({ version: 21, name: "index-tenant-entity-slices" }),
      expect.objectContaining({ version: 22, name: "reactivate-builtin-internal-clients" }),
      expect.objectContaining({ version: 23, name: "index-foreign-key-children" }),
      expect.objectContaining({ version: 24, name: "bound-used-invitation-history" }),
      expect.objectContaining({ version: 25, name: "secure-federated-identity-linking" }),
    ]);
    const before = await planAuthSchemaMigrations(configured.auth!);
    expect(before.pending).toBe(true);
    expect(before.tables).toContain("user");

    initializeOpenDb(db, ":memory:");
    ensureAuthControlTables(db, PASSWORD_ENV);
    await runAuthMigrations(configured.auth!);
    expect(planDatabaseMigrations(db).migrations).toEqual([]);
    await expect(planAuthSchemaMigrations(configured.auth!)).resolves.toEqual({ pending: false, tables: [] });
    db.close();
  });
});

describe("cookie/session hardening (P1.16)", () => {
  it("pins sameSite:lax + httpOnly on the session cookie", () => {
    const { auth } = authFromEnv(openDb(":memory:"), PASSWORD_ENV);
    expect(auth!.options.advanced?.defaultCookieAttributes).toEqual({ sameSite: "lax", httpOnly: true });
    expect(auth!.options.advanced?.cookiePrefix).toBe("capacitylens");
  });

  it("derives an insecure development cookie from an HTTP public URL", () => {
    expect(authFromEnv(openDb(":memory:"), PASSWORD_ENV).auth!.options.advanced?.useSecureCookies).toBe(false);
  });

  it("sets a valid __Host prefix and Secure from the HTTPS public URL even behind an HTTP proxy hop", () => {
    const { auth } = authFromEnv(openDb(":memory:"), {
      ...PASSWORD_ENV,
      BETTER_AUTH_URL: "https://capacity.example",
    });
    // Better Auth's built-in switch is deliberately false because it prepends `__Secure-`.
    // CapacityLens supplies Secure directly so the stricter `__Host-` prefix remains first.
    expect(auth!.options.advanced?.useSecureCookies).toBe(false);
    expect(auth!.options.advanced?.cookiePrefix).toBe("__Host-capacitylens");
    expect(auth!.options.advanced?.defaultCookieAttributes).toEqual({
      sameSite: "lax",
      httpOnly: true,
      secure: true,
    });
  });

  it("refuses a plaintext non-loopback public URL in production", () => {
    expect(() =>
      authFromEnv(openDb(":memory:"), {
        ...PASSWORD_ENV,
        NODE_ENV: "production",
        BETTER_AUTH_URL: "http://capacity.example",
      }),
    ).toThrow(/must use https:\/\//);
  });

  it("inherits the production HTTPS posture when an explicit environment omits NODE_ENV", () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() =>
        authFromEnv(openDb(":memory:"), {
          ...PASSWORD_ENV,
          BETTER_AUTH_URL: "http://capacity.example",
        }),
      ).toThrow(/must use https:\/\//);
    } finally {
      if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnvironment;
    }
  });

  it("still permits loopback HTTP for a local production-container check", () => {
    expect(() =>
      authFromEnv(openDb(":memory:"), {
        ...PASSWORD_ENV,
        NODE_ENV: "production",
        BETTER_AUTH_URL: "http://localhost:8787",
      }),
    ).not.toThrow();
  });

  it("pins a 12-hour absolute lifetime with no sliding refresh and a 15-minute fresh window", () => {
    const { auth } = authFromEnv(openDb(":memory:"), PASSWORD_ENV);
    expect(auth!.options.session?.expiresIn).toBe(43_200);
    expect(auth!.options.session?.disableSessionRefresh).toBe(true);
    expect(auth!.options.session?.freshAge).toBe(900);
  });

  it("OFF mode constructs no betterAuth instance — nothing to harden (auth === null)", () => {
    const { mode, auth } = authFromEnv(openDb(":memory:"), { CAPACITYLENS_AUTH: "off" });
    expect(mode).toBe("off");
    expect(auth).toBeNull();
  });
});

describe("external identity creation gate", () => {
  it("resolves the concrete provider from a parameterized database-hook route", () => {
    expect(
      providerIdFromExternalContext({
        path: "/oauth2/callback/:providerId",
        params: { providerId: "sso" },
      }),
    ).toBe("sso");
    expect(providerIdFromExternalContext({ path: "/callback/google" })).toBe("google");
    expect(providerIdFromExternalContext({ path: "/oauth2/callback/:providerId" })).toBeNull();
  });

  it("disables implicit email-based account linking", () => {
    const { auth } = authFromEnv(openDb(":memory:"), PASSWORD_ENV);
    expect(auth!.options.account?.accountLinking?.disableImplicitLinking).toBe(true);
  });

  it("binds every configured external provider to a stable issuer namespace", () => {
    const db = openDb(":memory:");
    const { auth } = authFromEnv(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
    });
    expect(auth!.federatedIssuers.get("google")).toBe("https://accounts.google.com");
    expect(
      db.prepare(`SELECT issuer FROM account_federated_provider_bindings WHERE providerId = 'google'`).get(),
    ).toEqual({ issuer: "https://accounts.google.com" });
  });

  it("stays enforced when open email registration is deliberately enabled", async () => {
    const db = openDb(":memory:");
    const { auth } = authFromEnv(
      db,
      {
        ...PASSWORD_ENV,
        CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
        CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
        CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
      },
      {
        externalIdentityAdmission: async () => false,
      },
    );
    const before = auth!.options.databaseHooks?.user?.create?.before;
    expect(before).toBeTypeOf("function");

    await expect(
      before!({ email: "stranger@example.com", emailVerified: true } as never, { path: "/callback/google" } as never),
    ).rejects.toThrow(/not invited/);
  });

  it("keeps named social providers as existing-principal sign-in doors in SSO-only mode", async () => {
    const db = openDb(":memory:");
    const { auth } = authFromEnv(
      db,
      {
        ...PASSWORD_ENV,
        CAPACITYLENS_AUTH: "sso",
        CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
        CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
        CAPACITYLENS_SSO_CLIENT_ID: "strict-client",
        CAPACITYLENS_SSO_CLIENT_SECRET: "strict-secret",
        CAPACITYLENS_SSO_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
        CAPACITYLENS_SSO_ISSUER: "https://idp.example",
      },
      { externalIdentityAdmission: async () => true },
    );
    const before = auth!.options.databaseHooks?.user?.create?.before;
    expect(before).toBeTypeOf("function");

    await expect(
      before!({ email: "new-social@example.com", emailVerified: true } as never, { path: "/callback/google" } as never),
    ).rejects.toMatchObject({ body: expect.objectContaining({ code: "STRICT_PROVIDER_REQUIRED" }) });
  });

  it("keeps the first-external-identity claim control when email registration is open", () => {
    const db = openDb(":memory:");
    const env = {
      ...PASSWORD_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
      CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
    };
    authFromEnv(db, env);

    expect(() => assertBootstrapClaimCurrent(db)).not.toThrow();
    expect(db.prepare(`PRAGMA table_info(capacitylens_bootstrap_claim)`).all()).not.toEqual([]);
  });

  it("allows only a verified, explicitly allow-listed first identity", () => {
    const db = openDb(":memory:");
    authFromEnv(db, PASSWORD_ENV); // initializes Better Auth's user table
    const env = { CAPACITYLENS_SSO_BOOTSTRAP_EMAILS: " owner@example.com, second@example.com " };
    expect(
      localExternalIdentityAdmission({
        ...admissionDependencies(db),
        bootstrapEmails: env.CAPACITYLENS_SSO_BOOTSTRAP_EMAILS,
        candidate: { email: "OWNER@example.com", emailVerified: true },
      }),
    ).toBe(true);
    expect(
      localExternalIdentityAdmission({
        ...admissionDependencies(db),
        bootstrapEmails: env.CAPACITYLENS_SSO_BOOTSTRAP_EMAILS,
        candidate: { email: "owner@example.com", emailVerified: false },
      }),
    ).toBe(false);
    expect(
      localExternalIdentityAdmission({
        ...admissionDependencies(db),
        bootstrapEmails: env.CAPACITYLENS_SSO_BOOTSTRAP_EMAILS,
        candidate: { email: "stranger@example.com", emailVerified: true },
      }),
    ).toBe(false);
    expect(
      localExternalIdentityAdmission({
        ...admissionDependencies(db),
        bootstrapEmails: "not-an-email",
        candidate: { email: "not-an-email", emailVerified: true },
      }),
    ).toBe(false);
  });

  it("allows a verified email with a live unused pre-authorised invite after bootstrap", async () => {
    const db = openDb(":memory:");
    const { auth } = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(auth!);
    await auth!.createCredentialUser("existing-owner@example.com", "Existing Owner", "Unrelated-phrase-4827!", true);
    db.prepare(
      `INSERT INTO accounts (id, name, color, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)`,
    ).run("account-1", "Inviting workspace", "#6366f1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO invites
      (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      "hash",
      "invite-1",
      "account-1",
      "viewer",
      "person@example.com",
      "2999-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );

    expect(
      localExternalIdentityAdmission({
        ...admissionDependencies(db),
        bootstrapEmails: undefined,
        candidate: { email: " Person@Example.com ", emailVerified: true },
      }),
    ).toBe(true);
    expect(
      localExternalIdentityAdmission({
        ...admissionDependencies(db),
        bootstrapEmails: undefined,
        candidate: { email: "person@example.com", emailVerified: false },
      }),
    ).toBe(false);
  });

  it("does not let an invitation replace the first-external-identity allow-list", () => {
    const db = openDb(":memory:");
    authFromEnv(db, PASSWORD_ENV);
    db.prepare(
      `INSERT INTO invites
      (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      "hash",
      "invite-1",
      "account-1",
      "viewer",
      "person@example.com",
      "2999-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );

    expect(
      localExternalIdentityAdmission({
        ...admissionDependencies(db),
        bootstrapEmails: undefined,
        candidate: { email: "person@example.com", emailVerified: true },
      }),
    ).toBe(false);
    expect(
      localExternalIdentityAdmission({
        ...admissionDependencies(db),
        bootstrapEmails: "person@example.com",
        candidate: { email: "person@example.com", emailVerified: true },
      }),
    ).toBe(true);
  });

  it("rejects expired and consumed invitations after bootstrap", async () => {
    const db = openDb(":memory:");
    const { auth } = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(auth!);
    await auth!.createCredentialUser("existing-owner@example.com", "Existing Owner", "Unrelated-phrase-4827!", true);
    const insert = db.prepare(`INSERT INTO invites
      (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run(
      "expired-hash",
      "expired",
      "account-1",
      "viewer",
      "expired@example.com",
      "2000-01-01T00:00:00.000Z",
      null,
      "1999-01-01T00:00:00.000Z",
    );
    insert.run(
      "used-hash",
      "used",
      "account-1",
      "viewer",
      "used@example.com",
      "2999-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    expect(
      localExternalIdentityAdmission({
        ...admissionDependencies(db),
        bootstrapEmails: undefined,
        candidate: { email: "expired@example.com", emailVerified: true },
      }),
    ).toBe(false);
    expect(
      localExternalIdentityAdmission({
        ...admissionDependencies(db),
        bootstrapEmails: undefined,
        candidate: { email: "used@example.com", emailVerified: true },
      }),
    ).toBe(false);
  });
});

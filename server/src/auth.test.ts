import { afterEach, describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { initializeOpenDb, openDb as openDbRaw, planDatabaseMigrations } from "./db";
import {
  createAuthFromEnvironment,
  assertFederatedIdentitySchemaCurrent,
  ensureAuthControlTables,
  planAuthSchemaMigrations,
  parseProviderIdFromExternalContext,
  revokeFederatedLinkStateInTx,
  runAuthMigrations,
  hashPasswordWithBackpressure,
  verifyPasswordWithBackpressure,
  countUsers,
} from "./auth";
import type { PasswordHasher } from "./passwordSecurity";
import { WorkQueueFullError } from "./workQueue";
import { assertBootstrapClaimCurrent } from "./bootstrapClaim";
import { canAdmitLocalExternalIdentity } from "./accounts/externalIdentityAdmission";
import { hasLivePreauthorizedInvitation } from "./accounts/sqliteAccountAdminPort";
import { createBetterAuthIdentityPort } from "./accounts/betterAuthIdentityPort";
import { assertCompanyProviderCutoverReady } from "./accounts/companyProviderReadiness";
import { createFederatedLinkCeremony, reconcileObservedFederatedLinks } from "./federatedLinkLifecycle";
import { readVerifiedMicrosoftProfile } from "./authConfig/socialProviders";
import { CHECKSUM_PINNED_MIGRATIONS, MICROSOFT_PROOF_V46_PIN } from "./db/migrations/authPlanningPins.testSupport";
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
  SMALLSASS_ACCOUNT_MODE: "password-only",
  SMALLSASS_ACCOUNT_SECRET: "unit-test-secret-0123456789abcdef-0123", // 32+ chars (MIN_BETTER_AUTH_SECRET_LENGTH)
  SMALLSASS_ACCOUNT_PUBLIC_URL: "http://localhost:8787",
};

const fixtures = registerServerFixtureCleanup();
const openDb = (...args: Parameters<typeof openDbRaw>) => fixtures.trackDb(openDbRaw(...args));
const assertPresent = <T>(value: T, label: string): NonNullable<T> => {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
};
const readRejectedValue = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
};
const parseApiErrorFields = (value: unknown): { status: unknown; code: unknown } => {
  if (typeof value !== "object" || value === null || !("status" in value) || !("body" in value)) {
    throw new Error("Expected an API error object");
  }
  const { body, status } = value;
  if (typeof body !== "object" || body === null || !("code" in body)) {
    throw new Error("Expected an API error body with a code");
  }
  return { status, code: body.code };
};
const parseSingleFederatedObservation = (
  value: unknown,
): {
  accountRowId: unknown;
  principalId: unknown;
  providerId: unknown;
  subject: unknown;
  verifiedAt: unknown;
  auditedAt: unknown;
} => {
  if (!Array.isArray(value) || value.length !== 1) throw new Error("Expected one federated-link observation");
  const row: unknown = value[0];
  if (
    typeof row !== "object" ||
    row === null ||
    !("accountRowId" in row) ||
    !("principalId" in row) ||
    !("providerId" in row) ||
    !("subject" in row) ||
    !("verifiedAt" in row) ||
    !("auditedAt" in row)
  ) {
    throw new Error("Expected a complete federated-link observation");
  }
  return {
    accountRowId: row.accountRowId,
    principalId: row.principalId,
    providerId: row.providerId,
    subject: row.subject,
    verifiedAt: row.verifiedAt,
    auditedAt: row.auditedAt,
  };
};
const createCompletedFederatedLinkFixture = (db: ReturnType<typeof openDbRaw>) => {
  const timestamp = "2026-08-07T00:00:00.000Z";
  db.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run("principal-1", "Member", "member@example.com", timestamp, timestamp);
  db.prepare(
    `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("link-1", "google", "subject-1", "principal-1", timestamp, timestamp);
  db.prepare(
    `INSERT INTO capacitylens_federated_link_ceremonies
      (id, principalId, providerId, createdAt, expiresAt, completedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("ceremony-1", "principal-1", "google", timestamp, "2099-01-01T00:00:00.000Z", timestamp);
};

describe("password verification backpressure", () => {
  it("maps scrypt saturation to a retryable service-unavailable API error", async () => {
    const hasher: PasswordHasher = {
      hash: vi.fn(),
      verify: vi.fn().mockRejectedValue(new WorkQueueFullError("Password processing is at capacity.", "full")),
    };

    const error = parseApiErrorFields(
      await readRejectedValue(verifyPasswordWithBackpressure(hasher, { hash: "stored", password: "correct password" })),
    );
    expect(error.status).toBe("SERVICE_UNAVAILABLE");
    expect(error.code).toBe("PASSWORD_PROCESSING_UNAVAILABLE");
  });

  it("maps new-hash saturation to the same retryable service-unavailable API error", async () => {
    const hasher: PasswordHasher = {
      hash: vi.fn().mockRejectedValue(new WorkQueueFullError("Password processing is at capacity.", "full")),
      verify: vi.fn(),
    };

    const error = parseApiErrorFields(
      await readRejectedValue(hashPasswordWithBackpressure(hasher, "correct horse battery staple")),
    );
    expect(error.status).toBe("SERVICE_UNAVAILABLE");
    expect(error.code).toBe("PASSWORD_PROCESSING_UNAVAILABLE");
  });
});

const registerFederatedSchemaTests = () => {
  it("rejects a reserved observation trigger whose body does not match the v25 definition", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
    const auth = assertPresent(configured.auth, "password auth");
    await runAuthMigrations(auth);
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

  it("requires verified email for first Google admission", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(
      db,
      {
        ...PASSWORD_ENV,
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
      },
      {
        deferDatabaseSetup: true,
        externalIdentityAdmission: (candidate) => candidate.providerId === "google" && candidate.emailVerified === true,
      },
    );
    const auth = assertPresent(configured.auth, "password auth");
    const before = assertPresent(auth.options.databaseHooks?.user?.create?.before, "admission hook");
    const context = { path: "/callback/:id", params: { id: "google" }, bootstrapClaimToken: "held" } as never;
    await expect(before({ email: "bruce@example.com", emailVerified: false } as never, context)).rejects.toMatchObject({
      body: { code: "EXTERNAL_IDENTITY_NOT_INVITED" },
    });
    await expect(before({ email: "bruce@example.com", emailVerified: true } as never, context)).resolves.toMatchObject({
      data: { email: "bruce@example.com", emailVerified: true },
    });
  });
};

const registerFederatedAuditTests = () => {
  it("admits a direct provider identity as verified on SSO-only restart and emits one stable audit", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, {
      ...PASSWORD_ENV,
      SMALLSASS_ACCOUNT_MODE: "password-and-sso",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",

      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    });
    const auth = assertPresent(configured.auth, "password auth");
    const reconcileFederatedLinks = assertPresent(auth.reconcileFederatedLinks, "federated-link reconciler");
    await runAuthMigrations(auth);
    createCompletedFederatedLinkFixture(db);

    const identity = createBetterAuthIdentityPort({
      applicationId: "capacitylens",
      auth,
      authMode: "sso-only",
      db,
    });
    expect(() =>
      assertCompanyProviderCutoverReady({
        providerIds: new Set(["google"]),
        identity,
        administration: {
          inspectSsoCutoverWorkspaces: () => [
            {
              workspaceId: "workspace-1",
              workspaceName: "Studio",
              members: [{ principalId: "principal-1", role: "owner", status: "active" }],
            },
          ],
        } as never,
      }),
    ).not.toThrow();

    reconcileFederatedLinks();
    reconcileFederatedLinks();

    const observation = parseSingleFederatedObservation(
      db.prepare(`SELECT * FROM capacitylens_federated_link_observations`).all(),
    );
    expect({
      accountRowId: observation.accountRowId,
      principalId: observation.principalId,
      providerId: observation.providerId,
      subject: observation.subject,
    }).toEqual({
      accountRowId: "link-1",
      principalId: "principal-1",
      providerId: "google",
      subject: "subject-1",
    });
    expect(typeof observation.verifiedAt).toBe("string");
    expect(typeof observation.auditedAt).toBe("string");
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
    expect(db.prepare(`SELECT id FROM capacitylens_audit_outbox`).all()).toEqual([{ id: "identity-link:link-1" }]);
  });
};

const registerFederatedReconciliationTests = () => {
  it("keeps an interrupted zero-row ceremony until expiry and then removes it", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, {
      ...PASSWORD_ENV,
      SMALLSASS_ACCOUNT_MODE: "password-and-sso",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",

      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    });
    const auth = assertPresent(configured.auth, "password auth");
    const reconcileFederatedLinks = assertPresent(auth.reconcileFederatedLinks, "federated-link reconciler");
    await runAuthMigrations(auth);
    const ceremony = createFederatedLinkCeremony({ db, principalId: "principal-1", providerId: "google" });

    reconcileFederatedLinks();
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([{ id: ceremony.id }]);

    db.prepare(`UPDATE capacitylens_federated_link_ceremonies SET expiresAt = ? WHERE id = ?`).run(
      "2000-01-01T00:00:00.000Z",
      ceremony.id,
    );
    reconcileFederatedLinks();
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
  });

  it("does not acquire a SQLite write lock when reconciliation has no work", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
    const auth = assertPresent(configured.auth, "password auth");
    await runAuthMigrations(auth);
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
};

const registerFederatedCeremonyConflictTests = () => {
  it("supersedes an abandoned link ceremony when the same principal begins again", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, {
      ...PASSWORD_ENV,
      SMALLSASS_ACCOUNT_MODE: "password-and-sso",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",

      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    });
    const auth = assertPresent(configured.auth, "password auth");
    await runAuthMigrations(auth);
    createFederatedLinkCeremony({ db, principalId: "principal-1", providerId: "google", ceremonyId: "abandoned" });
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
      createFederatedLinkCeremony({
        db,
        principalId: "principal-1",
        providerId: "google",
        ceremonyId: "replacement",
        revokeSupersededProviderStateInTransaction: () => revokeFederatedLinkStateInTx(db, "principal-1"),
      }).id,
    ).toBe("replacement");
    expect(
      db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies WHERE principalId = ?`).all("principal-1"),
    ).toEqual([{ id: "replacement" }]);
    expect(db.prepare(`SELECT id FROM verification`).all()).toEqual([]);
  });
};

const registerFederatedSubjectConflictTests = () => {
  it("preserves one observed row when an interrupted callback attempts a second subject", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, {
      ...PASSWORD_ENV,
      SMALLSASS_ACCOUNT_MODE: "password-and-sso",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",

      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    });
    const auth = assertPresent(configured.auth, "password auth");
    const reconcileFederatedLinks = assertPresent(auth.reconcileFederatedLinks, "federated-link reconciler");
    await runAuthMigrations(auth);
    const timestamp = "2026-08-07T00:00:00.000Z";
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run("principal-1", "Member", "member@example.com", timestamp, timestamp);
    createFederatedLinkCeremony({ db, principalId: "principal-1", providerId: "google" });
    db.prepare(
      `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("link-1", "google", "subject-1", "principal-1", timestamp, timestamp);

    expect(() =>
      db
        .prepare(
          `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("link-2", "google", "subject-2", "principal-1", timestamp, timestamp),
    ).toThrow(/unique constraint/i);
    reconcileFederatedLinks();

    expect(db.prepare(`SELECT id, accountId FROM account WHERE providerId = 'google'`).all()).toEqual([
      { id: "link-1", accountId: "subject-1" },
    ]);
    expect(db.prepare(`SELECT accountRowId FROM capacitylens_federated_link_observations`).all()).toEqual([
      { accountRowId: "link-1" },
    ]);
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
  });
};

describe("federated link observation reconciliation", () => {
  registerFederatedSchemaTests();
  registerFederatedAuditTests();
  registerFederatedReconciliationTests();
  registerFederatedCeremonyConflictTests();
  registerFederatedSubjectConflictTests();
});

const registerStartupControlTests = () => {
  it("can resolve auth options without DDL, then maintains controls after app migration", () => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV, { deferDatabaseSetup: true });
    expect(configured.auth).not.toBeNull();
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()).toEqual([]);
    expect(() => ensureAuthControlTables(db, PASSWORD_ENV)).toThrow(/does not match the current application schema/i);
    expect(planDatabaseMigrations(db).migrations.at(-1)).toEqual(expect.objectContaining(MICROSOFT_PROOF_V46_PIN));
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
};

const registerStartupConfigurationRefusalTests = () => {
  it("leaves a bare database untouched when provider configuration is invalid", () => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    expect(() =>
      createAuthFromEnvironment(db, {
        ...PASSWORD_ENV,
        SMALLSASS_ACCOUNT_MODE: "password-and-sso",
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "id-without-secret",
      }),
    ).toThrow(/google/i);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()).toEqual([]);
    db.close();
  });

  it("rejects a malformed configured trusted origin instead of silently dropping it", () => {
    const db = openDb(":memory:");

    expect(() => createAuthFromEnvironment(db, PASSWORD_ENV, { trustedOrigins: ["not an absolute URL"] })).toThrow(
      /trusted origin.*absolute URL/i,
    );
  });

  it("rejects a Microsoft issuer with a query or fragment", () => {
    const tenant = "01234567-89ab-cdef-0123-456789abcdef";
    const profile = {
      iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
      aud: "client",
      tid: tenant,
      oid: "stable-object-id",
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    for (const suffix of ["?version=2", "#fragment"]) {
      expect(() =>
        readVerifiedMicrosoftProfile({ ...profile, iss: `${profile.iss}${suffix}` }, tenant, "client"),
      ).toThrow();
    }
  });

  it.each([
    "SMALLSASS_ACCOUNT_OIDC_CLIENT_ID",
    "SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL",
    "SMALLSASS_ACCOUNT_OIDC_SCOPES",
  ])("refuses retired generic setting %s before creating storage", (key) => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    expect(() => createAuthFromEnvironment(db, { ...PASSWORD_ENV, [key]: "retired" })).toThrow(`${key} was removed`);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()).toEqual([]);
    db.close();
  });

  it("refuses public URLs that are not a bare origin", () => {
    for (const publicUrl of [
      "https://user:pass@capacity.example",
      "https://capacity.example/deployment",
      "https://capacity.example?tenant=one",
      "https://capacity.example#fragment",
    ]) {
      expect(() =>
        createAuthFromEnvironment(openDb(":memory:"), {
          ...PASSWORD_ENV,
          SMALLSASS_ACCOUNT_PUBLIC_URL: publicUrl,
        }),
      ).toThrow(/must be an origin/);
    }
  });
};

const registerStartupDiscoverySuccessTest = () => {
  it("binds a named Google provider to its stable issuer before serving requests", () => {
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(db, {
      ...PASSWORD_ENV,
      SMALLSASS_ACCOUNT_MODE: "password-and-sso",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    });
    const configured = assertPresent(auth, "Google auth");
    expect(configured.federatedIssuers.get("google")).toBe("https://accounts.google.com");
    expect(configured.options.plugins?.some((plugin) => plugin.id === "generic-oauth")).toBe(false);
  });
};

const registerStartupDiscoveryFailureTest = () => {
  it("rejects a Microsoft profile whose issuer differs from the configured tenant", () => {
    const tenant = "01234567-89ab-cdef-0123-456789abcdef";
    const profile = {
      iss: "https://login.microsoftonline.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0",
      aud: "client",
      tid: tenant,
      oid: "stable-object-id",
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    expect(() => readVerifiedMicrosoftProfile(profile, tenant, "client")).toThrow();
  });
};

const registerStartupMigrationPlanningTest = () => {
  it("plans both the app-owned control migration and Better Auth DDL before executing either", async () => {
    const db = openDb(":memory:");
    for (const { index } of TENANT_ENTITY_ACCOUNT_INDEXES_V21) db.exec(`DROP INDEX ${index}`);
    db.exec(`
      DROP TABLE capacitylens_bootstrap_claim;
      DROP TABLE microsoft_identity_proofs;
      DELETE FROM capacitylens_schema_migrations WHERE version >= 20;
      PRAGMA user_version = 19;
    `);
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV, { deferDatabaseSetup: true });
    const auth = assertPresent(configured.auth, "password auth");
    expect(planDatabaseMigrations(db).migrations).toEqual([
      expect.objectContaining({ version: 20, name: "version-bootstrap-claim-control" }),
      expect.objectContaining({ version: 21, name: "index-tenant-entity-slices" }),
      expect.objectContaining({ version: 22, name: "reactivate-builtin-internal-clients" }),
      expect.objectContaining({ version: 23, name: "index-foreign-key-children" }),
      expect.objectContaining({ version: 24, name: "bound-used-invitation-history" }),
      expect.objectContaining({ version: 25, name: "secure-federated-identity-linking" }),
      expect.objectContaining({ version: 26, name: "add-member-sign-in-confirmation" }),
      expect.objectContaining({ version: 27, name: "add-resource-favourites" }),
      expect.objectContaining({ version: 28, name: "add-resource-half-days" }),
      expect.objectContaining({ version: 29, name: "add-resource-engagement" }),
      expect.objectContaining({ version: 30, name: "add-engagement-grouping-preference" }),
      expect.objectContaining({ version: 31, name: "add-account-working-days" }),
      expect.objectContaining({ version: 32, name: "add-allocation-series-id" }),
      expect.objectContaining({ version: 33, name: "allow-company-wide-time-off" }),
      expect.objectContaining({ version: 34, name: "separate-company-closures" }),
      ...CHECKSUM_PINNED_MIGRATIONS.map((migration): unknown => expect.objectContaining(migration)),
    ]);
    const before = await planAuthSchemaMigrations(auth);
    expect(before.pending).toBe(true);
    expect(before.tables).toContain("user");

    initializeOpenDb(db, ":memory:");
    ensureAuthControlTables(db, PASSWORD_ENV);
    await runAuthMigrations(auth);
    expect(planDatabaseMigrations(db).migrations).toEqual([]);
    await expect(planAuthSchemaMigrations(auth)).resolves.toEqual({ pending: false, tables: [] });
    db.close();
  });
};

describe("startup configuration before database migration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  registerStartupControlTests();
  registerStartupConfigurationRefusalTests();
  registerStartupDiscoverySuccessTest();
  registerStartupDiscoveryFailureTest();
  registerStartupMigrationPlanningTest();
});

describe("first-owner database-hook races", () => {
  it("rejects a delayed first-owner insertion after another principal wins", async () => {
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
    const passwordAuth = assertPresent(auth, "password auth");
    await runAuthMigrations(passwordAuth);
    await passwordAuth.createCredentialUser({
      email: "winner@example.com",
      name: "Winner",
      password: "winner-password-123456",
      emailVerified: true,
    });
    const before = assertPresent(passwordAuth.options.databaseHooks?.user?.create?.before, "first-owner creation hook");

    const error = parseApiErrorFields(
      await readRejectedValue(
        before(
          { email: "loser@example.com", name: "Loser" } as never,
          { path: "/sign-up/email", bootstrapClaimToken: "losing-claim" } as never,
        ),
      ),
    );
    expect(error.code).toBe("BOOTSTRAP_ALREADY_CLAIMED");
  });

  it("rejects a first-owner insertion that reaches the hook without its claim token", async () => {
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
    const passwordAuth = assertPresent(auth, "password auth");
    await runAuthMigrations(passwordAuth);
    const before = assertPresent(passwordAuth.options.databaseHooks?.user?.create?.before, "first-owner creation hook");

    const error = parseApiErrorFields(
      await readRejectedValue(
        before({ email: "owner@example.com", name: "Owner" } as never, { path: "/sign-up/email" } as never),
      ),
    );
    expect(error.code).toBe("BOOTSTRAP_ALREADY_IN_PROGRESS");
  });
});

describe("resolved auth options", () => {
  const companyProviderEnv = {
    SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",

    SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
  };

  it.each([
    {
      name: "password",
      env: PASSWORD_ENV,
      trustedOrigins: undefined,
      pluginIds: ["two-factor"],
    },
    {
      name: "password with providers",
      env: {
        ...PASSWORD_ENV,
        ...companyProviderEnv,
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
      },
      trustedOrigins: ["https://admin.example", "https://capacity.example"],
      pluginIds: ["two-factor"],
    },
    {
      name: "sso",
      env: { ...PASSWORD_ENV, ...companyProviderEnv, SMALLSASS_ACCOUNT_MODE: "sso-only" },
      trustedOrigins: ["https://capacity.example"],
      pluginIds: [],
    },
  ])("pins security-sensitive option fields in $name mode", ({ env, trustedOrigins, pluginIds }) => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    const { auth } = createAuthFromEnvironment(db, env, {
      deferDatabaseSetup: true,
      ...(trustedOrigins === undefined ? {} : { trustedOrigins }),
    });
    const configuredAuth = assertPresent(auth, `${env.SMALLSASS_ACCOUNT_MODE} auth`);

    expect(configuredAuth.options.telemetry?.enabled).toBe(false);
    expect(configuredAuth.options.verification?.storeIdentifier).toBe("hashed");
    expect(configuredAuth.options.plugins?.map((plugin) => plugin.id)).toEqual(pluginIds);
    expect(configuredAuth.options.trustedOrigins).toEqual(trustedOrigins);
    db.close();
  });
});

const registerCookieHardeningTests = () => {
  it("pins sameSite:lax + httpOnly on the session cookie", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), PASSWORD_ENV);
    const passwordAuth = assertPresent(auth, "password auth");
    expect(passwordAuth.options.advanced?.defaultCookieAttributes).toEqual({ sameSite: "lax", httpOnly: true });
    expect(passwordAuth.options.advanced?.cookiePrefix).toBe("capacitylens");
  });

  it("derives an insecure development cookie from an HTTP public URL", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), PASSWORD_ENV);
    expect(assertPresent(auth, "password auth").options.advanced?.useSecureCookies).toBe(false);
  });

  it("sets a valid __Host prefix and Secure from the HTTPS public URL even behind an HTTP proxy hop", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), {
      ...PASSWORD_ENV,
      SMALLSASS_ACCOUNT_PUBLIC_URL: "https://capacity.example",
    });
    const passwordAuth = assertPresent(auth, "password auth");
    // Better Auth's built-in switch is deliberately false because it prepends `__Secure-`.
    // CapacityLens supplies Secure directly so the stricter `__Host-` prefix remains first.
    expect(passwordAuth.options.advanced?.useSecureCookies).toBe(false);
    expect(passwordAuth.options.advanced?.cookiePrefix).toBe("__Host-capacitylens");
    expect(passwordAuth.options.advanced?.defaultCookieAttributes).toEqual({
      sameSite: "lax",
      httpOnly: true,
      secure: true,
    });
  });

  it("refuses a plaintext non-loopback public URL in production", () => {
    expect(() =>
      createAuthFromEnvironment(openDb(":memory:"), {
        ...PASSWORD_ENV,
        NODE_ENV: "production",
        SMALLSASS_ACCOUNT_PUBLIC_URL: "http://capacity.example",
      }),
    ).toThrow(/must use https:\/\//);
  });

  it("inherits the production HTTPS posture when an explicit environment omits NODE_ENV", () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() =>
        createAuthFromEnvironment(openDb(":memory:"), {
          ...PASSWORD_ENV,
          SMALLSASS_ACCOUNT_PUBLIC_URL: "http://capacity.example",
        }),
      ).toThrow(/must use https:\/\//);
    } finally {
      if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnvironment;
    }
  });

  it("still permits loopback HTTP for a local production-container check", () => {
    expect(() =>
      createAuthFromEnvironment(openDb(":memory:"), {
        ...PASSWORD_ENV,
        NODE_ENV: "production",
        SMALLSASS_ACCOUNT_PUBLIC_URL: "http://localhost:8787",
      }),
    ).not.toThrow();
  });
};

const registerSessionHardeningTests = () => {
  it("pins a 12-hour absolute lifetime with no sliding refresh and a 15-minute fresh window", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), PASSWORD_ENV);
    const passwordAuth = assertPresent(auth, "password auth");
    expect(passwordAuth.options.session?.expiresIn).toBe(43_200);
    expect(passwordAuth.options.session?.disableSessionRefresh).toBe(true);
    expect(passwordAuth.options.session?.freshAge).toBe(900);
  });

  it("constructs no betterAuth instance for an absent or explicit off mode", () => {
    for (const environment of [{}, { SMALLSASS_ACCOUNT_MODE: "off" }]) {
      expect(createAuthFromEnvironment(openDb(":memory:"), environment)).toMatchObject({ mode: "off", auth: null });
    }
  });
};

describe("cookie/session hardening (P1.16)", () => {
  registerCookieHardeningTests();
  registerSessionHardeningTests();
});

const registerExternalProviderConfigurationTests = () => {
  it("resolves the concrete provider from a parameterized database-hook route", () => {
    expect(
      parseProviderIdFromExternalContext({
        path: "/callback/:id",
        params: { id: "google" },
      }),
    ).toBe("google");
    expect(parseProviderIdFromExternalContext({ path: "/callback/google" })).toBe("google");
    expect(parseProviderIdFromExternalContext({ path: "/oauth2/callback/:providerId" })).toBeNull();
  });

  it("disables implicit email-based account linking", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), PASSWORD_ENV);
    expect(assertPresent(auth, "password auth").options.account?.accountLinking?.disableImplicitLinking).toBe(true);
  });

  it("binds every configured external provider to a stable issuer namespace", () => {
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(db, {
      ...PASSWORD_ENV,
      SMALLSASS_ACCOUNT_MODE: "password-and-sso",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    });
    expect(assertPresent(auth, "password auth").federatedIssuers.get("google")).toBe("https://accounts.google.com");
    expect(
      db.prepare(`SELECT issuer FROM account_federated_provider_bindings WHERE providerId = 'google'`).get(),
    ).toEqual({ issuer: "https://accounts.google.com" });
  });
};

const registerExternalOpenSignupTest = () => {
  it("stays enforced when open email registration is deliberately enabled", async () => {
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(
      db,
      {
        ...PASSWORD_ENV,
        SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP: "1",
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
      },
      {
        externalIdentityAdmission: async () => false,
      },
    );
    const before = assertPresent(
      assertPresent(auth, "password auth").options.databaseHooks?.user?.create?.before,
      "external-identity admission hook",
    );
    expect(before).toBeTypeOf("function");

    await expect(
      before({ email: "stranger@example.com", emailVerified: true } as never, { path: "/callback/google" } as never),
    ).rejects.toThrow(/not invited/);
  });
};

const registerExternalSsoProviderTest = () => {
  it("admits configured company providers while preserving bootstrap and provider restrictions", async () => {
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(
      db,
      {
        ...PASSWORD_ENV,
        SMALLSASS_ACCOUNT_MODE: "sso-only",
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
      },
      { externalIdentityAdmission: async () => true },
    );
    const before = assertPresent(
      assertPresent(auth, "SSO auth").options.databaseHooks?.user?.create?.before,
      "external-identity admission hook",
    );
    expect(before).toBeTypeOf("function");

    const candidate = { name: "Bruce Wayne", email: "new-social@example.com", emailVerified: true };
    await expect(
      before(
        candidate as never,
        {
          path: "/callback/google",
          bootstrapClaimToken: "request-held-claim",
        } as never,
      ),
    ).resolves.toEqual({ data: candidate });
    await expect(before(candidate as never, { path: "/callback/google" } as never)).rejects.toMatchObject({
      body: { code: "BOOTSTRAP_ALREADY_IN_PROGRESS" },
    });
    await expect(before(candidate as never, { path: "/callback/github" } as never)).rejects.toMatchObject({
      body: { code: "STRICT_PROVIDER_REQUIRED" },
    });
  });
};

const registerExternalSessionAssuranceTest = () => {
  it("creates a company-provider session without querying password-only MFA columns", async () => {
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(db, {
      ...PASSWORD_ENV,
      SMALLSASS_ACCOUNT_MODE: "sso-only",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",

      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    });
    const ssoAuth = assertPresent(auth, "SSO auth");
    await runAuthMigrations(ssoAuth);
    expect(
      (db.prepare("PRAGMA table_info(user)").all() as Array<{ name: string }>).some(
        ({ name }) => name === "twoFactorEnabled",
      ),
    ).toBe(false);
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, NULL, ?, ?)`,
    ).run(
      "strict-principal",
      "Strict Member",
      "strict@example.com",
      "2026-08-10T00:00:00.000Z",
      "2026-08-10T00:00:00.000Z",
    );

    const after = assertPresent(ssoAuth.options.databaseHooks?.session?.create?.after, "session assurance hook");
    expect(after).toBeTypeOf("function");
    await expect(
      after(
        { token: "strict-session-token", userId: "strict-principal" } as never,
        { path: "/callback/:id", params: { id: "google" } } as never,
      ),
    ).resolves.toBeUndefined();
    expect(db.prepare("SELECT assurance, providerId FROM account_session_assurance").get()).toEqual({
      assurance: "federated",
      providerId: "google",
    });
  });
};

const registerExternalBootstrapAdmissionTests = () => {
  it("keeps the first-external-identity claim control when email registration is open", () => {
    const db = openDb(":memory:");
    const env = {
      ...PASSWORD_ENV,
      SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP: "1",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    };
    createAuthFromEnvironment(db, env);

    expect(() => assertBootstrapClaimCurrent(db)).not.toThrow();
    expect(db.prepare(`PRAGMA table_info(capacitylens_bootstrap_claim)`).all()).not.toEqual([]);
  });

  it("allows only a verified, explicitly allow-listed first identity", () => {
    const db = openDb(":memory:");
    createAuthFromEnvironment(db, PASSWORD_ENV); // initializes Better Auth's user table
    const env = { SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS: " owner@example.com, second@example.com " };
    expect(
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: env.SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS,
        candidate: { email: "OWNER@example.com", emailVerified: true },
      }),
    ).toBe(true);
    expect(
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: env.SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS,
        candidate: { email: "owner@example.com", emailVerified: false },
      }),
    ).toBe(false);
    expect(
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: env.SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS,
        candidate: { email: "stranger@example.com", emailVerified: true },
      }),
    ).toBe(false);
    expect(
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: "not-an-email",
        candidate: { email: "not-an-email", emailVerified: true },
      }),
    ).toBe(false);
  });
};

const registerExternalLiveInvitationTest = () => {
  it("allows a verified email with a live unused pre-authorised invite after bootstrap", async () => {
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
    const passwordAuth = assertPresent(auth, "password auth");
    await runAuthMigrations(passwordAuth);
    await passwordAuth.createCredentialUser({
      email: "existing-owner@example.com",
      name: "Existing Owner",
      password: "Unrelated-phrase-4827!",
      emailVerified: true,
    });
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
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: undefined,
        candidate: { email: " Person@Example.com ", emailVerified: true },
      }),
    ).toBe(true);
    expect(
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: undefined,
        candidate: { email: "person@example.com", emailVerified: false },
      }),
    ).toBe(false);
  });
};

const registerExternalBootstrapInvitationTest = () => {
  it("does not let an invitation replace the first-external-identity allow-list", () => {
    const db = openDb(":memory:");
    createAuthFromEnvironment(db, PASSWORD_ENV);
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
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: undefined,
        candidate: { email: "person@example.com", emailVerified: true },
      }),
    ).toBe(false);
    expect(
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: "person@example.com",
        candidate: { email: "person@example.com", emailVerified: true },
      }),
    ).toBe(true);
  });
};

const registerExternalExpiredInvitationTest = () => {
  it("rejects expired and consumed invitations after bootstrap", async () => {
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
    const passwordAuth = assertPresent(auth, "password auth");
    await runAuthMigrations(passwordAuth);
    await passwordAuth.createCredentialUser({
      email: "existing-owner@example.com",
      name: "Existing Owner",
      password: "Unrelated-phrase-4827!",
      emailVerified: true,
    });
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
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: undefined,
        candidate: { email: "expired@example.com", emailVerified: true },
      }),
    ).toBe(false);
    expect(
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: undefined,
        candidate: { email: "used@example.com", emailVerified: true },
      }),
    ).toBe(false);
  });
};

describe("external identity creation gate", () => {
  registerExternalProviderConfigurationTests();
  registerExternalOpenSignupTest();
  registerExternalSsoProviderTest();
  registerExternalSessionAssuranceTest();
  registerExternalBootstrapAdmissionTests();
  registerExternalLiveInvitationTest();
  registerExternalBootstrapInvitationTest();
  registerExternalExpiredInvitationTest();
});

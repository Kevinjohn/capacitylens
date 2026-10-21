import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { initializeOpenDb, planDatabaseMigrations } from "./db";
import {
  createAuthFromEnvironment,
  assertFederatedIdentitySchemaCurrent,
  ensureAuthControlTables,
  planAuthSchemaMigrations,
  runAuthMigrations,
} from "./auth";
import { assertBootstrapClaimCurrent } from "./bootstrapClaim";
import { readVerifiedMicrosoftProfile } from "./authConfig/socialProviders";
import { ACCOUNT_ENTITY_INDEXES_V21 } from "./accountIndexes";
import { CHECKSUM_PINNED_MIGRATIONS } from "./db/migrations/authPlanningPins.testSupport";
import { assertPresent, openDb, PASSWORD_ENV } from "./authTestSupport";
import { parseApiErrorFields, readRejectedValue } from "./authApiErrorTestSupport";

const registerStartupControlTests = () => {
  it("can resolve auth options without DDL, then maintains controls after app migration", () => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV, { deferDatabaseSetup: true });
    expect(configured.auth).not.toBeNull();
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()).toEqual([]);
    expect(() => ensureAuthControlTables(db)).toThrow(/does not match the current application schema/i);
    expect(planDatabaseMigrations(db).migrations.at(-1)).toEqual(
      expect.objectContaining(CHECKSUM_PINNED_MIGRATIONS.at(-1)),
    );
    initializeOpenDb(db, ":memory:");
    ensureAuthControlTables(db);
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
      ensureAuthControlTables(db);
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
        CAPACITYLENS_MODE: "password-and-sso",
        CAPACITYLENS_GOOGLE_CLIENT_ID: "id-without-secret",
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
          CAPACITYLENS_PUBLIC_URL: publicUrl,
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
      CAPACITYLENS_MODE: "password-and-sso",
      CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
    });
    const configured = assertPresent(auth, "Google auth");
    expect(configured.federatedIssuers.get("google")).toBe("https://accounts.google.com");
    expect(configured.options.plugins?.some((plugin) => plugin.id === "generic-oauth") ?? false).toBe(false);
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
    for (const { index } of ACCOUNT_ENTITY_INDEXES_V21) db.exec(`DROP INDEX ${index}`);
    db.exec(`
      DROP TABLE capacitylens_bootstrap_claim;
      DROP TABLE microsoft_identity_proofs;
      DROP TABLE account_access_restrictions;
      DROP TABLE identity_email_proofs;
      DROP TABLE account_joining_policies;
      DROP TABLE company_join_intents;
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
    ensureAuthControlTables(db);
    await runAuthMigrations(auth);
    expect(planDatabaseMigrations(db).migrations).toEqual([]);
    await expect(planAuthSchemaMigrations(auth)).resolves.toEqual({ pending: false, tables: [], problems: [] });
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

describe("auth schema check at startup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts a fresh database without the library's pre-migration schema error", async () => {
    const logged: string[] = [];
    for (const level of ["error", "warn"] as const) {
      vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => void logged.push(parts.join(" ")));
    }
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(db, PASSWORD_ENV, { deferDatabaseSetup: true });
    const passwordAuth = assertPresent(auth, "password auth");
    // A library endpoint awaits any pending startup schema check, so an enabled check would reject here.
    await expect(passwordAuth.api.getSession({ headers: new Headers() })).resolves.toBeNull();
    initializeOpenDb(db, ":memory:");
    ensureAuthControlTables(db);
    await runAuthMigrations(passwordAuth);

    expect(logged.filter((line) => /ERROR|schema mismatch|npx auth migrate/.test(line))).toEqual([]);
  });

  it("refuses to start when an auth table has a required column the library never writes", async () => {
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
    const passwordAuth = assertPresent(auth, "password auth");
    await runAuthMigrations(passwordAuth);
    // SQLite cannot add a NOT NULL column without a default, so rebuild the table with one.
    db.exec("ALTER TABLE verification RENAME TO verification_old");
    db.exec(
      "CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, " +
        "expiresAt DATE NOT NULL, createdAt DATE NOT NULL, updatedAt DATE NOT NULL, tenant TEXT NOT NULL)",
    );
    db.exec("DROP TABLE verification_old");

    await expect(runAuthMigrations(passwordAuth)).rejects.toThrow(
      /did not converge; Column "tenant" on table "verification" is required/,
    );
  });
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

import { describe, expect, it } from "vitest";
import { createAuthFromEnvironment, parseProviderIdFromExternalContext, runAuthMigrations, countUsers } from "./auth";
import { canAdmitLocalExternalIdentity } from "./accounts/externalIdentityAdmission";
import { hasLivePreauthorizedInvitation } from "./accounts/sqliteAccountAdminPort";
import { assertBootstrapClaimCurrent } from "./bootstrapClaim";
import { assertPresent, openDb, PASSWORD_ENV } from "./authTestSupport";

const admissionDependencies = (db: ReturnType<typeof openDb>) => ({
  identityHasAnyPrincipal: () => countUsers(db) !== 0,
  hasLivePreauthorizedInvitation: (email: string) => hasLivePreauthorizedInvitation(db, email),
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
      CAPACITYLENS_MODE: "password-and-sso",
      CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
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
        CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
        CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
        CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
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
      before(
        { email: "stranger@example.com", name: "Stranger", emailVerified: true } as never,
        { path: "/callback/google" } as never,
      ),
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
        CAPACITYLENS_MODE: "sso-only",
        CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
        CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
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

const registerProviderNameRepairTest = () => {
  it("repairs a provider profile name the person cannot edit instead of refusing first sign-in", async () => {
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(
      db,
      {
        ...PASSWORD_ENV,
        CAPACITYLENS_MODE: "sso-only",
        CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
        CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
      },
      { externalIdentityAdmission: async () => true },
    );
    const before = assertPresent(
      assertPresent(auth, "SSO auth").options.databaseHooks?.user?.create?.before,
      "external-identity admission hook",
    );
    const context = { path: "/callback/google", bootstrapClaimToken: "request-held-claim" } as never;
    const profile = { email: "new-social@example.com", emailVerified: true };

    await expect(before({ ...profile, name: "Bruce Wayne™ 🦇" } as never, context)).resolves.toEqual({
      data: { ...profile, name: "Bruce Wayne" },
    });
    await expect(before({ ...profile, name: "" } as never, context)).resolves.toEqual({
      data: { ...profile, name: "User" },
    });
  });
};

const registerExternalSessionAssuranceTest = () => {
  it("creates a company-provider session without local MFA columns", async () => {
    const db = openDb(":memory:");
    const { auth } = createAuthFromEnvironment(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_MODE: "sso-only",
      CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",

      CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
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

it("creates a fresh password schema without local MFA storage", async () => {
  const db = openDb(":memory:");
  const auth = assertPresent(createAuthFromEnvironment(db, PASSWORD_ENV).auth, "password auth");
  await runAuthMigrations(auth);
  expect(
    (db.prepare("PRAGMA table_info(user)").all() as Array<{ name: string }>).some(
      ({ name }) => name === "twoFactorEnabled",
    ),
  ).toBe(false);
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'twoFactor'").get(),
  ).toBeUndefined();
});

const registerExternalBootstrapAdmissionTests = () => {
  it("keeps the first-external-identity claim control when email registration is open", () => {
    const db = openDb(":memory:");
    const env = {
      ...PASSWORD_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
      CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
    };
    createAuthFromEnvironment(db, env);

    expect(() => assertBootstrapClaimCurrent(db)).not.toThrow();
    expect(db.prepare(`PRAGMA table_info(capacitylens_bootstrap_claim)`).all()).not.toEqual([]);
  });

  it("allows only a verified, explicitly allow-listed first identity", () => {
    const db = openDb(":memory:");
    createAuthFromEnvironment(db, PASSWORD_ENV);
    const env = { CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS: " owner@example.com, second@example.com " };
    expect(
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: env.CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS,
        candidate: { email: "OWNER@example.com", emailVerified: true },
      }),
    ).toBe(true);
    expect(
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: env.CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS,
        candidate: { email: "owner@example.com", emailVerified: false },
      }),
    ).toBe(false);
    expect(
      canAdmitLocalExternalIdentity({
        ...admissionDependencies(db),
        bootstrapEmails: env.CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS,
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
  registerProviderNameRepairTest();
  registerExternalSessionAssuranceTest();
  registerExternalBootstrapAdmissionTests();
  registerExternalLiveInvitationTest();
  registerExternalBootstrapInvitationTest();
  registerExternalExpiredInvitationTest();
});

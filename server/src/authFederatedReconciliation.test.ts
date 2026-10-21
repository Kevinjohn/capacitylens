import { describe, expect, it } from "vitest";
import {
  createAuthFromEnvironment,
  assertFederatedIdentitySchemaCurrent,
  runAuthMigrations,
  revokeFederatedLinkStateInTx,
} from "./auth";
import { createBetterAuthIdentityPort } from "./accounts/betterAuthIdentityPort";
import { assertCompanyProviderCutoverReady } from "./accounts/companyProviderReadiness";
import { createFederatedLinkCeremony, reconcileObservedFederatedLinks } from "./federatedLinkLifecycle";
import { withVerifiedFederatedProfile } from "./testHelpers/federatedAccount";
import { assertPresent, openDb, PASSWORD_ENV } from "./authTestSupport";

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

const createCompletedFederatedLinkFixture = (db: ReturnType<typeof openDb>) => {
  const timestamp = "2026-08-07T00:00:00.000Z";
  db.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run("principal-1", "Member", "member@example.com", timestamp, timestamp);
  withVerifiedFederatedProfile(db, { providerId: "google", subject: "subject-1", email: "member@example.com" }, () =>
    db
      .prepare(
        `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("link-1", "google", "subject-1", "principal-1", timestamp, timestamp),
  );
  db.prepare(
    `INSERT INTO capacitylens_federated_link_ceremonies
      (id, principalId, providerId, createdAt, expiresAt, completedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("ceremony-1", "principal-1", "google", timestamp, "2099-01-01T00:00:00.000Z", timestamp);
};

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
        CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
        CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
      },
      {
        deferDatabaseSetup: true,
        externalIdentityAdmission: (candidate) => candidate.providerId === "google" && candidate.emailVerified === true,
      },
    );
    const auth = assertPresent(configured.auth, "password auth");
    const before = assertPresent(auth.options.databaseHooks?.user?.create?.before, "admission hook");
    const context = { path: "/callback/:id", params: { id: "google" }, bootstrapClaimToken: "held" } as never;
    await expect(
      before({ email: "bruce@example.com", name: "Bruce Wayne", emailVerified: false } as never, context),
    ).rejects.toMatchObject({
      body: { code: "EXTERNAL_IDENTITY_NOT_INVITED" },
    });
    await expect(
      before({ email: "bruce@example.com", name: "Bruce Wayne", emailVerified: true } as never, context),
    ).resolves.toMatchObject({
      data: { email: "bruce@example.com", name: "Bruce Wayne", emailVerified: true },
    });
  });
};

const registerFederatedAuditTests = () => {
  it("admits a direct provider identity as verified on SSO-only restart and emits one stable audit", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_MODE: "password-and-sso",
      CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",

      CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
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
      CAPACITYLENS_MODE: "password-and-sso",
      CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",

      CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
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
      CAPACITYLENS_MODE: "password-and-sso",
      CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",

      CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
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
      CAPACITYLENS_MODE: "password-and-sso",
      CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",

      CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
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
    withVerifiedFederatedProfile(db, { providerId: "google", subject: "subject-1", email: "member@example.com" }, () =>
      db
        .prepare(
          `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("link-1", "google", "subject-1", "principal-1", timestamp, timestamp),
    );

    expect(() =>
      withVerifiedFederatedProfile(
        db,
        { providerId: "google", subject: "subject-2", email: "member@example.com" },
        () =>
          db
            .prepare(
              `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run("link-2", "google", "subject-2", "principal-1", timestamp, timestamp),
      ),
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

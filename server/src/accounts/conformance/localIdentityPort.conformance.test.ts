import { afterEach, describe, expect, it, vi } from "vitest";
import { authFromEnv, runAuthMigrations, type Auth, type SessionUser } from "../../auth";
import { openDb, type Db } from "../../db";
import { PASSWORD_ENV } from "../../testHelpers";
import { betterAuthIdentityPort } from "../betterAuthIdentityPort";
import { tx } from "../../txn";
import { bindFederatedProvider, getAccountCommand, recordSessionAssurance, reserveAccountCommand } from "../state";
import { applicationSessionHandle } from "../sessionHandle";

const sessionUser: SessionUser = {
  id: "principal-1",
  name: "One",
  email: "same@example.com",
  emailVerified: true,
  image: null,
};

function auth(getSession: Auth["api"]["getSession"]): Auth {
  return {
    handler: vi.fn(async () => new Response(null, { status: 200 })),
    api: {
      getSession,
      requestPasswordReset: vi.fn(async () => ({ status: true })),
    },
    options: {},
    providers: [],
    federatedIssuers: new Map([["sso", "https://issuer.example"]]),
    ensureProviderBindings: vi.fn(),
    createCredentialUser: vi.fn(async () => ({ id: "created-principal" })),
    deleteCredentialUser: vi.fn(async () => {}),
    revokeUserSessions: vi.fn(async () => {}),
  };
}

const NOW = "2026-07-18T00:00:00.000Z";
const LATER = "2099-07-18T00:00:00.000Z";

async function identityTables(db: Db): Promise<void> {
  const { auth: realAuth } = authFromEnv(db, PASSWORD_ENV);
  await runAuthMigrations(realAuth!);
}

function insertIdentityUser(db: Db, id: string, name: string, email: string): void {
  db.prepare(
    `
    INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES (?, ?, ?, 1, ?, ?)
  `,
  ).run(id, name, email, NOW, NOW);
}

function insertIdentityAccount(db: Db, id: string, providerId: string, accountId: string, userId: string): void {
  db.prepare(
    `
    INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(id, providerId, accountId, userId, NOW, NOW);
}

function insertVerification(db: Db, id: string, value: string): void {
  db.prepare(
    `
    INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(id, id, value, LATER, NOW, NOW);
}

function markSsoCutoverActivated(db: Db, applicationId = "conformance-app"): void {
  db.prepare(`INSERT INTO capacitylens_sso_cutover_state (applicationId, activatedAt) VALUES (?, ?)`).run(
    applicationId,
    NOW,
  );
}

describe("local IdentityPort conformance", () => {
  let db: Db | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("normalizes a federated application session without exposing provider records", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, sessionUser.id, sessionUser.name, sessionUser.email);
    insertIdentityAccount(db, "link-1", "sso", "upstream-subject-1", sessionUser.id);
    bindFederatedProvider(db, "conformance-app", "https://issuer.example", "sso");
    recordSessionAssurance(db, "local-session-1", sessionUser.id, "federated", "sso");
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => ({
        user: sessionUser,
        session: {
          id: "local-session-1",
          createdAt: "2026-07-18T00:00:00.000Z",
          expiresAt: "2026-07-18T12:00:00.000Z",
        },
      })),
      authMode: "sso",
      db,
    });

    await expect(port.verifyApplicationSession({ headers: new Headers() })).resolves.toMatchObject({
      id: "local-session-1",
      assurance: "federated",
      principal: {
        id: "principal-1",
        emailVerified: true,
        linkedSubject: {
          issuer: "https://issuer.example",
          subject: "upstream-subject-1",
        },
      },
    });
  });

  it("correlates only by the exact issuer and subject", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, "principal-1", "One", "one@example.com");
    insertIdentityUser(db, "principal-2", "Two", "two@example.com");
    insertIdentityAccount(db, "link-1", "sso", "subject-1", "principal-1");
    insertIdentityAccount(db, "link-2", "sso", "subject-2", "principal-2");
    bindFederatedProvider(db, "conformance-app", "https://issuer.example", "sso");
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "sso",
      db,
    });

    await expect(
      port.findPrincipalByFederatedSubject({
        subject: { issuer: "https://issuer.example", subject: "subject-2" },
      }),
    ).resolves.toEqual({
      id: "principal-2",
      displayName: "Two",
      email: "two@example.com",
    });
    await expect(
      port.findPrincipalByFederatedSubject({
        subject: { issuer: "https://different.example", subject: "subject-2" },
      }),
    ).resolves.toBeNull();
  });

  it("does not upgrade a password-authenticated session merely because the user has a federated link", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, sessionUser.id, sessionUser.name, sessionUser.email);
    insertIdentityAccount(db, "link-1", "sso", "upstream-subject-1", sessionUser.id);
    recordSessionAssurance(db, "password-session-1", sessionUser.id, "password");
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => ({
        user: sessionUser,
        session: {
          id: "password-session-1",
          createdAt: "2026-07-18T00:00:00.000Z",
          expiresAt: "2026-07-18T12:00:00.000Z",
        },
      })),
      authMode: "password",
      db,
    });

    await expect(port.verifyApplicationSession({ headers: new Headers() })).resolves.toMatchObject({
      assurance: "password",
      principal: { linkedSubject: null },
    });
  });

  it("does not infer per-session MFA assurance from account-level MFA enrollment", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, sessionUser.id, sessionUser.name, sessionUser.email);
    insertIdentityAccount(db, "credential-link", "credential", sessionUser.id, sessionUser.id);
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => ({
        user: { ...sessionUser, twoFactorEnabled: true },
        session: {
          id: "legacy-session-without-assurance",
          createdAt: "2026-07-18T00:00:00.000Z",
          expiresAt: "2026-07-18T12:00:00.000Z",
        },
      })),
      authMode: "password",
      db,
    });

    await expect(port.verifyApplicationSession({ headers: new Headers() })).resolves.toMatchObject({
      assurance: "password",
    });
  });

  it("fails closed when a mixed or external legacy session lacks provenance metadata", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, sessionUser.id, sessionUser.name, sessionUser.email);
    insertIdentityAccount(db, "external-link", "sso", "upstream-subject", sessionUser.id);
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => ({
        user: sessionUser,
        session: {
          id: "legacy-external-session-without-assurance",
          createdAt: "2026-07-18T00:00:00.000Z",
          expiresAt: "2026-07-18T12:00:00.000Z",
        },
      })),
      authMode: "password",
      db,
    });

    await expect(port.verifyApplicationSession({ headers: new Headers() })).rejects.toMatchObject({
      failure: { code: "DEPENDENCY_INVALID_RESPONSE" },
    });
  });

  it.each(["createdAt", "expiresAt"] as const)(
    "rejects an invalid provider session %s as a permanent contract failure",
    async (field) => {
      db = openDb(":memory:");
      await identityTables(db);
      const port = betterAuthIdentityPort({
        applicationId: "conformance-app",
        auth: auth(async () => ({
          user: sessionUser,
          session: {
            id: `invalid-${field}-session`,
            createdAt: field === "createdAt" ? "not-a-date" : "2026-07-18T00:00:00.000Z",
            expiresAt: field === "expiresAt" ? "not-a-date" : "2026-07-18T12:00:00.000Z",
          },
        })),
        authMode: "password",
        db,
      });

      await expect(port.verifyApplicationSession({ headers: new Headers() })).rejects.toMatchObject({
        failure: { code: "DEPENDENCY_INVALID_RESPONSE", retryable: false },
      });
    },
  );

  it("fails closed when an SSO session has no federated assurance record", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => ({
        user: sessionUser,
        session: {
          id: "unclassified-sso-session",
          createdAt: "2026-07-18T00:00:00.000Z",
          expiresAt: "2026-07-18T12:00:00.000Z",
        },
      })),
      authMode: "sso",
      db,
    });

    await expect(port.verifyApplicationSession({ headers: new Headers() })).rejects.toMatchObject({
      failure: { code: "DEPENDENCY_INVALID_RESPONSE", retryable: false },
    });
  });

  it("fails closed when a federated assurance record has no issuer/subject link", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    recordSessionAssurance(db, "orphaned-federated-session", sessionUser.id, "federated", "sso");
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => ({
        user: sessionUser,
        session: {
          id: "orphaned-federated-session",
          createdAt: "2026-07-18T00:00:00.000Z",
          expiresAt: "2026-07-18T12:00:00.000Z",
        },
      })),
      authMode: "sso",
      db,
    });

    await expect(port.verifyApplicationSession({ headers: new Headers() })).rejects.toMatchObject({
      failure: { code: "DEPENDENCY_INVALID_RESPONSE", retryable: false },
    });
  });

  it("validates credential input before calling the identity provider", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    const configuredAuth = auth(async () => null);
    const create = vi.mocked(configuredAuth.createCredentialUser);
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: configuredAuth,
      authMode: "password",
      db,
    });

    await expect(
      port.createProvisionalCredentialPrincipal({
        email: " Person@Example.com ",
        displayName: "Person",
        password: "a-valid-length-password",
        emailVerified: true,
        command: {
          commandId: "invalid-command",
          idempotencyKey: "invalid-idempotency",
        },
      }),
    ).rejects.toMatchObject({ failure: { code: "VALIDATION_FAILED" } });
    expect(create).not.toHaveBeenCalled();
  });

  it("maps the pinned SQLite duplicate-email constraint to an existing identity", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    const configuredAuth = auth(async () => null);
    const cause = Object.assign(new Error("UNIQUE constraint failed: user.email"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 2067,
      errstr: "constraint failed",
    });
    vi.mocked(configuredAuth.createCredentialUser).mockRejectedValue(cause);
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: configuredAuth,
      authMode: "password",
      db,
    });

    const rejection = await port
      .createProvisionalCredentialPrincipal({
        email: "person@example.com",
        displayName: "Person",
        password: "a-valid-length-password",
        emailVerified: true,
        command: {
          commandId: "duplicate-command",
          idempotencyKey: "duplicate-idempotency",
        },
      })
      .catch((error: unknown) => error);

    expect(rejection).toMatchObject({
      failure: {
        code: "IDENTITY_ALREADY_EXISTS",
        retryable: false,
        commandId: "duplicate-command",
      },
    });
    expect((rejection as Error).cause).toBe(cause);
  });

  it.each([
    ["Database connection is already closed.", {}],
    ["Identity store does not exist.", {}],
    ["Unique provider lookup is temporarily unavailable.", {}],
    ["UNIQUE constraint failed: user.id", { code: "ERR_SQLITE_ERROR", errcode: 2067 }],
  ])("preserves unrelated credential-provider failure %j", async (message, properties) => {
    db = openDb(":memory:");
    await identityTables(db);
    const configuredAuth = auth(async () => null);
    const cause = Object.assign(new Error(message), properties);
    vi.mocked(configuredAuth.createCredentialUser).mockRejectedValue(cause);
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: configuredAuth,
      authMode: "password",
      db,
    });

    const rejection = await port
      .createProvisionalCredentialPrincipal({
        email: "person@example.com",
        displayName: "Person",
        password: "a-valid-length-password",
        emailVerified: true,
        command: {
          commandId: "provider-command",
          idempotencyKey: "provider-idempotency",
        },
      })
      .catch((error: unknown) => error);

    expect(rejection).toMatchObject({
      failure: { code: "DEPENDENCY_UNAVAILABLE", retryable: true },
    });
    expect((rejection as Error).cause).toBe(cause);
  });

  it("rejects and rolls back direct deprovisioning when structured verification state is malformed", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, sessionUser.id, sessionUser.name, sessionUser.email);
    insertVerification(db, "malformed-link", `{"link":{"userId":"${sessionUser.id}"`);
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "password",
      db,
    });

    await expect(
      port.deprovisionLocalPrincipal({
        principalId: sessionUser.id,
        reason: "identity-erasure",
        command: {
          commandId: "deprovision-command",
          idempotencyKey: "deprovision-key",
        },
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "DEPENDENCY_INVALID_RESPONSE",
        retryable: false,
        commandId: "deprovision-command",
      },
    });
    expect(db.prepare(`SELECT id FROM user WHERE id = ?`).get(sessionUser.id)).toEqual({ id: sessionUser.id });
    expect(db.prepare(`SELECT id FROM verification WHERE id = 'malformed-link'`).get()).toEqual({
      id: "malformed-link",
    });
  });

  it("scans only structured verification candidates once when deprovisioning a principal set", async () => {
    const rawDb = openDb(":memory:");
    db = rawDb;
    await identityTables(rawDb);
    insertIdentityUser(rawDb, "principal-1", "One", "one@example.com");
    insertIdentityUser(rawDb, "principal-2", "Two", "two@example.com");
    insertIdentityUser(rawDb, "principal-3", "Three", "three@example.com");
    insertVerification(rawDb, "target-scalar", "principal-1");
    insertVerification(rawDb, "target-link", JSON.stringify({ link: { userId: "principal-2" } }));
    for (let index = 0; index < 5; index += 1) {
      insertVerification(rawDb, `unrelated-${index}`, `opaque-ceremony-${index}`);
    }
    insertVerification(rawDb, "unrelated-brace", "opaque-{ceremony");

    let fullVerificationScans = 0;
    let structuredVerificationScans = 0;
    let scalarSetDeletes = 0;
    const observedDb = new Proxy(rawDb, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            if (/^\s*SELECT id, value FROM verification\s*$/i.test(sql)) fullVerificationScans += 1;
            if (/^\s*SELECT id, value FROM verification WHERE instr\(value, '\{'\) > 0\s*$/i.test(sql)) {
              structuredVerificationScans += 1;
            }
            if (/^\s*DELETE FROM verification WHERE value IN \(SELECT value FROM json_each\(\?\)\)\s*$/i.test(sql)) {
              scalarSetDeletes += 1;
            }
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Db;
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "password",
      db: observedDb,
    });

    tx(rawDb, () => {
      port.deprovisionLocalPrincipalsInTx(["principal-1", "principal-2", "principal-3"]);
    });

    expect(fullVerificationScans).toBe(0);
    expect(structuredVerificationScans).toBe(1);
    expect(scalarSetDeletes).toBe(1);
    expect(rawDb.prepare(`SELECT id FROM user ORDER BY id`).all()).toEqual([]);
    expect(rawDb.prepare(`SELECT id FROM verification ORDER BY id`).all()).toEqual([
      { id: "unrelated-0" },
      { id: "unrelated-1" },
      { id: "unrelated-2" },
      { id: "unrelated-3" },
      { id: "unrelated-4" },
      { id: "unrelated-brace" },
    ]);
  });

  it("maps provider password-policy rejection to a terminal validation failure", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    const configuredAuth = auth(async () => null);
    vi.mocked(configuredAuth.createCredentialUser).mockRejectedValue(
      Object.assign(new Error("This password appears in a known breach. Choose a different password."), {
        body: { code: "PASSWORD_COMPROMISED" },
      }),
    );
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: configuredAuth,
      authMode: "password",
      db,
    });

    await expect(
      port.createProvisionalCredentialPrincipal({
        email: "person@example.com",
        displayName: "Person",
        password: "a-valid-length-password",
        emailVerified: true,
        command: {
          commandId: "policy-command",
          idempotencyKey: "policy-idempotency",
        },
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "VALIDATION_FAILED",
        retryable: false,
        commandId: "policy-command",
      },
    });
  });

  it("erases command-ledger correlation when compensating a provisional principal", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    const configuredAuth = auth(async () => null);
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: configuredAuth,
      authMode: "password",
      db,
    });
    const command = {
      commandId: "parent-command",
      idempotencyKey: "parent-key",
    };
    const provisional = await port.createProvisionalCredentialPrincipal({
      email: "person@example.com",
      displayName: "Person",
      password: "a-valid-length-password",
      emailVerified: true,
      command,
    });
    for (const [operation, commandId, idempotencyKey] of [
      ["parent", command.commandId, command.idempotencyKey],
      ["child", "child-command", "child-key"],
    ] as const) {
      reserveAccountCommand(db, {
        applicationId: "conformance-app",
        operation,
        idempotencyKey,
        commandId,
        actorPrincipalId: null,
        targetPrincipalId: provisional.principalId,
        payloadHash: "a".repeat(64),
      });
    }

    await port.compensateProvisionalPrincipal({
      provisional,
      reason: "invitation-claim-failed",
      command,
    });

    expect(getAccountCommand(db, "conformance-app", "child", "child-key")).toBeNull();
    expect(getAccountCommand(db, "conformance-app", "parent", "parent-key")).toMatchObject({ targetPrincipalId: null });
  });

  it("atomically observes direct federated admissions and validates every stored coordinate", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, "principal-1", "One", "one@example.com");
    insertIdentityUser(db, "orphan-1", "Orphan", "orphan@example.com");
    insertIdentityAccount(db, "link-1", "sso", "subject-1", "principal-1");
    insertIdentityAccount(db, "credential-1", "credential", "orphan-1", "orphan-1");
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "password",
      db,
    });

    expect(port.inspectSsoCutover("sso").requiredProviderLinks).toEqual([
      {
        rowId: "link-1",
        principalId: "principal-1",
        subject: "subject-1",
        verified: true,
      },
    ]);

    db.prepare(`UPDATE capacitylens_federated_link_observations SET principalId = ? WHERE accountRowId = ?`).run(
      "wrong-principal",
      "link-1",
    );
    expect(port.inspectSsoCutover("sso").requiredProviderLinks[0]).toMatchObject({ verified: false });
    expect(port.inspectProviderLinks("principal-1", "sso")).toEqual([
      { rowId: "link-1", subject: "subject-1", verified: false },
    ]);
  });

  it("ignores expired password-reset rows while retaining live readiness blockers", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, "principal-1", "One", "one@example.com");
    insertIdentityUser(db, "principal-2", "Two", "two@example.com");
    insertVerification(db, "expired-reset", "principal-1");
    insertVerification(db, "live-reset", "principal-2");
    db.prepare(`UPDATE verification SET expiresAt = ? WHERE id = ?`).run("2020-01-01T00:00:00.000Z", "expired-reset");
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "password",
      db,
    });

    expect(port.inspectSsoCutover("sso").outstandingResetPrincipalIds).toEqual(["principal-2"]);
  });

  it("records a first cutover even when no sessions or ceremonies remain", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "sso",
      db,
    });

    await expect(port.revokeAllForSsoCutover(() => undefined)).resolves.toEqual({ sessions: 0, ceremonies: 0 });
    await expect(port.revokeAllForSsoCutover(() => undefined)).resolves.toEqual({ sessions: 0, ceremonies: 0 });
    expect(db.prepare(`SELECT applicationId FROM capacitylens_sso_cutover_state`).all()).toEqual([
      { applicationId: "conformance-app" },
    ]);
    expect(
      db.prepare(`SELECT json_extract(payload, '$.action') AS action FROM capacitylens_audit_outbox`).all(),
    ).toEqual([{ action: "identity.sso_cutover_activated" }]);
  });

  it("rolls back the cutover when the readiness recheck fails under its writer reservation", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, "principal-1", "One", "one@example.com");
    insertVerification(db, "reset-1", "principal-1");
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "sso",
      db,
    });

    await expect(
      port.revokeAllForSsoCutover(() => {
        expect(db!.isTransaction).toBe(true);
        throw new Error("readiness changed");
      }),
    ).rejects.toThrow("readiness changed");
    expect(db.prepare(`SELECT id FROM verification`).all()).toEqual([{ id: "reset-1" }]);
    expect(db.prepare(`SELECT applicationId FROM capacitylens_sso_cutover_state`).all()).toEqual([]);
    expect(db.prepare(`SELECT id FROM capacitylens_audit_outbox`).all()).toEqual([]);
  });

  it("revokes password, MFA, federated, and assurance-less sessions plus every reset ceremony", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    for (const [index, assurance] of ["password", "mfa", "federated", "missing"].entries()) {
      const principalId = `principal-${index}`;
      const sessionId = `session-${index}`;
      insertIdentityUser(db, principalId, `Person ${index}`, `person-${index}@example.com`);
      db.prepare(
        `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(sessionId, LATER, `token-${index}`, NOW, NOW, principalId);
      if (assurance !== "missing") {
        recordSessionAssurance(
          db,
          sessionId,
          principalId,
          assurance as "password" | "mfa" | "federated",
          assurance === "federated" ? "sso" : undefined,
        );
      }
    }
    insertVerification(db, "reset-1", "principal-0");
    const configuredAuth = auth(async () => null);
    vi.mocked(configuredAuth.revokeUserSessions).mockImplementation(async (principalId) => {
      db!.prepare(`DELETE FROM session WHERE userId = ?`).run(principalId);
    });
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: configuredAuth,
      authMode: "password",
      db,
    });

    await expect(port.revokeAllForSsoCutover(() => undefined)).resolves.toEqual({ sessions: 4, ceremonies: 1 });
    await expect(port.revokeAllForSsoCutover(() => undefined)).resolves.toEqual({ sessions: 0, ceremonies: 0 });
    expect(configuredAuth.revokeUserSessions).not.toHaveBeenCalled();
    expect(db.prepare(`SELECT id FROM session`).all()).toEqual([]);
    expect(db.prepare(`SELECT sessionId FROM account_session_assurance`).all()).toEqual([]);
    expect(db.prepare(`SELECT id FROM verification`).all()).toEqual([]);
    expect(
      (
        db
          .prepare(`SELECT json_extract(payload, '$.action') AS action FROM capacitylens_audit_outbox ORDER BY action`)
          .all() as Array<{ action: string }>
      ).map(({ action }) => action),
    ).toEqual(["identity.sessions_revoked", "identity.sso_cutover_activated"]);
  });

  it("leaves an already-federated session untouched on a clean SSO-only restart", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    markSsoCutoverActivated(db);
    insertIdentityUser(db, "principal-1", "One", "one@example.com");
    const token = "federated-token";
    db.prepare(
      `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("provider-session-1", LATER, token, NOW, NOW, "principal-1");
    recordSessionAssurance(db, applicationSessionHandle("conformance-app", token), "principal-1", "federated", "sso");
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "sso",
      db,
    });

    await expect(port.revokeAllForSsoCutover(() => undefined)).resolves.toEqual({ sessions: 0, ceremonies: 0 });
    await expect(port.revokeAllForSsoCutover(() => undefined)).resolves.toEqual({ sessions: 0, ceremonies: 0 });
    expect(db.prepare(`SELECT id FROM session`).all()).toEqual([{ id: "provider-session-1" }]);
    expect(db.prepare(`SELECT id FROM capacitylens_audit_outbox`).all()).toEqual([]);
  });

  it("does not treat abandoned OAuth state as a new cutover ceremony", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    markSsoCutoverActivated(db);
    insertIdentityUser(db, "principal-1", "One", "one@example.com");
    const token = "federated-token";
    db.prepare(
      `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("provider-session-1", LATER, token, NOW, NOW, "principal-1");
    recordSessionAssurance(db, applicationSessionHandle("conformance-app", token), "principal-1", "federated", "sso");
    insertVerification(
      db,
      "oauth-state-1",
      JSON.stringify({
        callbackURL: "https://app.example/settings",
        codeVerifier: "verifier",
        expiresAt: Date.now() + 60_000,
        oauthState: "abandoned-state",
      }),
    );
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "sso",
      db,
    });

    await expect(port.revokeAllForSsoCutover(() => undefined)).resolves.toEqual({ sessions: 0, ceremonies: 0 });
    expect(db.prepare(`SELECT id FROM session`).all()).toEqual([{ id: "provider-session-1" }]);
    expect(db.prepare(`SELECT id FROM verification`).all()).toEqual([{ id: "oauth-state-1" }]);
    expect(db.prepare(`SELECT id FROM capacitylens_audit_outbox`).all()).toEqual([]);
  });

  it("corrects an identity email with ceremony invalidation, session revocation, and audit in one durable outcome", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, "principal-1", "One", "old@example.com");
    insertVerification(db, "reset-1", "principal-1");
    insertVerification(
      db,
      "link-state-1",
      JSON.stringify({
        oauthState: "state-1",
        callbackURL: "http://localhost/settings",
        expiresAt: Date.now() + 60_000,
        link: { userId: "principal-1", email: "old@example.com" },
      }),
    );
    insertVerification(
      db,
      "other-link-state",
      JSON.stringify({
        oauthState: "state-2",
        callbackURL: "http://localhost/settings",
        expiresAt: Date.now() + 60_000,
        link: { userId: "principal-2", email: "other@example.com" },
      }),
    );
    db.prepare(
      `INSERT INTO capacitylens_federated_link_ceremonies
        (id, principalId, providerId, createdAt, expiresAt, completedAt)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run("ceremony-1", "principal-1", "sso", NOW, LATER);
    recordSessionAssurance(db, "session-1", "principal-1", "password");
    db.prepare(
      `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("provider-session-1", LATER, "session-token-1", NOW, NOW, "principal-1");
    // Simulate a sign-in and a link ceremony landing at the identity-update boundary. Because the
    // update and revocation share one IMMEDIATE transaction, even rows created by this trigger are
    // removed before the correction commits.
    db.exec(`
      CREATE TRIGGER simulate_identity_race
      AFTER UPDATE OF email ON user
      WHEN NEW.id = 'principal-1'
      BEGIN
        INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
        VALUES ('raced-session', '${LATER}', 'raced-token', '${NOW}', '${NOW}', 'principal-1');
        INSERT INTO capacitylens_federated_link_ceremonies
          (id, principalId, providerId, createdAt, expiresAt, completedAt)
        VALUES ('raced-ceremony', 'principal-1', 'alternative', '${NOW}', '${LATER}', NULL);
      END;
    `);
    const configuredAuth = auth(async () => null);
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: configuredAuth,
      authMode: "password",
      db,
    });

    const authorizeInTransaction = vi.fn();
    await port.correctPrincipalEmail({
      principalId: "principal-1",
      email: "new@example.com",
      authorizeInTransaction,
      audit: {
        id: "email-audit-1",
        occurredAt: NOW,
        applicationId: "conformance-app",
        workspaceId: "workspace-1",
        actorPrincipalId: "owner-1",
        targetPrincipalId: "principal-1",
        commandId: null,
        action: "identity.email_corrected",
        outcome: "success",
        changedFields: ["email", "sessions"],
      },
    });

    expect(configuredAuth.revokeUserSessions).not.toHaveBeenCalled();
    expect(authorizeInTransaction).toHaveBeenCalledTimes(1);
    expect(db.prepare(`SELECT email, emailVerified FROM user WHERE id = ?`).get("principal-1")).toEqual({
      email: "new@example.com",
      emailVerified: 1,
    });
    expect(db.prepare(`SELECT id FROM verification`).all()).toEqual([{ id: "other-link-state" }]);
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
    expect(db.prepare(`SELECT sessionId FROM account_session_assurance`).all()).toEqual([]);
    expect(db.prepare(`SELECT id FROM session`).all()).toEqual([]);
    expect(db.prepare(`SELECT id FROM capacitylens_audit_outbox`).all()).toEqual([{ id: "email-audit-1" }]);
  });

  it("removes an incorrect provider link only after revoking sessions and commits its audit atomically", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, "principal-1", "One", "one@example.com");
    insertIdentityAccount(db, "link-1", "sso", "subject-1", "principal-1");
    insertIdentityAccount(db, "credential-1", "credential", "principal-1", "principal-1");
    db.prepare(`UPDATE account SET password = ? WHERE id = ?`).run("stored-password-hash", "credential-1");
    insertVerification(
      db,
      "stale-link-state",
      JSON.stringify({ oauthState: "old-state", link: { userId: "principal-1", email: "one@example.com" } }),
    );
    const configuredAuth = auth(async () => null);
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: configuredAuth,
      authMode: "password",
      db,
    });

    await expect(
      port.removeFederatedLink({
        principalId: "principal-1",
        providerId: "sso",
        rowId: "link-1",
        subject: "subject-1",
        authorizeInTransaction: vi.fn(),
        audit: {
          id: "unlink-audit-1",
          occurredAt: NOW,
          applicationId: "conformance-app",
          workspaceId: "workspace-1",
          actorPrincipalId: "owner-1",
          targetPrincipalId: "principal-1",
          commandId: null,
          action: "identity.federated_link_removed",
          outcome: "success",
          changedFields: ["federatedIdentity", "sessions"],
        },
      }),
    ).resolves.toBe(true);
    expect(configuredAuth.revokeUserSessions).not.toHaveBeenCalled();
    expect(db.prepare(`SELECT id FROM account WHERE providerId = 'sso'`).all()).toEqual([]);
    expect(db.prepare(`SELECT accountRowId FROM capacitylens_federated_link_observations`).all()).toEqual([]);
    expect(db.prepare(`SELECT id FROM verification`).all()).toEqual([]);
    expect(db.prepare(`SELECT id FROM capacitylens_audit_outbox`).all()).toEqual([{ id: "unlink-audit-1" }]);
  });

  it("refuses Owner self-repair when a federated link is the only viable sign-in method", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, "owner-1", "Owner", "owner@example.com");
    insertIdentityAccount(db, "only-link", "sso", "subject-1", "owner-1");
    insertIdentityAccount(db, "disabled-link", "disabled-provider", "stale-subject", "owner-1");
    db.prepare(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`).run(
      "workspace-1",
      "Studio",
      "#3b82f6",
      NOW,
      NOW,
    );
    db.prepare(
      `INSERT INTO account_members (accountId, userId, role, status, createdAt)
       VALUES (?, ?, 'owner', 'active', ?)`,
    ).run("workspace-1", "owner-1", NOW);
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "password",
      db,
    });

    await expect(
      port.removeFederatedLink({
        principalId: "owner-1",
        providerId: "sso",
        rowId: "only-link",
        subject: "subject-1",
        authorizeInTransaction: vi.fn(),
        audit: {
          id: "owner-unlink-audit",
          occurredAt: NOW,
          applicationId: "conformance-app",
          workspaceId: "workspace-1",
          actorPrincipalId: "owner-1",
          targetPrincipalId: "owner-1",
          commandId: null,
          action: "identity.federated_link_removed",
          outcome: "success",
          changedFields: ["federatedIdentity", "sessions"],
        },
      }),
    ).rejects.toMatchObject({ failure: { code: "CONFLICT" } });
    expect(db.prepare(`SELECT id FROM account WHERE id = 'only-link'`).get()).toEqual({ id: "only-link" });
    expect(db.prepare(`SELECT id FROM capacitylens_audit_outbox`).all()).toEqual([]);
  });

  it("allows the stopped-server repair capability to remove an unusable final provider link", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, "principal-1", "One", "one@example.com");
    insertIdentityAccount(db, "only-link", "sso", "subject-1", "principal-1");
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "password",
      db,
    });

    await expect(
      port.removeFederatedLinkForStoppedRepair({
        principalId: "principal-1",
        providerId: "sso",
        rowId: "only-link",
        subject: "subject-1",
        audit: {
          id: "stopped-unlink-audit",
          occurredAt: NOW,
          applicationId: "conformance-app",
          workspaceId: null,
          actorPrincipalId: null,
          targetPrincipalId: "principal-1",
          commandId: null,
          action: "identity.federated_link_removed",
          outcome: "success",
          changedFields: ["federatedIdentity", "sessions"],
        },
      }),
    ).resolves.toBe(true);
    expect(db.prepare(`SELECT id FROM account WHERE id = 'only-link'`).get()).toBeUndefined();
    expect(db.prepare(`SELECT id FROM capacitylens_audit_outbox`).all()).toEqual([{ id: "stopped-unlink-audit" }]);
  });

  it("never treats a password credential as a federated repair coordinate", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    insertIdentityUser(db, "principal-1", "One", "one@example.com");
    insertIdentityAccount(db, "credential-1", "credential", "principal-1", "principal-1");
    const port = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "password",
      db,
    });

    await expect(
      port.removeFederatedLinkForStoppedRepair({
        principalId: "principal-1",
        providerId: "credential",
        rowId: "credential-1",
        subject: "principal-1",
        audit: {
          id: "credential-unlink-audit",
          occurredAt: NOW,
          applicationId: "conformance-app",
          workspaceId: null,
          actorPrincipalId: null,
          targetPrincipalId: "principal-1",
          commandId: null,
          action: "identity.federated_link_removed",
          outcome: "success",
          changedFields: ["federatedIdentity", "sessions"],
        },
      }),
    ).rejects.toMatchObject({ failure: { code: "VALIDATION_FAILED" } });
    expect(db.prepare(`SELECT id FROM account WHERE id = 'credential-1'`).get()).toEqual({ id: "credential-1" });
  });

  it("keeps no session distinct from a retryable provider failure", async () => {
    db = openDb(":memory:");
    await identityTables(db);
    const absent = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => null),
      authMode: "sso",
      db,
    });
    await expect(absent.verifyApplicationSession({ headers: new Headers() })).resolves.toBeNull();

    const failed = betterAuthIdentityPort({
      applicationId: "conformance-app",
      auth: auth(async () => {
        throw new Error("provider unavailable");
      }),
      authMode: "sso",
      db,
    });
    await expect(failed.verifyApplicationSession({ headers: new Headers() })).rejects.toMatchObject({
      failure: { code: "DEPENDENCY_UNAVAILABLE", retryable: true },
    });
  });
});

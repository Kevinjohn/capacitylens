import { describe, it, expect, vi } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createApp } from "./app";
import { openDb, type Db } from "./db";
import {
  createAuthFromEnvironment,
  parseAuthMode,
  runAuthMigrations,
  AuthConfigError,
  DEMO_USER,
  MIN_BETTER_AUTH_SECRET_LENGTH,
  buildSessionUser,
} from "./auth";
import { finishAccountCommand, reserveAccountCommand } from "./accounts/state";
import { call, PASSWORD_ENV, readCookies as cookiesOf } from "./testHelpers";

// P3.1/P3.2/P3.5 (flag CAPACITYLENS_AUTH → opts.authMode/auth). The load-bearing assertion set:
// OFF is byte-for-byte today (the whole existing app.test.ts suite already enforces that
// by running unchanged — these tests add the /api/auth/me surface and the absence of the
// Better Auth routes); password gates every data route on a real session; sso issues a
// provider redirect; any misconfiguration refuses to boot via AuthConfigError.

const TS = "2026-01-01T00:00:00.000Z";
const account = {
  id: "a1",
  name: "Studio",
  color: "#3b82f6",
  createdAt: TS,
  updatedAt: TS,
};

function parseJsonObject(res: LightMyRequestResponse): object {
  const value: unknown = JSON.parse(res.body);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected response body to be a JSON object.");
  }
  return value;
}

function parseErrorCode(res: LightMyRequestResponse): string {
  const value = parseJsonObject(res);
  if (!("code" in value) || typeof value.code !== "string") {
    throw new Error("Expected response body to include a string error code.");
  }
  return value.code;
}

function parseAuthUser(value: object) {
  if (
    !("email" in value) ||
    typeof value.email !== "string" ||
    !("emailVerified" in value) ||
    typeof value.emailVerified !== "boolean"
  ) {
    throw new Error("Expected a valid authenticated user.");
  }
  return { email: value.email, emailVerified: value.emailVerified };
}

function parseAuthUserResponse(res: LightMyRequestResponse) {
  const value = parseJsonObject(res);
  if (!("user" in value) || typeof value.user !== "object" || value.user === null || Array.isArray(value.user)) {
    throw new Error("Expected response body to include a user.");
  }
  return parseAuthUser(value.user);
}

function parseResponseAuthMode(res: LightMyRequestResponse): string {
  const value = parseJsonObject(res);
  if (!("authMode" in value) || typeof value.authMode !== "string") {
    throw new Error("Expected response body to include an authentication mode.");
  }
  return value.authMode;
}

function parseErrorMessage(res: LightMyRequestResponse): string {
  const value = parseJsonObject(res);
  if (!("error" in value) || typeof value.error !== "string") {
    throw new Error("Expected response body to include a string error message.");
  }
  return value.error;
}

function parseResponseUrl(res: LightMyRequestResponse): string {
  const value = parseJsonObject(res);
  if (!("url" in value) || typeof value.url !== "string") {
    throw new Error("Expected response body to include a string URL.");
  }
  return value.url;
}

function parseConfiguredAuth(auth: ReturnType<typeof createAuthFromEnvironment>["auth"]) {
  if (auth === null) throw new Error("Expected authentication to be configured.");
  return auth;
}

function parseFederatedLink(auth: ReturnType<typeof createAuthFromEnvironment>["auth"]) {
  const configuredAuth = parseConfiguredAuth(auth);
  if (configuredAuth.beginFederatedLink === undefined) {
    throw new Error("Expected federated account linking to be configured.");
  }
  return configuredAuth.beginFederatedLink;
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

function registerAuthOffSurfaceTests(): void {
  it("reports the demo identity from /api/auth/me and gates nothing", async () => {
    const app = createApp(openDb(":memory:"));
    const me = await call(app, { method: "GET", url: "/api/auth/me" });
    expect(me.statusCode).toBe(200);
    // multiAccount/canCreateAccount (single-company cap capability flags): a fresh, empty DB and
    // default opts (multiAccount unset) reports the flag off but creation still open (zero accounts).
    expect(me.json()).toEqual({
      authMode: "off",
      user: DEMO_USER,
      providers: [],
      multiAccount: false,
      canCreateAccount: true,
    });
    // P1.7a: off is trusted-local, so the demo principal is verified with a clearly-local email.
    expect(parseAuthUserResponse(me)).toMatchObject({
      email: "demo@capacitylens.local",
      emailVerified: true,
    });
    // A cookie-less write succeeds — no request that succeeds today may fail in off mode.
    const write = await call(app, {
      method: "POST",
      url: "/api/accounts",
      payload: account,
    });
    expect(write.statusCode).toBe(201);
  });

  it("mounts NO Better Auth routes (zero new attack surface)", async () => {
    const app = createApp(openDb(":memory:"));
    const res = await call(app, { method: "GET", url: "/api/auth/get-session" });
    expect(res.statusCode).toBe(404);
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "a@b.test", password: "password-123456", name: "X" },
    });
    expect(signUp.statusCode).toBe(404);
  });
}

function registerAuthOffCommandIdentityTests(): void {
  it("rejects malformed caller-supplied command headers instead of silently replacing them", async () => {
    const app = createApp(openDb(":memory:"));
    const res = await call(app, {
      method: "POST",
      url: "/api/orgs",
      headers: {
        "idempotency-key": "valid-idempotency-key",
        "x-account-command-id": "also-short",
      },
      payload: { name: "Studio" },
    });
    expect(res.statusCode).toBe(400);
    expect(parseErrorCode(res)).toBe("VALIDATION_FAILED");
    expect(parseErrorMessage(res)).toMatch(/independently generated.*unguessable/i);
  });

  it("generates independent command and idempotency identities for compatibility callers", async () => {
    const db = openDb(":memory:");
    const app = createApp(db);
    const response = await call(app, {
      method: "POST",
      url: "/api/orgs",
      payload: { name: "Studio" },
    });
    expect(response.statusCode).toBe(201);
    const recorded = db
      .prepare(`SELECT commandId, idempotencyKey FROM account_commands WHERE operation LIKE 'workspace-provisioning:%'`)
      .get() as { commandId: string; idempotencyKey: string };
    expect(recorded.commandId).not.toBe(recorded.idempotencyKey);
  });
}

function registerAuthOffCommandStatusTests(): void {
  it("exposes command status only when both reconciliation bearers and operation match", async () => {
    const db = openDb(":memory:");
    const commandId = "command-000000000001";
    const idempotencyKey = "idempotency-0000001";
    reserveAccountCommand(db, {
      applicationId: "capacitylens",
      operation: "workspace-provisioning:actor:demo-user",
      idempotencyKey,
      commandId,
      actorPrincipalId: "demo-user",
      workspaceId: "workspace-1",
      payloadHash: "a".repeat(64),
    });
    finishAccountCommand(db, {
      applicationId: "capacitylens",
      operation: "workspace-provisioning:actor:demo-user",
      idempotencyKey,
      status: "completed",
      resultJson: "{}",
    });
    const app = createApp(db);

    const found = await call(app, {
      method: "POST",
      url: "/api/account-commands/reconcile",
      payload: {
        commandId,
        operation: "workspace-provisioning",
        idempotencyKey,
      },
    });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({
      status: "completed",
      receipt: { commandId },
    });
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/account-commands/reconcile",
          payload: {
            commandId,
            operation: "workspace-provisioning",
            idempotencyKey: "wrong-idempotency-1",
          },
        })
      ).statusCode,
    ).toBe(404);
  });
}

function registerAuthOffRepairRedactionTests(): void {
  it("redacts operator repair coordinates from the public command-status ceremony", async () => {
    const db = openDb(":memory:");
    const commandId = "command-000000000002";
    const idempotencyKey = "idempotency-0000002";
    reserveAccountCommand(db, {
      applicationId: "capacitylens",
      operation: "password-reset:actor:principal-actor",
      idempotencyKey,
      commandId,
      actorPrincipalId: "principal-actor",
      targetPrincipalId: "principal-target",
      workspaceId: "workspace-secret",
      payloadHash: "b".repeat(64),
    });
    finishAccountCommand(db, {
      applicationId: "capacitylens",
      operation: "password-reset:actor:principal-actor",
      idempotencyKey,
      status: "reconciliation_required",
      failureCode: "DEPENDENCY_UNAVAILABLE",
      resultJson: JSON.stringify({
        kind: "password-reset-revocation-failed",
        workspaceId: "workspace-secret",
        targetPrincipalId: "principal-target",
        provisionalPrincipalId: "principal-provisional",
        ceremonyId: "ceremony-secret",
      }),
    });
    const app = createApp(db);

    const response = await call(app, {
      method: "POST",
      url: "/api/account-commands/reconcile",
      payload: { commandId, operation: "password-reset", idempotencyKey },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "reconciliation-required",
      repair: {
        kind: "password-reset-revocation-failed",
        workspaceId: null,
        targetPrincipalId: null,
        provisionalPrincipalId: null,
        ceremonyId: null,
      },
    });
    expect(response.body).not.toMatch(/workspace-secret|principal-target|principal-provisional|ceremony-secret/);
  });
}

function registerAuthOffCorruptRepairTests(): void {
  it("returns a generic 500 and logs only the command coordinate for corrupt repair metadata", async () => {
    const db = openDb(":memory:");
    const commandId = "command-000000000003";
    const idempotencyKey = "idempotency-0000003";
    reserveAccountCommand(db, {
      applicationId: "capacitylens",
      operation: "password-reset:actor:principal-actor",
      idempotencyKey,
      commandId,
      actorPrincipalId: "principal-actor",
      targetPrincipalId: "principal-target",
      payloadHash: "c".repeat(64),
    });
    finishAccountCommand(db, {
      applicationId: "capacitylens",
      operation: "password-reset:actor:principal-actor",
      idempotencyKey,
      status: "reconciliation_required",
      failureCode: "DEPENDENCY_UNAVAILABLE",
      resultJson: JSON.stringify({ kind: "operator-review" }),
    });
    const corruptMetadata = '{"kind":"password-reset-issued","ceremonyId":"do-not-log"';
    db.exec("PRAGMA ignore_check_constraints = ON");
    db.prepare(`UPDATE account_commands SET resultJson = ? WHERE commandId = ?`).run(corruptMetadata, commandId);
    db.exec("PRAGMA ignore_check_constraints = OFF");
    const app = createApp(db);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await call(app, {
        method: "POST",
        url: "/api/account-commands/reconcile",
        payload: { commandId, operation: "password-reset", idempotencyKey },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Internal server error" });
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "CorruptAccountCommandStateError",
          code: "ACCOUNT_COMMAND_STATE_CORRUPT",
          commandId,
        }),
      );
      expect(JSON.stringify(logged.mock.calls)).not.toContain("do-not-log");
      expect(db.prepare(`SELECT status, resultJson FROM account_commands WHERE commandId = ?`).get(commandId)).toEqual({
        status: "reconciliation_required",
        resultJson: corruptMetadata,
      });
    } finally {
      logged.mockRestore();
    }
  });
}

describe("CAPACITYLENS_AUTH off (default)", () => {
  registerAuthOffSurfaceTests();
  registerAuthOffCommandIdentityTests();
  registerAuthOffCommandStatusTests();
  registerAuthOffRepairRedactionTests();
  registerAuthOffCorruptRepairTests();
});

describe("authentication request authority", () => {
  it("returns a bounded 400 for a malformed Host instead of throwing a 500", async () => {
    const app = await appWithAuth(PASSWORD_ENV);

    const res = await call(app, {
      method: "GET",
      url: "/api/auth/get-session",
      headers: { host: "exa mple.com" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid request authority." });
  });
});

// P1.7a — the narrowing boundary. normalizeSessionUser reads emailVerified from the full Better
// Auth user and defaults it to false, so a provider that omits verification can never present as
// verified. (getSession in authFromEnv wraps this; here we pin the pure mapping directly.)
describe("normalizeSessionUser (P1.7a)", () => {
  const RAW = { id: "u1", email: "u1@capacitylens.dev", name: "U One" };

  it("carries an explicit emailVerified: true", () => {
    expect(buildSessionUser({ ...RAW, emailVerified: true }).emailVerified).toBe(true);
  });

  it("carries an explicit emailVerified: false", () => {
    expect(buildSessionUser({ ...RAW, emailVerified: false }).emailVerified).toBe(false);
  });

  it("defaults emailVerified to false when the provider omits it, sends undefined, or sends null", () => {
    expect(buildSessionUser(RAW).emailVerified).toBe(false);
    expect(buildSessionUser({ ...RAW, emailVerified: undefined }).emailVerified).toBe(false);
    expect(buildSessionUser({ ...RAW, emailVerified: null }).emailVerified).toBe(false);
  });

  it("yields the approved public session fields and drops every other Better Auth field", () => {
    const out = buildSessionUser({ ...RAW, emailVerified: true });
    expect(out).toEqual({
      id: "u1",
      email: "u1@capacitylens.dev",
      emailVerified: true,
      name: "U One",
      twoFactorEnabled: false,
      image: null,
    });
    expect(Object.keys(out).sort()).toEqual(["email", "emailVerified", "id", "image", "name", "twoFactorEnabled"]);
  });

  it("carries a validated https avatar URL through as image", () => {
    expect(buildSessionUser({ ...RAW, image: "https://cdn.example/u1.png" }).image).toBe("https://cdn.example/u1.png");
  });

  it("nulls image when absent or non-https (the https backstop mirrors strictOidc)", () => {
    expect(buildSessionUser(RAW).image).toBeNull();
    expect(buildSessionUser({ ...RAW, image: null }).image).toBeNull();
    expect(buildSessionUser({ ...RAW, image: "http://cdn.example/u1.png" }).image).toBeNull();
    expect(buildSessionUser({ ...RAW, image: "javascript:alert(1)" }).image).toBeNull();
  });
});

describe("CAPACITYLENS_AUTH password", () => {
  it("401s data routes without a session; /api/health stays open", async () => {
    const app = await appWithAuth(PASSWORD_ENV);
    expect((await call(app, { method: "GET", url: "/api/state" })).statusCode).toBe(401);
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/accounts",
          payload: account,
        })
      ).statusCode,
    ).toBe(401);
    expect((await call(app, { method: "GET", url: "/api/health" })).statusCode).toBe(200);
    const me = await call(app, { method: "GET", url: "/api/auth/me" });
    expect(me.statusCode).toBe(401);
    expect(parseResponseAuthMode(me)).toBe("password"); // the login screen needs the mode
  });

  it("allowlists the Better Auth proxy surface so unclassified account mutations stay closed", async () => {
    const app = await appWithAuth(PASSWORD_ENV);
    for (const url of [
      "/api/auth/oauth2/link",
      "/api/auth/link-social",
      "/api/auth/unlink-account",
      "/api/auth/update-user",
      "/api/auth/change-email",
      "/api/auth/delete-user",
      "/api/auth/revoke-sessions",
      "/api/auth/future-account-mutation",
    ]) {
      const response = await call(app, { method: "POST", url, payload: {} });
      expect(response.statusCode, url).toBe(404);
    }
    expect((await call(app, { method: "GET", url: "/api/auth/future-read-route" })).statusCode).toBe(404);
    expect((await call(app, { method: "GET", url: "/api/auth/get-session" })).statusCode).not.toBe(404);
    expect((await call(app, { method: "POST", url: "/api/auth/two-factor/disable", payload: {} })).statusCode).not.toBe(
      404,
    );
    expect(
      (await call(app, { method: "POST", url: "/api/auth/two-factor/generate-backup-codes", payload: {} })).statusCode,
    ).not.toBe(404);
  });
});

describe("CAPACITYLENS_AUTH password", () => {
  it("refuses to relink a principal who already has the strict provider", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
    await runAuthMigrations(parseConfiguredAuth(configured.auth));
    const app = createApp(db, { authMode: "password", auth: configured.auth });
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "linked@example.com", password: "password-123456", name: "Linked" },
    });
    const principal = db.prepare(`SELECT id FROM user WHERE email = ?`).get("linked@example.com") as { id: string };
    db.prepare(
      `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("strict-link", "sso", "subject-1", principal.id, TS, TS);

    const response = await call(app, {
      method: "POST",
      url: "/api/identity/link-provider",
      headers: { cookie: cookiesOf(signUp) },
      payload: {
        callbackURL: "http://localhost:8787/settings",
        errorCallbackURL: "http://localhost:8787/settings",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(parseErrorCode(response)).toBe("PROVIDER_ALREADY_LINKED");
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
  });
});

describe("CAPACITYLENS_AUTH password", () => {
  it("refuses a corrupted principal with multiple strict-provider links", async () => {
    const raw = openDb(":memory:");
    const observed = new Proxy(raw, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (/SELECT id FROM account WHERE userId = \? AND providerId = \? ORDER BY id LIMIT 2/.test(sql)) {
              return new Proxy(statement, {
                get(statementTarget, statementProperty) {
                  if (statementProperty === "all") return () => [{ id: "link-1" }, { id: "link-2" }];
                  const value = Reflect.get(statementTarget, statementProperty, statementTarget) as unknown;
                  return typeof value === "function" ? value.bind(statementTarget) : value;
                },
              });
            }
            return statement;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Db;
    const configured = createAuthFromEnvironment(observed, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
    await runAuthMigrations(parseConfiguredAuth(configured.auth));
    const app = createApp(observed, { authMode: "password", auth: configured.auth });
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "multiple-links@example.com", password: "password-123456", name: "Multiple" },
    });

    const response = await call(app, {
      method: "POST",
      url: "/api/identity/link-provider",
      headers: { cookie: cookiesOf(signUp) },
      payload: {
        callbackURL: "http://localhost:8787/settings",
        errorCallbackURL: "http://localhost:8787/settings",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(parseErrorCode(response)).toBe("MULTIPLE_PROVIDER_LINKS");
    expect(raw.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
  });
});

describe("CAPACITYLENS_AUTH password", () => {
  it("guards provider-link initiation when no strict provider exists or the session principal does not match", async () => {
    const passwordDb = openDb(":memory:");
    const password = createAuthFromEnvironment(passwordDb, PASSWORD_ENV);
    await runAuthMigrations(parseConfiguredAuth(password.auth));
    await expect(
      parseFederatedLink(password.auth)({
        headers: new Headers(),
        principalId: "principal-1",
        callbackURL: "http://localhost:8787/settings",
        errorCallbackURL: "http://localhost:8787/settings",
      }),
    ).rejects.toMatchObject({ body: { code: "PROVIDER_NOT_FOUND" } });

    const strictDb = openDb(":memory:");
    const strict = createAuthFromEnvironment(strictDb, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
    await runAuthMigrations(parseConfiguredAuth(strict.auth));
    await expect(
      parseFederatedLink(strict.auth)({
        headers: new Headers(),
        principalId: "different-principal",
        callbackURL: "http://localhost:8787/settings",
        errorCallbackURL: "http://localhost:8787/settings",
      }),
    ).rejects.toMatchObject({ body: { code: "SESSION_EXPIRED" } });
    expect(strictDb.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
  });
});

describe("CAPACITYLENS_AUTH password", () => {
  it("rejects an untrusted link return URL before persisting a ceremony", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
    await runAuthMigrations(parseConfiguredAuth(configured.auth));
    const app = createApp(db, { authMode: "password", auth: configured.auth });
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "linker@example.com", password: "password-123456", name: "Linker" },
    });

    const response = await call(app, {
      method: "POST",
      url: "/api/identity/link-provider",
      headers: { cookie: cookiesOf(signUp) },
      payload: {
        callbackURL: "https://attacker.example/collect",
        errorCallbackURL: "http://localhost:8787/settings",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(parseErrorCode(response)).toBe("INVALID_CALLBACK_URL");
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
  });
});

describe("CAPACITYLENS_AUTH password", () => {
  it.each(["not an absolute URL", "http://user:password@localhost:8787/settings"])(
    "rejects malformed or credentialed link return URL %j before persisting a ceremony",
    async (callbackURL) => {
      const db = openDb(":memory:");
      const configured = createAuthFromEnvironment(db, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
      await runAuthMigrations(parseConfiguredAuth(configured.auth));
      const app = createApp(db, { authMode: "password", auth: configured.auth });
      const signUp = await call(app, {
        method: "POST",
        url: "/api/auth/sign-up/email",
        payload: { email: `link-url-${callbackURL.length}@example.com`, password: "password-123456", name: "Linker" },
      });

      const response = await call(app, {
        method: "POST",
        url: "/api/identity/link-provider",
        headers: { cookie: cookiesOf(signUp) },
        payload: {
          callbackURL,
          errorCallbackURL: "http://localhost:8787/settings",
        },
      });

      expect(response.statusCode).toBe(400);
      expect(parseErrorCode(response)).toBe("INVALID_CALLBACK_URL");
      expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
    },
  );
});

describe("CAPACITYLENS_AUTH password", () => {
  it("forwards the signed OAuth state cookie when a provider-link ceremony starts", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
    await runAuthMigrations(parseConfiguredAuth(configured.auth));
    const app = createApp(db, { authMode: "password", auth: configured.auth });
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "link-cookie@example.com", password: "password-123456", name: "Link Cookie" },
    });

    const response = await call(app, {
      method: "POST",
      url: "/api/identity/link-provider",
      headers: { cookie: cookiesOf(signUp) },
      payload: {
        callbackURL: "http://localhost:8787/settings",
        errorCallbackURL: "http://localhost:8787/settings",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(parseResponseUrl(response)).toContain("/api/auth/oidc/authorize/sso");
    expect(response.headers["set-cookie"]).toBeDefined();
    expect(cookiesOf(response)).toMatch(/state=/);
    expect(db.prepare(`SELECT principalId, providerId FROM capacitylens_federated_link_ceremonies`).all()).toHaveLength(
      1,
    );
  });
});

describe("CAPACITYLENS_AUTH password", () => {
  it("does not expose SSO email repair on an ordinary password-only installation", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
    await runAuthMigrations(parseConfiguredAuth(configured.auth));
    const app = createApp(db, { authMode: "password", auth: configured.auth });
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "owner@example.com",
        password: "password-123456",
        name: "Password Owner",
      },
    });
    expect(signUp.statusCode).toBe(200);
    const cookie = cookiesOf(signUp);
    const principalId = (db.prepare(`SELECT id FROM user WHERE email = ?`).get("owner@example.com") as { id: string })
      .id;
    db.prepare(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`).run(
      "workspace-1",
      "Studio",
      "#3b82f6",
      TS,
      TS,
    );
    db.prepare(
      `INSERT INTO account_members (accountId, userId, role, status, createdAt)
       VALUES (?, ?, 'owner', 'active', ?)`,
    ).run("workspace-1", principalId, TS);
    const response = await call(app, {
      method: "PATCH",
      url: `/api/accounts/workspace-1/members/${principalId}/email`,
      headers: { cookie },
      payload: { email: "corrected@example.com" },
    });

    expect(response.statusCode).toBe(400);
    expect(parseErrorMessage(response)).toMatch(/no strict OIDC provider/i);
    expect(db.prepare(`SELECT email FROM user WHERE id = ?`).get(principalId)).toEqual({
      email: "owner@example.com",
    });
  });
});

function registerAuthModeRefusalTests(): void {
  it("rejects an unknown CAPACITYLENS_AUTH value; blank/unset means off", () => {
    expect(() => parseAuthMode("on")).toThrow(AuthConfigError);
    expect(parseAuthMode(undefined)).toBe("off");
    expect(parseAuthMode("")).toBe("off");
  });

  it("off mode reads no BETTER_AUTH_* env at all", () => {
    const { mode, auth } = createAuthFromEnvironment(openDb(":memory:"), {
      CAPACITYLENS_AUTH: "off",
    });
    expect(mode).toBe("off");
    expect(auth).toBeNull();
  });

  it("password mode without secret or URL refuses", () => {
    const db = openDb(":memory:");
    expect(() => createAuthFromEnvironment(db, { CAPACITYLENS_AUTH: "password" })).toThrow(AuthConfigError);
    expect(() =>
      createAuthFromEnvironment(db, {
        CAPACITYLENS_AUTH: "password",
        BETTER_AUTH_SECRET: "x".repeat(32),
      }),
    ).toThrow(AuthConfigError);
  });

  it("password mode with a too-short secret refuses (length is the cause, not the URL)", () => {
    const db = openDb(":memory:");
    const tooShort = "x".repeat(MIN_BETTER_AUTH_SECRET_LENGTH - 1);
    let thrown: unknown;
    try {
      createAuthFromEnvironment(db, { ...PASSWORD_ENV, BETTER_AUTH_SECRET: tooShort });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AuthConfigError);
    // Message names the requirement + actual length, and never leaks the secret value.
    expect((thrown as Error).message).toContain(String(MIN_BETTER_AUTH_SECRET_LENGTH));
    expect((thrown as Error).message).not.toContain(tooShort);
  });
}

function registerCredentialAndDiscoveryConfigurationTests(): void {
  it("password mode with an exactly-32-char secret passes the length gate", () => {
    const db = openDb(":memory:");
    // PASSWORD_ENV has a valid URL; a 32-char secret must NOT trip the length check.
    expect(() =>
      createAuthFromEnvironment(db, {
        ...PASSWORD_ENV,
        BETTER_AUTH_SECRET: "x".repeat(MIN_BETTER_AUTH_SECRET_LENGTH),
      }),
    ).not.toThrow();
  });

  it("password mode refuses a weak first-owner setup token", () => {
    expect(() =>
      createAuthFromEnvironment(openDb(":memory:"), {
        ...PASSWORD_ENV,
        CAPACITYLENS_SETUP_TOKEN: "too-short",
      }),
    ).toThrow(/setup_token must be at least 32 bytes/i);
  });

  it("sso mode without OIDC discovery refuses", () => {
    const db = openDb(":memory:");
    expect(() =>
      createAuthFromEnvironment(db, {
        ...PASSWORD_ENV,
        CAPACITYLENS_AUTH: "sso",
        CAPACITYLENS_SSO_CLIENT_ID: "id",
        CAPACITYLENS_SSO_CLIENT_SECRET: "secret",
        // no discovery URL
      }),
    ).toThrow(AuthConfigError);
  });
}

function registerOidcEndpointRefusalTests(): void {
  it("rejects explicit authorization or token endpoint overrides for strict OIDC", () => {
    expect(() =>
      createAuthFromEnvironment(openDb(":memory:"), {
        ...SSO_ENV,
        CAPACITYLENS_SSO_AUTHORIZATION_URL: "https://idp.test/authorize",
      }),
    ).toThrow(/endpoints must come from discovery/i);
    expect(() =>
      createAuthFromEnvironment(openDb(":memory:"), {
        ...SSO_ENV,
        CAPACITYLENS_SSO_TOKEN_URL: "https://idp.test/token",
      }),
    ).toThrow(/endpoints must come from discovery/i);
  });

  it("rejects plaintext, credential-bearing, and non-HTTP identity-provider endpoints", () => {
    for (const endpoint of [
      "http://identity.example/.well-known/openid-configuration",
      "https://user:secret@identity.example/.well-known/openid-configuration",
      "javascript:alert(1)",
    ]) {
      expect(() =>
        createAuthFromEnvironment(openDb(":memory:"), {
          ...SSO_ENV,
          CAPACITYLENS_SSO_AUTHORIZATION_URL: undefined,
          CAPACITYLENS_SSO_TOKEN_URL: undefined,
          CAPACITYLENS_SSO_DISCOVERY_URL: endpoint,
        }),
      ).toThrow(/https|credentials|URL/i);
    }
  });

  it("permits plaintext provider endpoints only on explicit loopback development hosts", () => {
    expect(() =>
      createAuthFromEnvironment(openDb(":memory:"), {
        ...SSO_ENV,
        CAPACITYLENS_SSO_DISCOVERY_URL: "http://localhost:9999/.well-known/openid-configuration",
      }),
    ).not.toThrow();
  });
}

function registerOidcProviderIdTests(): void {
  it("restricts provider ids to route-safe lowercase identifiers", () => {
    for (const providerId of ["UPPER", "../callback", "sso space", "-sso"]) {
      expect(() =>
        createAuthFromEnvironment(openDb(":memory:"), {
          ...SSO_ENV,
          CAPACITYLENS_SSO_PROVIDER_ID: providerId,
        }),
      ).toThrow(/PROVIDER_ID/);
    }
  });

  it.each(["credential", "generic-oauth", "two-factor", "google", "microsoft", "github"])(
    "rejects the reserved generic OIDC provider id %s",
    (providerId) => {
      expect(() =>
        createAuthFromEnvironment(openDb(":memory:"), {
          ...SSO_ENV,
          CAPACITYLENS_SSO_PROVIDER_ID: providerId,
        }),
      ).toThrow(new RegExp(`reserved provider id.*${providerId}`, "i"));
    },
  );

  it("keeps a distinct generic OIDC provider alongside a native provider", () => {
    const configured = createAuthFromEnvironment(openDb(":memory:"), {
      ...SSO_ENV,
      CAPACITYLENS_SSO_PROVIDER_ID: "company-sso",
      CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
    });

    expect(parseConfiguredAuth(configured.auth).providers.map(({ id }) => id)).toEqual(["google", "company-sso"]);
    expect(parseConfiguredAuth(configured.auth).federatedIssuers.get("google")).toBe("https://accounts.google.com");
    expect(parseConfiguredAuth(configured.auth).federatedIssuers.get("company-sso")).toBe(
      SSO_ENV.CAPACITYLENS_SSO_ISSUER,
    );
  });

  it("buildApp refuses authMode ≠ off without an auth instance", () => {
    expect(() => createApp(openDb(":memory:"), { authMode: "password" })).toThrow(/requires a Better Auth instance/);
  });
}

describe("boot refusal (AuthConfigError)", () => {
  registerAuthModeRefusalTests();
  registerCredentialAndDiscoveryConfigurationTests();
  registerOidcEndpointRefusalTests();
  registerOidcProviderIdTests();
});

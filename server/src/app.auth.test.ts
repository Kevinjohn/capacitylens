import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { buildApp } from "./app";
import { openDb } from "./db";
import {
  authFromEnv,
  countUsers,
  createBootstrapAdmin,
  enforceSessionActivity,
  parseAuthMode,
  runAuthMigrations,
  AuthConfigError,
  BOOTSTRAP_ADMIN_EMAIL,
  DEMO_USER,
  MIN_BETTER_AUTH_SECRET_LENGTH,
  normalizeSessionUser,
  SESSION_INACTIVITY_TTL_SECONDS,
} from "./auth";
import { MIN_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";
import { finishAccountCommand, recordSessionAssurance, reserveAccountCommand } from "./accounts/state";
import { applicationSessionHandle } from "./accounts/sessionHandle";

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

const call = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject(opts) as unknown as Promise<LightMyRequestResponse>;

/** Collapse a response's Set-Cookie header(s) into one request Cookie header. */
function cookiesOf(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => String(c).split(";")[0]).join("; ");
}

function totpCode(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 TOTP secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = (digest.readUInt32BE(offset) & 0x7fff_ffff) % 1_000_000;
  return number.toString().padStart(6, "0");
}

const PASSWORD_ENV = {
  CAPACITYLENS_AUTH: "password",
  BETTER_AUTH_SECRET: "unit-test-secret-0123456789abcdef-0123",
  BETTER_AUTH_URL: "http://localhost:8787",
  // These broad auth fixtures create multiple users through the public sign-up route, so they use
  // the explicit test/dev escape. The production default-closed posture is asserted separately.
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
};

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
  const { mode, auth } = authFromEnv(db, env);
  await runAuthMigrations(auth!);
  return buildApp(db, { authMode: mode, auth });
}

describe("CAPACITYLENS_AUTH off (default)", () => {
  it("reports the demo identity from /api/auth/me and gates nothing", async () => {
    const app = buildApp(openDb(":memory:"));
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
    expect(me.json().user).toMatchObject({
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
    const app = buildApp(openDb(":memory:"));
    const res = await call(app, { method: "GET", url: "/api/auth/get-session" });
    expect(res.statusCode).toBe(404);
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "a@b.test", password: "password-123456", name: "X" },
    });
    expect(signUp.statusCode).toBe(404);
  });

  it("rejects malformed caller-supplied command headers instead of silently replacing them", async () => {
    const app = buildApp(openDb(":memory:"));
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
    expect(res.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      error: expect.stringMatching(/independently generated.*unguessable/i),
    });
  });

  it("generates independent command and idempotency identities for compatibility callers", async () => {
    const db = openDb(":memory:");
    const app = buildApp(db);
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
    const app = buildApp(db);

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
    const app = buildApp(db);

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
    const app = buildApp(db);
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
    expect(normalizeSessionUser({ ...RAW, emailVerified: true }).emailVerified).toBe(true);
  });

  it("carries an explicit emailVerified: false", () => {
    expect(normalizeSessionUser({ ...RAW, emailVerified: false }).emailVerified).toBe(false);
  });

  it("defaults emailVerified to false when the provider omits it (undefined or null)", () => {
    expect(normalizeSessionUser(RAW).emailVerified).toBe(false);
    expect(normalizeSessionUser({ ...RAW, emailVerified: undefined }).emailVerified).toBe(false);
    expect(normalizeSessionUser({ ...RAW, emailVerified: null }).emailVerified).toBe(false);
  });

  it("yields the approved public session fields and drops every other Better Auth field", () => {
    const out = normalizeSessionUser({ ...RAW, emailVerified: true });
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
    expect(normalizeSessionUser({ ...RAW, image: "https://cdn.example/u1.png" }).image).toBe(
      "https://cdn.example/u1.png",
    );
  });

  it("nulls image when absent or non-https (the https backstop mirrors strictOidc)", () => {
    expect(normalizeSessionUser(RAW).image).toBeNull();
    expect(normalizeSessionUser({ ...RAW, image: null }).image).toBeNull();
    expect(normalizeSessionUser({ ...RAW, image: "http://cdn.example/u1.png" }).image).toBeNull();
    expect(normalizeSessionUser({ ...RAW, image: "javascript:alert(1)" }).image).toBeNull();
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
    expect(me.json().authMode).toBe("password"); // the login screen needs the mode
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

  it("refuses to relink a principal who already has the strict provider", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
    await runAuthMigrations(configured.auth!);
    const app = buildApp(db, { authMode: "password", auth: configured.auth });
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
    expect(response.json().code).toBe("PROVIDER_ALREADY_LINKED");
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
  });

  it("guards provider-link initiation when no strict provider exists or the session principal does not match", async () => {
    const passwordDb = openDb(":memory:");
    const password = authFromEnv(passwordDb, PASSWORD_ENV);
    await runAuthMigrations(password.auth!);
    await expect(
      password.auth!.beginFederatedLink!({
        headers: new Headers(),
        principalId: "principal-1",
        callbackURL: "http://localhost:8787/settings",
        errorCallbackURL: "http://localhost:8787/settings",
      }),
    ).rejects.toMatchObject({ body: { code: "PROVIDER_NOT_FOUND" } });

    const strictDb = openDb(":memory:");
    const strict = authFromEnv(strictDb, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
    await runAuthMigrations(strict.auth!);
    await expect(
      strict.auth!.beginFederatedLink!({
        headers: new Headers(),
        principalId: "different-principal",
        callbackURL: "http://localhost:8787/settings",
        errorCallbackURL: "http://localhost:8787/settings",
      }),
    ).rejects.toMatchObject({ body: { code: "SESSION_EXPIRED" } });
    expect(strictDb.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
  });

  it("rejects an untrusted link return URL before persisting a ceremony", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
    await runAuthMigrations(configured.auth!);
    const app = buildApp(db, { authMode: "password", auth: configured.auth });
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
    expect(response.json().code).toBe("INVALID_CALLBACK_URL");
    expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
  });

  it.each(["not an absolute URL", "http://user:password@localhost:8787/settings"])(
    "rejects malformed or credentialed link return URL %j before persisting a ceremony",
    async (callbackURL) => {
      const db = openDb(":memory:");
      const configured = authFromEnv(db, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
      await runAuthMigrations(configured.auth!);
      const app = buildApp(db, { authMode: "password", auth: configured.auth });
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
      expect(response.json().code).toBe("INVALID_CALLBACK_URL");
      expect(db.prepare(`SELECT id FROM capacitylens_federated_link_ceremonies`).all()).toEqual([]);
    },
  );

  it("forwards the signed OAuth state cookie when a provider-link ceremony starts", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
    await runAuthMigrations(configured.auth!);
    const app = buildApp(db, { authMode: "password", auth: configured.auth });
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
    expect(response.json().url).toContain("/api/auth/oidc/authorize/sso");
    expect(response.headers["set-cookie"]).toBeDefined();
    expect(cookiesOf(response)).toMatch(/state=/);
    expect(db.prepare(`SELECT principalId, providerId FROM capacitylens_federated_link_ceremonies`).all()).toHaveLength(
      1,
    );
  });

  it("does not expose SSO email repair on an ordinary password-only installation", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(configured.auth!);
    const app = buildApp(db, { authMode: "password", auth: configured.auth });
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
    expect(response.json().error).toMatch(/no strict OIDC provider/i);
    expect(db.prepare(`SELECT email FROM user WHERE id = ?`).get(principalId)).toEqual({
      email: "owner@example.com",
    });
  });

  it("accepts federated assurance as MFA in mixed mode and advertises provider step-up", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
    await runAuthMigrations(configured.auth!);
    const principalId = "federated-principal";
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(principalId, "Federated Member", "federated@example.com", TS, TS);
    db.prepare(
      `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("federated-link", "sso", "subject-1", principalId, TS, TS);
    recordSessionAssurance(db, "federated-session", principalId, "federated", "sso", TS);
    const auth = {
      ...configured.auth!,
      api: {
        ...configured.auth!.api,
        getSession: vi.fn(async () => ({
          user: {
            id: principalId,
            name: "Federated Member",
            email: "federated@example.com",
            emailVerified: true,
            image: null,
            twoFactorEnabled: false,
          },
          session: { id: "federated-session", createdAt: TS, expiresAt: "2099-01-01T00:00:00.000Z" },
        })),
      },
    };
    const app = buildApp(db, { authMode: "password", auth, requireMfa: true });

    const data = await call(app, { method: "GET", url: "/api/accounts" });
    expect(data.statusCode).toBe(200);
    const me = await call(app, { method: "GET", url: "/api/auth/me" });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      mfaRequired: false,
      reauthMethod: "provider",
      reauthProviderId: "sso",
    });
  });

  it("requires enrollment, verifies TOTP, and challenges every later password sign-in", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(configured.auth!);
    const app = buildApp(db, {
      authMode: configured.mode,
      auth: configured.auth,
      requireMfa: true,
    });
    const email = "mfa-user@capacitylens.dev";
    const password = "password-123456";

    const signup = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email, password, name: "MFA User" },
    });
    expect(signup.statusCode).toBe(200);
    const signupCookie = cookiesOf(signup);
    const blocked = await call(app, {
      method: "GET",
      url: "/api/accounts",
      headers: { cookie: signupCookie },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe("MFA_ENROLLMENT_REQUIRED");

    const before = await call(app, {
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: signupCookie },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({
      mfaRequired: true,
      user: { twoFactorEnabled: false },
    });

    const enabled = await call(app, {
      method: "POST",
      url: "/api/auth/two-factor/enable",
      headers: { cookie: signupCookie },
      payload: { password },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().backupCodes).toHaveLength(10);
    const secret = new URL(enabled.json().totpURI as string).searchParams.get("secret");
    expect(secret).toBeTruthy();

    const verified = await call(app, {
      method: "POST",
      url: "/api/auth/two-factor/verify-totp",
      headers: { cookie: signupCookie },
      payload: { code: totpCode(secret!), trustDevice: false },
    });
    expect(verified.statusCode).toBe(200);
    const enrolledCookie = cookiesOf(verified);
    const after = await call(app, {
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: enrolledCookie },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({
      mfaRequired: false,
      user: { twoFactorEnabled: true },
    });
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/accounts",
          headers: { cookie: enrolledCookie },
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/auth/sign-out",
          headers: { cookie: enrolledCookie },
        })
      ).statusCode,
    ).toBe(200);
    const signIn = await call(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email, password },
    });
    expect(signIn.statusCode).toBe(200);
    expect(signIn.json()).toMatchObject({ twoFactorRedirect: true });
    const challengeCookie = cookiesOf(signIn);
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/accounts",
          headers: { cookie: challengeCookie },
        })
      ).statusCode,
    ).toBe(401);

    const completed = await call(app, {
      method: "POST",
      url: "/api/auth/two-factor/verify-totp",
      headers: { cookie: challengeCookie },
      payload: { code: totpCode(secret!), trustDevice: false },
    });
    expect(completed.statusCode).toBe(200);
    const finalCookie = cookiesOf(completed);
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/accounts",
          headers: { cookie: finalCookie },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("sign-up → session cookie → the session authenticates and /api/auth/me reports the user", async () => {
    const app = await appWithAuth(PASSWORD_ENV);
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "tester@capacitylens.dev",
        password: "password-123456",
        name: "Tester",
      },
    });
    expect(signUp.statusCode).toBe(200);
    const cookie = cookiesOf(signUp);
    expect(cookie).toContain("capacitylens.session_token");

    const me = await call(app, {
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().authMode).toBe("password");
    expect(me.json().user.email).toBe("tester@capacitylens.dev");
    expect(me.json().mfaRequired).toBe(false);
    // P1.7a: emailVerified flows through to /api/auth/me. A fresh email+password sign-up has no
    // verification infra, so Better Auth leaves the flag false — confirming the normalized flag
    // is present and defaults correctly (the P1.10 invite-bind gate depends on it).
    expect(me.json().user.emailVerified).toBe(false);

    // The GENERIC account create is CLOSED auth-on (403 → POST /api/orgs): the bare row write never
    // minted a membership, so it could only produce orphan accounts — /api/orgs is the atomic path.
    // A session is still proven to authenticate (403, an authz refusal — not the session-less 401).
    const write = await call(app, {
      method: "POST",
      url: "/api/accounts",
      payload: account,
      headers: { cookie },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json().error).toContain("/api/orgs");
    // P1.13: the no-arg whole read is CLOSED in auth-on (tenant isolation — the P1.4 carry-forward).
    // A logged-in user must hydrate PER ACCOUNT via ?accountId=, so the bare GET /api/state now 400s.
    const noArg = await call(app, {
      method: "GET",
      url: "/api/state",
      headers: { cookie },
    });
    expect(noArg.statusCode).toBe(400);
    // No membership exists for this fresh user, so the membership-existence guard 403s a scoped read
    // of 'a1' — the slice path itself is exercised in app.accounts.test.ts (member → 200). Here we
    // only pin that no-arg is closed.
    const scoped = await call(app, {
      method: "GET",
      url: "/api/state?accountId=a1",
      headers: { cookie },
    });
    expect(scoped.statusCode).toBe(403);
  });

  it("emits a valid __Host session cookie for an HTTPS public origin", async () => {
    const app = await appWithAuth({
      ...PASSWORD_ENV,
      BETTER_AUTH_URL: "https://capacity.example",
    });
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "host-cookie@capacitylens.dev",
        password: "password-123456",
        name: "Host Cookie",
      },
    });
    expect(signUp.statusCode).toBe(200);
    const raw = signUp.headers["set-cookie"];
    const cookies = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
    const session = cookies.find((cookie) => cookie.startsWith("__Host-capacitylens.session_token="));
    expect(session).toBeDefined();
    expect(session).toMatch(/;\s*Path=\//i);
    expect(session).toMatch(/;\s*Secure/i);
    expect(session).toMatch(/;\s*HttpOnly/i);
    expect(session).not.toMatch(/;\s*Domain=/i);
  });

  it.each([
    ["ordinary cookie", PASSWORD_ENV],
    ["secure __Host- cookie", { ...PASSWORD_ENV, BETTER_AUTH_URL: "https://capacity.example" }],
  ] as const)(
    "expires an idle session carried by an %s before a direct authenticated auth operation can use it",
    async (_label, env) => {
      const db = openDb(":memory:");
      const configured = authFromEnv(db, env);
      await runAuthMigrations(configured.auth!);
      const app = buildApp(db, {
        authMode: configured.mode,
        auth: configured.auth,
      });
      const signUp = await call(app, {
        method: "POST",
        url: "/api/auth/sign-up/email",
        payload: {
          email: "idle@capacitylens.dev",
          password: "password-123456",
          name: "Idle",
        },
      });
      const cookie = cookiesOf(signUp);
      // ISO-8601 text is what Better Auth's node:sqlite adapter actually stores — writing the
      // production representation here is what makes this a regression test for the CAS that
      // silently never matched integer-vs-text.
      db.prepare(`UPDATE session SET updatedAt = ?`).run(
        new Date(Date.now() - (SESSION_INACTIVITY_TTL_SECONDS + 1) * 1000).toISOString(),
      );

      // This route is handled by Better Auth itself, so it proves the inactivity check is not only
      // attached to CapacityLens data routes.
      const changed = await call(app, {
        method: "POST",
        url: "/api/auth/change-password",
        headers: { cookie },
        payload: {
          currentPassword: "password-123456",
          newPassword: "Seabird-lantern-47!",
          revokeOtherSessions: true,
        },
      });
      expect(changed.statusCode).toBe(401);
      expect((db.prepare(`SELECT COUNT(*) AS n FROM session`).get() as { n: number }).n).toBe(0);
      expect(
        (
          await call(app, {
            method: "GET",
            url: "/api/auth/me",
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(401);
    },
  );

  it("expires a session whose activity timestamp is in the future", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(configured.auth!);
    const app = buildApp(db, {
      authMode: configured.mode,
      auth: configured.auth,
    });
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "future-session@capacitylens.dev",
        password: "password-123456",
        name: "Future",
      },
    });
    const cookie = cookiesOf(signUp);
    db.prepare(`UPDATE session SET updatedAt = ?`).run(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());

    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/auth/me",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM session`).get() as { n: number }).n).toBe(0);
  });

  // Both storage representations: ISO-8601 text is what Better Auth's node:sqlite adapter really
  // writes (the column is declared `date`, so text stays text); integer epoch milliseconds is the
  // legacy fixture representation the implementation must also survive. The column below is
  // declared `date` like the real schema — a hand-made table with a different declared type once
  // hid the representation mismatch entirely.
  const boundaryCases = (["integer epoch", "ISO-8601 text"] as const).flatMap((rep) =>
    (
      [
        ["one millisecond before", SESSION_INACTIVITY_TTL_SECONDS * 1000 - 1, true],
        ["exactly at", SESSION_INACTIVITY_TTL_SECONDS * 1000, false],
        ["one millisecond after", SESSION_INACTIVITY_TTL_SECONDS * 1000 + 1, false],
      ] as const
    ).map(([label, elapsed, active]) => [`${label} (${rep})`, rep, elapsed, active] as const),
  );

  it.each(boundaryCases)(
    "treats a session %s the inactivity deadline as active=%s",
    async (_label, rep, elapsed, active) => {
      const db = openDb(":memory:");
      const now = Date.parse("2026-07-31T09:00:00.000Z");
      const token = `boundary-${rep}-${elapsed}`;
      const updatedAt = now - elapsed;
      const stored: string | number = rep === "integer epoch" ? updatedAt : new Date(updatedAt).toISOString();
      db.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date NOT NULL)`);
      db.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run(token, stored);
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
      try {
        const result = await enforceSessionActivity({ session: { token, updatedAt: new Date(updatedAt) } }, db);
        expect(result !== null).toBe(active);
        const expectedTouched = rep === "integer epoch" ? now : new Date(now).toISOString();
        expect(db.prepare(`SELECT updatedAt FROM session WHERE token = ?`).get(token)).toEqual(
          active ? { updatedAt: expectedTouched } : undefined,
        );
      } finally {
        nowSpy.mockRestore();
        db.close();
      }
    },
  );

  it("touches active sessions without extending their absolute expiry", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(configured.auth!);
    const app = buildApp(db, {
      authMode: configured.mode,
      auth: configured.auth,
    });
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "active@capacitylens.dev",
        password: "password-123456",
        name: "Active",
      },
    });
    const cookie = cookiesOf(signUp);
    const initial = db.prepare(`SELECT expiresAt FROM session`).get() as {
      expiresAt: string | number;
    };
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
    db.prepare(`UPDATE session SET updatedAt = ?`).run(new Date(twoMinutesAgo).toISOString());

    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/auth/me",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    const touched = db.prepare(`SELECT updatedAt, expiresAt FROM session`).get() as {
      updatedAt: string | number;
      expiresAt: string | number;
    };
    expect(new Date(touched.updatedAt).getTime()).toBeGreaterThan(twoMinutesAgo);
    expect(new Date(touched.expiresAt).getTime()).toBe(new Date(initial.expiresAt).getTime());
  });

  it("does not delete a session touched after an expired request resolved its stale snapshot", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(configured.auth!);
    const app = buildApp(db, { authMode: configured.mode, auth: configured.auth });
    await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "stale-delete@capacitylens.dev", password: "password-123456", name: "Stale" },
    });
    const stored = db.prepare(`SELECT token FROM session`).get() as { token: string };
    const stale = Date.now() - (SESSION_INACTIVITY_TTL_SECONDS + 1) * 1000;
    const newer = new Date(Date.now()).toISOString();
    db.prepare(`UPDATE session SET updatedAt = ? WHERE token = ?`).run(newer, stored.token);

    const resolved = await enforceSessionActivity({ session: { token: stored.token, updatedAt: new Date(stale) } }, db);

    expect(resolved).not.toBeNull();
    expect(db.prepare(`SELECT updatedAt FROM session WHERE token = ?`).get(stored.token)).toEqual({ updatedAt: newer });
  });

  it("does not move a concurrent newer session touch backward", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(configured.auth!);
    const app = buildApp(db, { authMode: configured.mode, auth: configured.auth });
    await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "monotonic-touch@capacitylens.dev", password: "password-123456", name: "Touch" },
    });
    const stored = db.prepare(`SELECT token FROM session`).get() as { token: string };
    const stale = Date.now() - 2 * 60 * 1000;
    const newer = new Date(Date.now() + 1_000).toISOString();
    db.prepare(`UPDATE session SET updatedAt = ? WHERE token = ?`).run(newer, stored.token);

    await enforceSessionActivity({ session: { token: stored.token, updatedAt: new Date(stale) } }, db);

    expect(db.prepare(`SELECT updatedAt FROM session WHERE token = ?`).get(stored.token)).toEqual({ updatedAt: newer });
  });

  it("destroys a session resolved with a non-finite activity timestamp", async () => {
    const db = openDb(":memory:");
    db.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
    db.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run("invalid-resolved", TS);

    await expect(
      enforceSessionActivity({ session: { token: "invalid-resolved", updatedAt: "not-a-timestamp" } }, db),
    ).resolves.toBeNull();
    expect(db.prepare(`SELECT token FROM session`).all()).toEqual([]);
  });

  it.each([
    ["a vanished row", false],
    ["an unparseable stored timestamp", true],
  ])("fails closed for idle expiry with %s", async (_name, insertMalformed) => {
    const db = openDb(":memory:");
    db.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
    if (insertMalformed) {
      db.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run("idle-invalid", "not-a-timestamp");
    }
    const expired = Date.now() - (SESSION_INACTIVITY_TTL_SECONDS + 1) * 1_000;

    await expect(
      enforceSessionActivity({ session: { token: "idle-invalid", updatedAt: new Date(expired) } }, db),
    ).resolves.toBeNull();
    expect(db.prepare(`SELECT token FROM session`).all()).toEqual([]);
  });

  it("adopts a concurrent touch when the idle-expiry CAS delete loses", async () => {
    const raw = openDb(":memory:");
    raw.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
    const expired = new Date(Date.now() - (SESSION_INACTIVITY_TTL_SECONDS + 1) * 1_000).toISOString();
    const winner = new Date().toISOString();
    raw.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run("idle-cas", expired);
    const raced = new Proxy(raw, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (/DELETE FROM session WHERE token = \? AND updatedAt = \?/.test(sql)) {
              return new Proxy(statement, {
                get(statementTarget, statementProperty) {
                  if (statementProperty === "run") {
                    return () => {
                      target.prepare(`UPDATE session SET updatedAt = ? WHERE token = ?`).run(winner, "idle-cas");
                      return { changes: 0 };
                    };
                  }
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
    }) as typeof raw;

    const session = { session: { token: "idle-cas", updatedAt: new Date(expired) } };
    await expect(enforceSessionActivity(session, raced)).resolves.toBe(session);
    expect(session.session.updatedAt.getTime()).toBe(Date.parse(winner));
  });

  it.each([
    ["a vanished row", false],
    ["an unparseable stored timestamp", true],
  ])("fails closed on the activity-touch path with %s", async (_name, insertMalformed) => {
    const db = openDb(":memory:");
    db.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
    if (insertMalformed) {
      db.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run("touch-invalid", "not-a-timestamp");
    }
    const stale = Date.now() - 2 * 60 * 1_000;

    await expect(
      enforceSessionActivity({ session: { token: "touch-invalid", updatedAt: new Date(stale) } }, db),
    ).resolves.toBeNull();
    expect(db.prepare(`SELECT token FROM session`).all()).toEqual([]);
  });

  it("adopts the winner when the activity-touch CAS loses", async () => {
    const raw = openDb(":memory:");
    raw.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
    const stale = new Date(Date.now() - 2 * 60 * 1_000).toISOString();
    const winner = new Date(Date.now() + 1_000).toISOString();
    raw.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run("touch-cas", stale);
    const raced = new Proxy(raw, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (/UPDATE session SET updatedAt = \? WHERE token = \? AND updatedAt = \?/.test(sql)) {
              return new Proxy(statement, {
                get(statementTarget, statementProperty) {
                  if (statementProperty === "run") {
                    return () => {
                      target.prepare(`UPDATE session SET updatedAt = ? WHERE token = ?`).run(winner, "touch-cas");
                      return { changes: 0 };
                    };
                  }
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
    }) as typeof raw;

    const session = { session: { token: "touch-cas", updatedAt: new Date(stale) } };
    await expect(enforceSessionActivity(session, raced)).resolves.toBe(session);
    expect(session.session.updatedAt.getTime()).toBe(Date.parse(winner));
  });

  it("sign-out invalidates the session again", async () => {
    const app = await appWithAuth(PASSWORD_ENV);
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "out@capacitylens.dev",
        password: "password-123456",
        name: "Out",
      },
    });
    const cookie = cookiesOf(signUp);
    const out = await call(app, {
      method: "POST",
      url: "/api/auth/sign-out",
      payload: {},
      headers: { cookie },
    });
    expect(out.statusCode).toBe(200);
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/state",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("lists and revokes sessions through neutral opaque handles without exposing bearer tokens", async () => {
    const db = openDb(":memory:");
    const configured = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(configured.auth!);
    const app = buildApp(db, {
      authMode: configured.mode,
      auth: configured.auth,
    });
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "sessions@capacitylens.dev",
        password: "password-123456",
        name: "Sessions",
      },
    });
    const cookie = cookiesOf(signUp);
    const raw = db.prepare(`SELECT id, token, userId FROM session`).get() as {
      id: string;
      token: string;
      userId: string;
    };
    const staleToken = "stale-session-bearer-token";
    const staleHandle = applicationSessionHandle("capacitylens", staleToken);
    db.prepare(
      `
      INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
    `,
    ).run(
      "stale-session-row",
      "2026-01-01T12:00:00.000Z",
      staleToken,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      raw.userId,
    );
    db.prepare(
      `
      INSERT INTO account_session_assurance (sessionId, principalId, assurance, providerId, createdAt)
      VALUES (?, ?, 'password', NULL, ?)
    `,
    ).run(staleHandle, raw.userId, "2026-01-01T00:00:00.000Z");

    const listed = await call(app, {
      method: "GET",
      url: "/api/account/sessions",
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    const { sessions } = listed.json() as { sessions: Array<{ id: string; current: boolean }> };
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ current: true });
    expect(sessions[0]!.id).not.toBe(raw.id);
    expect(sessions[0]!.id).toBe(applicationSessionHandle("capacitylens", raw.token));
    expect(JSON.stringify(sessions)).not.toContain(raw.token);
    expect(db.prepare(`SELECT 1 FROM session WHERE id = 'stale-session-row'`).get()).toBeUndefined();
    expect(db.prepare(`SELECT 1 FROM account_session_assurance WHERE sessionId = ?`).get(staleHandle)).toBeUndefined();

    const revoked = await call(app, {
      method: "DELETE",
      url: `/api/account/sessions/${sessions[0]!.id}`,
      headers: {
        cookie,
        "idempotency-key": "session-idempotency-0001",
        "x-account-command-id": "session-command-0000001",
      },
    });
    expect(revoked.statusCode).toBe(204);
    expect(revoked.body).toBe("");
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/auth/me",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("propagates sign-out cookie clearing through the neutral account route", async () => {
    const app = await appWithAuth(PASSWORD_ENV);
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "neutral-out@capacitylens.dev",
        password: "password-123456",
        name: "Out",
      },
    });
    const cookie = cookiesOf(signUp);
    const out = await call(app, {
      method: "POST",
      url: "/api/account/sign-out",
      headers: { cookie },
    });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0|Expires=/i);
    expect(
      (
        await call(app, {
          method: "GET",
          url: "/api/auth/me",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe("CAPACITYLENS_AUTH sso", () => {
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
    const { auth } = authFromEnv(openDb(":memory:"), SOCIAL_ENV);
    const social = auth!.options.socialProviders ?? {};
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
    const { auth } = authFromEnv(openDb(":memory:"), {
      ...SOCIAL_ENV,
      CAPACITYLENS_MICROSOFT_TENANT_ID: "tenant-123",
    });
    expect(auth!.options.socialProviders?.microsoft).toMatchObject({
      tenantId: "tenant-123",
    });
  });

  it("refuses a half-configured provider instead of silently hiding it", () => {
    expect(() =>
      authFromEnv(openDb(":memory:"), {
        ...PASSWORD_ENV,
        CAPACITYLENS_GITHUB_CLIENT_ID: "gh-id-only",
      }),
    ).toThrow(/must both be set/i);
  });

  it("is empty (no providers) when no social env is set", () => {
    const { auth } = authFromEnv(openDb(":memory:"), PASSWORD_ENV);
    expect(Object.keys(auth!.options.socialProviders ?? {})).toEqual([]);
  });
});

// P1.7 + first-run setup — open email self-registration is closed by default. The single
// bootstrap exception is an empty user table plus the operator's setup token; the gate is enforced
// live per request, so it closes on the very next request after the first identity. The explicit
// CAPACITYLENS_ALLOW_OPEN_SIGNUP=1 escape still re-opens registration unconditionally.
describe("closed self-registration (P1.7) + first-run bootstrap", () => {
  const SETUP_TOKEN = "unit-test-owner-setup-token-0123456789abcdef";
  /** PASSWORD_ENV but with the open-signup escape removed → default-closed posture. */
  const CLOSED_ENV: Record<string, string> = {
    ...PASSWORD_ENV,
    CAPACITYLENS_SETUP_TOKEN: SETUP_TOKEN,
  };
  delete CLOSED_ENV.CAPACITYLENS_ALLOW_OPEN_SIGNUP;

  const signUp = (app: FastifyInstance, email = "late@capacitylens.dev") =>
    call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "x-capacitylens-setup-token": SETUP_TOKEN },
      payload: { email, password: "password-123456", name: "Late" },
    });

  it("allows the first sign-up only with the operator setup token, then closes live", async () => {
    const app = await appWithAuth(CLOSED_ENV);
    const first = await signUp(app, "owner@capacitylens.dev");
    expect(first.statusCode).toBe(200);
    expect(cookiesOf(first)).toContain("capacitylens.session_token");
    // The gate is per REQUEST, not per boot: the very next sign-up on the SAME running app must
    // be refused now that one user exists — Better Auth's unchanged 400
    // EMAIL_PASSWORD_SIGN_UP_DISABLED shape (a boot-time boolean would stay open until restart).
    const second = await signUp(app, "late@capacitylens.dev");
    expect(second.statusCode).toBe(400);
    expect(cookiesOf(second)).not.toContain("capacitylens.session_token");
  });

  it("serializes concurrent first-owner sign-ups so exactly one identity is created", async () => {
    const app = await appWithAuth(CLOSED_ENV);
    const results = await Promise.all([
      signUp(app, "owner-one@capacitylens.dev"),
      signUp(app, "owner-two@capacitylens.dev"),
    ]);
    expect(results.filter((res) => res.statusCode === 200)).toHaveLength(1);
    expect(results.filter((res) => res.statusCode !== 200)).toHaveLength(1);
  });

  it("releases the bootstrap claim after success so erasing the sole identity reopens setup", async () => {
    const db = openDb(":memory:");
    const { mode, auth } = authFromEnv(db, CLOSED_ENV);
    await runAuthMigrations(auth!);
    const app = buildApp(db, { authMode: mode, auth });
    expect((await signUp(app, "first-owner@capacitylens.dev")).statusCode).toBe(200);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM capacitylens_bootstrap_claim`).get() as { n: number }).n).toBe(0);

    db.exec(`DELETE FROM session; DELETE FROM account; DELETE FROM user;`);
    expect((await signUp(app, "replacement-owner@capacitylens.dev")).statusCode).toBe(200);
  });

  it("releases the bootstrap claim when first-owner password policy rejects the endpoint", async () => {
    const db = openDb(":memory:");
    const { mode, auth } = authFromEnv(db, CLOSED_ENV);
    await runAuthMigrations(auth!);
    const app = buildApp(db, { authMode: mode, auth });

    const rejected = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "x-capacitylens-setup-token": SETUP_TOKEN },
      payload: {
        email: "first-owner@capacitylens.dev",
        password: "CapacityLens-password-123!",
        name: "First owner",
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ code: "PASSWORD_CONTEXT_REJECTED" });
    expect((db.prepare(`SELECT COUNT(*) AS n FROM capacitylens_bootstrap_claim`).get() as { n: number }).n).toBe(0);

    expect((await signUp(app, "replacement-owner@capacitylens.dev")).statusCode).toBe(200);
  });

  it("refuses a network visitor who lacks the fresh-instance setup token", async () => {
    const app = await appWithAuth(CLOSED_ENV);
    const missing = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "attacker@capacitylens.dev",
        password: "password-123456",
        name: "Attacker",
      },
    });
    const wrong = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "x-capacitylens-setup-token": "wrong-token" },
      payload: {
        email: "attacker@capacitylens.dev",
        password: "password-123456",
        name: "Attacker",
      },
    });
    expect(missing.statusCode).toBe(400);
    expect(wrong.statusCode).toBe(400);
    expect(cookiesOf(missing)).not.toContain("capacitylens.session_token");
  });

  it("allows sign-up with users already present only when CAPACITYLENS_ALLOW_OPEN_SIGNUP=1", async () => {
    const app = await appWithAuth({
      ...CLOSED_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
    });
    // First user consumes the bootstrap exception; the second still succeeds because the flag
    // re-opens sign-up unconditionally.
    expect((await signUp(app, "first@capacitylens.dev")).statusCode).toBe(200);
    const res = await signUp(app);
    expect(res.statusCode).toBe(200);
    expect(cookiesOf(res)).toContain("capacitylens.session_token");
  });

  it("open email signup validation failures leave the external bootstrap-claim table empty", async () => {
    const env = { ...CLOSED_ENV, CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1" };
    const db = openDb(":memory:");
    const { mode, auth } = authFromEnv(db, env);
    await runAuthMigrations(auth!);
    const app = buildApp(db, { authMode: mode, auth });
    const invalid = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        email: "invalid@capacitylens.dev",
        password: "short",
        name: "Invalid",
      },
    });
    expect(invalid.statusCode).toBeGreaterThanOrEqual(400);
    expect(invalid.statusCode).toBeLessThan(500);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM capacitylens_bootstrap_claim`).get() as { n: number }).n).toBe(0);
  });

  it("keeps the library flag OFF — the live hook owns the gate (disableSignUp stays false)", () => {
    // Better Auth 1.6.23 enforces disableSignUp even for server-side auth.api.signUpEmail
    // (sign-up.mjs:143), so the static flag must stay false in BOTH postures — the closed
    // behaviour above comes from hooks.before, never from this option.
    const open = authFromEnv(openDb(":memory:"), {
      ...CLOSED_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
    });
    const closed = authFromEnv(openDb(":memory:"), CLOSED_ENV);
    expect(open.auth!.options.emailAndPassword?.disableSignUp).toBe(false);
    expect(closed.auth!.options.emailAndPassword?.disableSignUp).toBe(false);
  });

  it("reports needsSetup on the /api/auth/me 401 at zero users, and drops it once a user exists", async () => {
    const app = await appWithAuth(CLOSED_ENV);
    // Zero users: the login screen must offer "Create the owner account" instead of a dead end.
    const before = await call(app, { method: "GET", url: "/api/auth/me" });
    expect(before.statusCode).toBe(401);
    expect(before.json().needsSetup).toBe(true);
    // The 401 shape still excludes account facts (only authMode/error/needsSetup — no capFields).
    expect(Object.keys(before.json()).sort()).toEqual(["authMode", "error", "needsSetup", "providers"]);
    // One user later, the flag is GONE (absent, not false — the client fail-closes on absence).
    expect((await signUp(app, "owner@capacitylens.dev")).statusCode).toBe(200);
    const after = await call(app, { method: "GET", url: "/api/auth/me" });
    expect(after.statusCode).toBe(401);
    expect(after.json().needsSetup).toBeUndefined();
  });
});

// First-run owner bootstrap (--create-owner-admin-admin / CAPACITYLENS_CREATE_ADMIN_ADMIN=1):
// createBootstrapAdmin creates admin@admin.admin with an operator-managed password on an EMPTY user
// table, skips (one line, not an error) when users exist, and refuses outside password mode.
describe("first-run owner bootstrap (createBootstrapAdmin)", () => {
  const BOOTSTRAP_PASSWORD = "operator-managed-bootstrap-password";
  const CLOSED_ENV: Record<string, string> = { ...PASSWORD_ENV };
  delete CLOSED_ENV.CAPACITYLENS_ALLOW_OPEN_SIGNUP;

  beforeEach(() => vi.stubEnv("CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD", BOOTSTRAP_PASSWORD));
  afterEach(() => vi.unstubAllEnvs());

  /** authFromEnv + migrations on a fresh in-memory DB, ready for createBootstrapAdmin. */
  async function bootstrapFixture(env: Record<string, string> = CLOSED_ENV) {
    const db = openDb(":memory:");
    const { mode, auth } = authFromEnv(db, env);
    await runAuthMigrations(auth!);
    return { db, mode, auth };
  }

  it("creates admin@admin.admin and confirms it without copying the operator password into logs", async () => {
    const { db, mode, auth } = await bootstrapFixture();
    const lines: string[] = [];
    expect(await createBootstrapAdmin(db, mode, auth, (l) => lines.push(l))).toBe("created");
    expect(countUsers(db)).toBe(1);
    const warning = lines.join("\n");
    expect(warning).toContain(BOOTSTRAP_ADMIN_EMAIL);
    expect(warning).toContain("operator-supplied CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD");
    expect(warning).not.toContain(BOOTSTRAP_PASSWORD);
  });

  it("signs in with the operator-managed bootstrap password on a later boot without the flag", async () => {
    const { db, mode, auth } = await bootstrapFixture();
    await createBootstrapAdmin(db, mode, auth, () => {});
    // "Restart": a fresh instance on the SAME DB, bootstrap flag absent → floor back at the min.
    const restarted = authFromEnv(db, CLOSED_ENV);
    expect(restarted.auth!.options.emailAndPassword?.minPasswordLength).toBe(MIN_PASSWORD_LENGTH);
    const app = buildApp(db, { authMode: restarted.mode, auth: restarted.auth });
    const signIn = await call(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: BOOTSTRAP_ADMIN_EMAIL, password: BOOTSTRAP_PASSWORD },
    });
    expect(signIn.statusCode).toBe(200);
    expect(cookiesOf(signIn)).toContain("capacitylens.session_token");
  });

  it("keeps a committed bootstrap credential recoverable when confirmation logging fails", async () => {
    const { db, mode, auth } = await bootstrapFixture();
    await expect(
      createBootstrapAdmin(db, mode, auth, () => {
        throw new Error("simulated logging failure");
      }),
    ).rejects.toThrow("simulated logging failure");
    expect(countUsers(db)).toBe(1);
    expect(await createBootstrapAdmin(db, mode, auth, () => {})).toBe("skipped");

    const restarted = authFromEnv(db, CLOSED_ENV);
    const app = buildApp(db, { authMode: restarted.mode, auth: restarted.auth });
    const signIn = await call(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: BOOTSTRAP_ADMIN_EMAIL, password: BOOTSTRAP_PASSWORD },
    });
    expect(signIn.statusCode).toBe(200);
  });

  it("refuses to create an irretrievable generated credential when the operator password is absent", async () => {
    vi.stubEnv("CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD", "");
    const { db, mode, auth } = await bootstrapFixture();

    await expect(createBootstrapAdmin(db, mode, auth, () => {})).rejects.toThrow(
      /requires CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD/,
    );
    expect(countUsers(db)).toBe(0);
  });

  it.each(["short", "x".repeat(1_000)])("rejects an out-of-range operator bootstrap password", async (password) => {
    vi.stubEnv("CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD", password);
    const { db, mode, auth } = await bootstrapFixture();

    await expect(createBootstrapAdmin(db, mode, auth, () => {})).rejects.toThrow(
      /CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD must be/,
    );
    expect(countUsers(db)).toBe(0);
  });

  it("keeps minPasswordLength at the shared floor ALWAYS — flagged boot or not, empty table or not", async () => {
    // The fix (review remediation): the instance-wide floor is never bent. The bootstrap's 5-char
    // password is created through a DIFFERENT path (auth.createCredentialUser(), bypassing the sign-up route
    // entirely — see createBootstrapAdmin) instead of lowering this option.
    const { auth } = await bootstrapFixture();
    expect(auth!.options.emailAndPassword?.minPasswordLength).toBe(MIN_PASSWORD_LENGTH);
    const seeded = await bootstrapFixture();
    await createBootstrapAdmin(seeded.db, seeded.mode, seeded.auth, () => {});
    const populated = authFromEnv(seeded.db, CLOSED_ENV);
    expect(populated.auth!.options.emailAndPassword?.minPasswordLength).toBe(MIN_PASSWORD_LENGTH);
    const plain = authFromEnv(openDb(":memory:"), CLOSED_ENV);
    expect(plain.auth!.options.emailAndPassword?.minPasswordLength).toBe(MIN_PASSWORD_LENGTH);
  });

  it("REJECTS a 5-char sign-up password during a boot where the bootstrap just ran (the floor is never bent for anything else)", async () => {
    const { db, mode, auth } = await bootstrapFixture();
    await createBootstrapAdmin(db, mode, auth, () => {});
    // Same DB, open self-registration so the sign-up ROUTE (not the bootstrap's internalAdapter
    // path) is reachable — this is exactly the "operator's own reset" / "sign-up that boot" case
    // the finding called out: it must NOT inherit any lowered floor.
    const open = authFromEnv(db, {
      ...CLOSED_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
    });
    const app = buildApp(db, { authMode: open.mode, auth: open.auth });
    const res = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: {
        name: "short",
        email: "short@capacitylens.dev",
        password: "admin",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("PASSWORD_TOO_SHORT");
  });

  it("enforces sign-up bounds in Unicode code points rather than UTF-16 code units", async () => {
    const { db } = await bootstrapFixture();
    const open = authFromEnv(db, {
      ...CLOSED_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
    });
    const app = buildApp(db, { authMode: open.mode, auth: open.auth });
    const signUpWith = (email: string, password: string) =>
      call(app, {
        method: "POST",
        url: "/api/auth/sign-up/email",
        payload: { name: "Unicode User", email, password },
      });

    const tooShort = await signUpWith("astral-short@capacitylens.dev", "🔐".repeat(14));
    expect(tooShort.statusCode).toBe(400);
    expect(tooShort.json().code).toBe("PASSWORD_TOO_SHORT");
    expect((await signUpWith("astral-min@capacitylens.dev", "🔐".repeat(15))).statusCode).toBe(200);
    expect((await signUpWith("astral-max@capacitylens.dev", "🔐".repeat(128))).statusCode).toBe(200);
    const tooLong = await signUpWith("astral-long@capacitylens.dev", "🔐".repeat(129));
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().code).toBe("PASSWORD_TOO_LONG");
  });

  it("enforces the code-point policy on direct identity creation that bypasses HTTP routes", async () => {
    const { auth } = await bootstrapFixture();
    await expect(
      auth!.createCredentialUser("direct-short@capacitylens.dev", "Direct Short", "🔐".repeat(14)),
    ).rejects.toThrow(`at least ${MIN_PASSWORD_LENGTH} characters`);
    await expect(
      auth!.createCredentialUser("direct-max@capacitylens.dev", "Direct Max", "🔐".repeat(128)),
    ).resolves.toEqual({ id: expect.any(String) });
  });

  it("skips with one line (not an error) when users already exist", async () => {
    const { db, mode, auth } = await bootstrapFixture();
    await createBootstrapAdmin(db, mode, auth, () => {});
    const lines: string[] = [];
    expect(await createBootstrapAdmin(db, mode, auth, (l) => lines.push(l))).toBe("skipped");
    expect(lines).toEqual(["capacitylens-server: --create-owner-admin-admin skipped: users already exist"]);
    expect(countUsers(db)).toBe(1); // no second account, no throw
  });

  it("fails startup recoverably while another first-owner flow holds the claim, then succeeds after release", async () => {
    const { db, mode, auth } = await bootstrapFixture();
    db.prepare(`INSERT INTO capacitylens_bootstrap_claim (id, claimedAt, claimToken) VALUES (1, ?, ?)`).run(
      new Date().toISOString(),
      "other-process",
    );
    await expect(createBootstrapAdmin(db, mode, auth, () => {})).rejects.toThrow(/retry startup.*five-minute/i);
    expect(countUsers(db)).toBe(0);
    db.prepare(`DELETE FROM capacitylens_bootstrap_claim WHERE claimToken = ?`).run("other-process");
    expect(await createBootstrapAdmin(db, mode, auth, () => {})).toBe("created");
    expect(countUsers(db)).toBe(1);
  });

  it("refuses loudly (AuthConfigError) when auth is off or sso — the flag is meaningless there", async () => {
    await expect(createBootstrapAdmin(openDb(":memory:"), "off", null)).rejects.toThrow(AuthConfigError);
    const sso = authFromEnv(openDb(":memory:"), SSO_ENV);
    await expect(createBootstrapAdmin(openDb(":memory:"), sso.mode, sso.auth)).rejects.toThrow(AuthConfigError);
  });

  // The user and credential link share one SQLite transaction. A provider-link constraint failure
  // must therefore leave the first-run user count at zero, so the same process can retry safely.
  it("rolls back user creation when the credential link fails, so a retry bootstrap succeeds", async () => {
    const { db, mode, auth } = await bootstrapFixture();
    db.exec(`
      CREATE TRIGGER fail_credential_link
      BEFORE INSERT ON account
      WHEN NEW.providerId = 'credential'
      BEGIN
        SELECT RAISE(ABORT, 'simulated credential-link failure');
      END;
    `);

    await expect(createBootstrapAdmin(db, mode, auth, () => {})).rejects.toThrow("simulated credential-link failure");
    expect(countUsers(db)).toBe(0);
    expect(
      (
        db.prepare(`SELECT COUNT(*) AS count FROM account`).get() as {
          count: number;
        }
      ).count,
    ).toBe(0);

    db.exec(`DROP TRIGGER fail_credential_link`);
    const lines: string[] = [];
    expect(await createBootstrapAdmin(db, mode, auth, (l) => lines.push(l))).toBe("created");
    expect(countUsers(db)).toBe(1);
  });
});

describe("boot refusal (AuthConfigError)", () => {
  it("rejects an unknown CAPACITYLENS_AUTH value; blank/unset means off", () => {
    expect(() => parseAuthMode("on")).toThrow(AuthConfigError);
    expect(parseAuthMode(undefined)).toBe("off");
    expect(parseAuthMode("")).toBe("off");
  });

  it("off mode reads no BETTER_AUTH_* env at all", () => {
    const { mode, auth } = authFromEnv(openDb(":memory:"), {
      CAPACITYLENS_AUTH: "off",
    });
    expect(mode).toBe("off");
    expect(auth).toBeNull();
  });

  it("password mode without secret or URL refuses", () => {
    const db = openDb(":memory:");
    expect(() => authFromEnv(db, { CAPACITYLENS_AUTH: "password" })).toThrow(AuthConfigError);
    expect(() =>
      authFromEnv(db, {
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
      authFromEnv(db, { ...PASSWORD_ENV, BETTER_AUTH_SECRET: tooShort });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AuthConfigError);
    // Message names the requirement + actual length, and never leaks the secret value.
    expect((thrown as Error).message).toContain(String(MIN_BETTER_AUTH_SECRET_LENGTH));
    expect((thrown as Error).message).not.toContain(tooShort);
  });

  it("password mode with an exactly-32-char secret passes the length gate", () => {
    const db = openDb(":memory:");
    // PASSWORD_ENV has a valid URL; a 32-char secret must NOT trip the length check.
    expect(() =>
      authFromEnv(db, {
        ...PASSWORD_ENV,
        BETTER_AUTH_SECRET: "x".repeat(MIN_BETTER_AUTH_SECRET_LENGTH),
      }),
    ).not.toThrow();
  });

  it("password mode refuses a weak first-owner setup token", () => {
    expect(() =>
      authFromEnv(openDb(":memory:"), {
        ...PASSWORD_ENV,
        CAPACITYLENS_SETUP_TOKEN: "too-short",
      }),
    ).toThrow(/setup_token must be at least 32 bytes/i);
  });

  it("sso mode without OIDC discovery refuses", () => {
    const db = openDb(":memory:");
    expect(() =>
      authFromEnv(db, {
        ...PASSWORD_ENV,
        CAPACITYLENS_AUTH: "sso",
        CAPACITYLENS_SSO_CLIENT_ID: "id",
        CAPACITYLENS_SSO_CLIENT_SECRET: "secret",
        // no discovery URL
      }),
    ).toThrow(AuthConfigError);
  });

  it("rejects explicit authorization or token endpoint overrides for strict OIDC", () => {
    expect(() =>
      authFromEnv(openDb(":memory:"), {
        ...SSO_ENV,
        CAPACITYLENS_SSO_AUTHORIZATION_URL: "https://idp.test/authorize",
      }),
    ).toThrow(/endpoints must come from discovery/i);
    expect(() =>
      authFromEnv(openDb(":memory:"), {
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
        authFromEnv(openDb(":memory:"), {
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
      authFromEnv(openDb(":memory:"), {
        ...SSO_ENV,
        CAPACITYLENS_SSO_DISCOVERY_URL: "http://localhost:9999/.well-known/openid-configuration",
      }),
    ).not.toThrow();
  });

  it("restricts provider ids to route-safe lowercase identifiers", () => {
    for (const providerId of ["UPPER", "../callback", "sso space", "-sso"]) {
      expect(() =>
        authFromEnv(openDb(":memory:"), {
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
        authFromEnv(openDb(":memory:"), {
          ...SSO_ENV,
          CAPACITYLENS_SSO_PROVIDER_ID: providerId,
        }),
      ).toThrow(new RegExp(`reserved provider id.*${providerId}`, "i"));
    },
  );

  it("keeps a distinct generic OIDC provider alongside a native provider", () => {
    const configured = authFromEnv(openDb(":memory:"), {
      ...SSO_ENV,
      CAPACITYLENS_SSO_PROVIDER_ID: "company-sso",
      CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
    });

    expect(configured.auth!.providers.map(({ id }) => id)).toEqual(["google", "company-sso"]);
    expect(configured.auth!.federatedIssuers.get("google")).toBe("https://accounts.google.com");
    expect(configured.auth!.federatedIssuers.get("company-sso")).toBe(SSO_ENV.CAPACITYLENS_SSO_ISSUER);
  });

  it("buildApp refuses authMode ≠ off without an auth instance", () => {
    expect(() => buildApp(openDb(":memory:"), { authMode: "password" })).toThrow(/requires a Better Auth instance/);
  });
});

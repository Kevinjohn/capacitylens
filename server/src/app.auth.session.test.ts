import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createApp } from "./app";
import { openDb } from "./db";
import {
  createAuthFromEnvironment,
  enforceSessionActivity,
  runAuthMigrations,
  SESSION_INACTIVITY_TTL_SECONDS,
} from "./auth";
import { recordSessionAssurance } from "./accounts/state";
import { buildApplicationSessionHandle } from "./accounts/buildApplicationSessionHandle";
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

function headerValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (value === undefined) return [];
  return [value];
}

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

function parseAuthMeResponse(res: LightMyRequestResponse) {
  const value = parseJsonObject(res);
  if (!("authMode" in value) || typeof value.authMode !== "string") {
    throw new Error("Expected authenticated response body to include authMode.");
  }
  if (!("mfaRequired" in value) || typeof value.mfaRequired !== "boolean") {
    throw new Error("Expected authenticated response body to include mfaRequired.");
  }
  if (!("user" in value) || typeof value.user !== "object" || value.user === null || Array.isArray(value.user)) {
    throw new Error("Expected authenticated response body to include a user.");
  }
  return {
    authMode: value.authMode,
    mfaRequired: value.mfaRequired,
    user: parseAuthUser(value.user),
  };
}

function parseErrorMessage(res: LightMyRequestResponse): string {
  const value = parseJsonObject(res);
  if (!("error" in value) || typeof value.error !== "string") {
    throw new Error("Expected response body to include a string error message.");
  }
  return value.error;
}

function parseBackupCodes(res: LightMyRequestResponse): string[] {
  const value = parseJsonObject(res);
  if (!("backupCodes" in value) || !Array.isArray(value.backupCodes)) {
    throw new Error("Expected response body to include backup codes.");
  }
  return Array.from(value.backupCodes, (code: unknown) => {
    if (typeof code !== "string") throw new Error("Expected every backup code to be a string.");
    return code;
  });
}

function parseTotpSecret(res: LightMyRequestResponse): string {
  const value = parseJsonObject(res);
  if (!("totpURI" in value) || typeof value.totpURI !== "string") {
    throw new Error("Expected response body to include a TOTP URI.");
  }
  const secret = new URL(value.totpURI).searchParams.get("secret");
  if (secret === null) throw new Error("Expected TOTP URI to include a secret.");
  return secret;
}

function parseConfiguredAuth(auth: ReturnType<typeof createAuthFromEnvironment>["auth"]) {
  if (auth === null) throw new Error("Expected authentication to be configured.");
  return auth;
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
  const finalByte = digest[digest.length - 1];
  if (finalByte === undefined) throw new Error("Expected a SHA-1 digest byte.");
  const offset = finalByte & 0x0f;
  const number = (digest.readUInt32BE(offset) & 0x7fff_ffff) % 1_000_000;
  return number.toString().padStart(6, "0");
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

/* c8 ignore start */
async function createSessionManagementFixture() {
  const db = openDb(":memory:");
  const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
  await runAuthMigrations(parseConfiguredAuth(configured.auth));
  const app = createApp(db, {
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
  const raw = db.prepare(`SELECT id, token, userId FROM session`).get() as {
    id: string;
    token: string;
    userId: string;
  };
  const staleToken = "stale-session-bearer-token";
  const staleHandle = buildApplicationSessionHandle("capacitylens", staleToken);
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
  return { app, cookie: cookiesOf(signUp), db, raw, staleHandle };
}
void createSessionManagementFixture;

function createLifecycleRaceFixture(next: string | null) {
  const raw = openDb(":memory:");
  raw.exec(`CREATE TABLE session (token TEXT PRIMARY KEY, updatedAt date)`);
  const now = Date.parse("2026-07-31T09:00:00.000Z");
  const expired = new Date(now - (SESSION_INACTIVITY_TTL_SECONDS + 1) * 1_000).toISOString();
  const token = "lifecycle-reread";
  raw.prepare(`INSERT INTO session (token, updatedAt) VALUES (?, ?)`).run(token, expired);
  const deletions = { count: 0 };
  const raced = new Proxy(raw, {
    get(target, property) {
      if (property === "exec") {
        return (sql: string) => {
          if (sql === "BEGIN IMMEDIATE") {
            // Another connection's update is visible by the time the writer reservation is acquired.
            if (next === null) target.prepare(`DELETE FROM session WHERE token = ?`).run(token);
            else target.prepare(`UPDATE session SET updatedAt = ? WHERE token = ?`).run(next, token);
          }
          return target.exec(sql);
        };
      }
      if (property === "prepare") {
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (sql === "DELETE FROM session WHERE token = ?") {
            return new Proxy(statement, {
              get(statementTarget, statementProperty) {
                if (statementProperty === "run") {
                  return (sessionToken: string) => {
                    deletions.count += 1;
                    return statementTarget.run(sessionToken);
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
  });
  return { deletions, expired, now, raced, raw, token };
}
/* c8 ignore stop */

async function createRequiredMfaFixture() {
  const db = openDb(":memory:");
  const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
  await runAuthMigrations(parseConfiguredAuth(configured.auth));
  const app = createApp(db, {
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
  expect(parseErrorCode(blocked)).toBe("MFA_ENROLLMENT_REQUIRED");
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
  return { app, email, password, signupCookie };
}

async function completeRequiredMfaEnrollment(options: {
  app: FastifyInstance;
  password: string;
  signupCookie: string;
}) {
  const enabled = await call(options.app, {
    method: "POST",
    url: "/api/auth/two-factor/enable",
    headers: { cookie: options.signupCookie },
    payload: { password: options.password },
  });
  expect(enabled.statusCode).toBe(200);
  expect(parseBackupCodes(enabled)).toHaveLength(10);
  const secret = parseTotpSecret(enabled);
  expect(secret).toBeTruthy();
  const verified = await call(options.app, {
    method: "POST",
    url: "/api/auth/two-factor/verify-totp",
    headers: { cookie: options.signupCookie },
    payload: { code: totpCode(secret), trustDevice: false },
  });
  expect(verified.statusCode).toBe(200);
  const enrolledCookie = cookiesOf(verified);
  const after = await call(options.app, {
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
      await call(options.app, {
        method: "GET",
        url: "/api/accounts",
        headers: { cookie: enrolledCookie },
      })
    ).statusCode,
  ).toBe(200);
  return { enrolledCookie, secret };
}

interface SessionActivityBoundaryInput {
  _label: string;
  rep: "integer epoch" | "ISO-8601 text";
  elapsed: number;
  active: boolean;
}

const sessionActivityBoundaryCases: SessionActivityBoundaryInput[] = (
  ["integer epoch", "ISO-8601 text"] as const
).flatMap((rep) =>
  (
    [
      ["one millisecond before", SESSION_INACTIVITY_TTL_SECONDS * 1000 - 1, true],
      ["exactly at", SESSION_INACTIVITY_TTL_SECONDS * 1000, false],
      ["one millisecond after", SESSION_INACTIVITY_TTL_SECONDS * 1000 + 1, false],
    ] as const
  ).map(([label, elapsed, active]) => ({ _label: `${label} (${rep})`, rep, elapsed, active })),
);

describe("CAPACITYLENS_AUTH password", () => {
  it("accepts federated assurance as MFA in mixed mode and advertises provider step-up", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, { ...SSO_ENV, CAPACITYLENS_AUTH: "password" });
    await runAuthMigrations(parseConfiguredAuth(configured.auth));
    const principalId = "federated-principal";
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(principalId, "Federated Member", "federated@example.com", TS, TS);
    db.prepare(
      `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("federated-link", "sso", "subject-1", principalId, TS, TS);
    recordSessionAssurance({
      db,
      sessionId: "federated-session",
      principalId,
      assurance: "federated",
      providerId: "sso",
      now: TS,
    });
    const auth = {
      ...parseConfiguredAuth(configured.auth),
      api: {
        ...parseConfiguredAuth(configured.auth).api,
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
    const app = createApp(db, { authMode: "password", auth, requireMfa: true });

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
});

describe("CAPACITYLENS_AUTH password", () => {
  it("requires enrollment, verifies TOTP, and challenges every later password sign-in", async () => {
    const { app, email, password, signupCookie } = await createRequiredMfaFixture();
    const { enrolledCookie, secret } = await completeRequiredMfaEnrollment({
      app,
      password,
      signupCookie,
    });

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
      payload: { code: totpCode(secret), trustDevice: false },
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
});

describe("CAPACITYLENS_AUTH password", () => {
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
    expect(parseAuthMeResponse(me).authMode).toBe("password");
    expect(parseAuthMeResponse(me).user.email).toBe("tester@capacitylens.dev");
    expect(parseAuthMeResponse(me).mfaRequired).toBe(false);
    // P1.7a: emailVerified flows through to /api/auth/me. A fresh email+password sign-up has no
    // verification infra, so Better Auth leaves the flag false — confirming the normalized flag
    // is present and defaults correctly (the P1.10 invite-bind gate depends on it).
    expect(parseAuthMeResponse(me).user.emailVerified).toBe(false);

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
    expect(parseErrorMessage(write)).toContain("/api/orgs");
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
});

describe("CAPACITYLENS_AUTH password", () => {
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
    const cookies = headerValues(raw).map(String);
    const session = cookies.find((cookie) => cookie.startsWith("__Host-capacitylens.session_token="));
    expect(session).toBeDefined();
    expect(session).toMatch(/;\s*Path=\//i);
    expect(session).toMatch(/;\s*Secure/i);
    expect(session).toMatch(/;\s*HttpOnly/i);
    expect(session).not.toMatch(/;\s*Domain=/i);
  });
});

describe("CAPACITYLENS_AUTH password", () => {
  it.each([
    ["ordinary cookie", PASSWORD_ENV],
    ["secure __Host- cookie", { ...PASSWORD_ENV, BETTER_AUTH_URL: "https://capacity.example" }],
  ] as const)(
    "expires an idle session carried by an %s before a direct authenticated auth operation can use it",
    async (_label, env) => {
      const db = openDb(":memory:");
      const configured = createAuthFromEnvironment(db, env);
      await runAuthMigrations(parseConfiguredAuth(configured.auth));
      const app = createApp(db, {
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
});

describe("CAPACITYLENS_AUTH password", () => {
  it("expires a session whose activity timestamp is in the future", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
    await runAuthMigrations(parseConfiguredAuth(configured.auth));
    const app = createApp(db, {
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
});

describe("CAPACITYLENS_AUTH password", () => {
  // Both storage representations exercise the real `date` column representation.
  it.each(sessionActivityBoundaryCases)(
    "treats a session $_label the inactivity deadline as active=$rep",
    async ({ rep, elapsed, active }: SessionActivityBoundaryInput) => {
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
});

describe("CAPACITYLENS_AUTH password", () => {
  it.each([
    { caseName: "fresh concurrent activity", next: "2026-07-31T09:00:00.000Z", preparationFails: false },
    { caseName: "malformed concurrent activity", next: "not-a-timestamp", preparationFails: false },
    { caseName: "preparation failure", next: "not-a-timestamp", preparationFails: true },
    { caseName: "a missing transaction reread", next: null, preparationFails: false },
  ])("preserves lifecycle expiry semantics for $caseName", async ({ next, preparationFails }) => {
    const { deletions, expired, now, raced, raw, token } = createLifecycleRaceFixture(next);
    const failure = new Error("Lifecycle preparation failed.");
    const handles = ["expired-session-handle"];
    const prepare = vi.fn((sessionToken: string, reason: "session_expired") => {
      expect(raw.isTransaction).toBe(true);
      expect(sessionToken).toBe(token);
      expect(reason).toBe("session_expired");
      expect(raw.prepare(`SELECT updatedAt FROM session WHERE token = ?`).get(token)).toEqual({ updatedAt: next });
      if (preparationFails) throw failure;
      return handles;
    });
    const commit = vi.fn(() => {
      expect(raw.isTransaction).toBe(false);
      expect(raw.prepare(`SELECT token FROM session`).all()).toEqual([]);
    });
    const session = { session: { token, updatedAt: new Date(expired) } };
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const result = enforceSessionActivity(session, raced, { prepare, commit });
      if (preparationFails) {
        await expect(result).rejects.toBe(failure);
        expect(prepare).toHaveBeenCalledOnce();
        expect(commit).not.toHaveBeenCalled();
        expect(deletions.count).toBe(0);
        expect(raw.isTransaction).toBe(false);
        expect(raw.prepare(`SELECT updatedAt FROM session WHERE token = ?`).get(token)).toEqual({ updatedAt: next });
      } else if (next === "2026-07-31T09:00:00.000Z") {
        await expect(result).resolves.toBe(session);
        expect(session.session.updatedAt.getTime()).toBe(now);
        expect(prepare).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(deletions.count).toBe(0);
        expect(raw.prepare(`SELECT updatedAt FROM session WHERE token = ?`).get(token)).toEqual({ updatedAt: next });
      } else {
        await expect(result).resolves.toBeNull();
        expect(prepare).toHaveBeenCalledTimes(next === null ? 0 : 1);
        expect(deletions.count).toBe(next === null ? 0 : 1);
        expect(commit).toHaveBeenCalledExactlyOnceWith(next === null ? [] : handles);
        expect(raw.prepare(`SELECT token FROM session`).all()).toEqual([]);
      }
    } finally {
      nowSpy.mockRestore();
      raw.close();
    }
  });
});

describe("CAPACITYLENS_AUTH password", () => {
  it("touches active sessions without extending their absolute expiry", async () => {
    const db = openDb(":memory:");
    const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
    await runAuthMigrations(parseConfiguredAuth(configured.auth));
    const app = createApp(db, {
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
});

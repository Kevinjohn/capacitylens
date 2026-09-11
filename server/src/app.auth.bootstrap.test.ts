import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createApp } from "./app";
import { openDb } from "./db";
import {
  createAuthFromEnvironment,
  countUsers,
  createBootstrapAdmin,
  runAuthMigrations,
  AuthConfigError,
  BOOTSTRAP_ADMIN_EMAIL,
} from "./auth";
import { MIN_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";
import { call, PASSWORD_ENV } from "./testHelpers";

/** Collapse a response's Set-Cookie header(s) into one request Cookie header. */
function headerValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (value === undefined) return [];
  return [value];
}

// Deliberately NOT testHelpers' readCookies: that one drops expired cookies and de-duplicates by
// name, which would silently weaken the negative assertions below (a cleared session cookie would
// no longer be seen). This keeps the original semantics — every Set-Cookie the server sent.
function cookiesOf(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  return headerValues(raw)
    .map((c) => String(c).split(";")[0])
    .join("; ");
}

// P3.1/P3.2/P3.5 (flag CAPACITYLENS_AUTH → opts.authMode/auth). The load-bearing assertion set:
// OFF is byte-for-byte today (the whole existing app.test.ts suite already enforces that
// by running unchanged — these tests add the /api/auth/me surface and the absence of the
// Better Auth routes); password gates every data route on a real session; sso issues a
// provider redirect; any misconfiguration refuses to boot via AuthConfigError.

function parseJsonObject(res: LightMyRequestResponse): object {
  const value: unknown = JSON.parse(res.body);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected response body to be a JSON object.");
  }
  return value;
}

function parseNeedsSetup(res: LightMyRequestResponse): boolean {
  const value = parseJsonObject(res);
  if (!("needsSetup" in value) || typeof value.needsSetup !== "boolean") {
    throw new Error("Expected response body to include a boolean needsSetup.");
  }
  return value.needsSetup;
}

function hasNeedsSetup(res: LightMyRequestResponse): boolean {
  return "needsSetup" in parseJsonObject(res);
}

function parseErrorCode(res: LightMyRequestResponse): string {
  const value = parseJsonObject(res);
  if (!("code" in value) || typeof value.code !== "string") {
    throw new Error("Expected response body to include a string error code.");
  }
  return value.code;
}

function parseCreatedUserId(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected the created user to contain only a string id.");
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "id" || !("id" in value) || typeof value.id !== "string") {
    throw new Error("Expected the created user to contain only a string id.");
  }
  return value.id;
}

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

const SETUP_TOKEN = "unit-test-owner-setup-token-0123456789abcdef";
/** PASSWORD_ENV but with the open-signup escape removed → default-closed posture. */
const CLOSED_SIGNUP_ENV: Record<string, string> = {
  ...PASSWORD_ENV,
  CAPACITYLENS_SETUP_TOKEN: SETUP_TOKEN,
};
delete CLOSED_SIGNUP_ENV.CAPACITYLENS_ALLOW_OPEN_SIGNUP;

const signUpWithSetupToken = (app: FastifyInstance, email = "late@capacitylens.dev") =>
  call(app, {
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "x-capacitylens-setup-token": SETUP_TOKEN },
    payload: { email, password: "password-123456", name: "Late" },
  });

async function appWithAuth(env: Record<string, string>): Promise<FastifyInstance> {
  const db = openDb(":memory:");
  const { mode, auth } = createAuthFromEnvironment(db, env);
  await runAuthMigrations(parseConfiguredAuth(auth));
  return createApp(db, { authMode: mode, auth });
}

function registerClosedSignupLifecycleTests(): void {
  it("allows the first sign-up only with the operator setup token, then closes live", async () => {
    const app = await appWithAuth(CLOSED_SIGNUP_ENV);
    const first = await signUpWithSetupToken(app, "owner@capacitylens.dev");
    expect(first.statusCode).toBe(200);
    expect(cookiesOf(first)).toContain("capacitylens.session_token");
    // The gate is per REQUEST, not per boot: the very next sign-up on the SAME running app must
    // be refused now that one user exists — Better Auth's unchanged 400
    // EMAIL_PASSWORD_SIGN_UP_DISABLED shape (a boot-time boolean would stay open until restart).
    const second = await signUpWithSetupToken(app, "late@capacitylens.dev");
    expect(second.statusCode).toBe(400);
    expect(cookiesOf(second)).not.toContain("capacitylens.session_token");
  });

  it("serializes concurrent first-owner sign-ups so exactly one identity is created", async () => {
    const app = await appWithAuth(CLOSED_SIGNUP_ENV);
    const results = await Promise.all([
      signUpWithSetupToken(app, "owner-one@capacitylens.dev"),
      signUpWithSetupToken(app, "owner-two@capacitylens.dev"),
    ]);
    expect(results.filter((res) => res.statusCode === 200)).toHaveLength(1);
    expect(results.filter((res) => res.statusCode !== 200)).toHaveLength(1);
  });

  it("releases the bootstrap claim after success so erasing the sole identity reopens setup", async () => {
    const db = openDb(":memory:");
    const { mode, auth } = createAuthFromEnvironment(db, CLOSED_SIGNUP_ENV);
    await runAuthMigrations(parseConfiguredAuth(auth));
    const app = createApp(db, { authMode: mode, auth });
    expect((await signUpWithSetupToken(app, "first-owner@capacitylens.dev")).statusCode).toBe(200);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM capacitylens_bootstrap_claim`).get() as { n: number }).n).toBe(0);

    db.exec(`DELETE FROM session; DELETE FROM account; DELETE FROM user;`);
    expect((await signUpWithSetupToken(app, "replacement-owner@capacitylens.dev")).statusCode).toBe(200);
  });
}

function registerClosedSignupRejectionTests(): void {
  it("releases the bootstrap claim when first-owner password policy rejects the endpoint", async () => {
    const db = openDb(":memory:");
    const { mode, auth } = createAuthFromEnvironment(db, CLOSED_SIGNUP_ENV);
    await runAuthMigrations(parseConfiguredAuth(auth));
    const app = createApp(db, { authMode: mode, auth });

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

    expect((await signUpWithSetupToken(app, "replacement-owner@capacitylens.dev")).statusCode).toBe(200);
  });

  it("refuses a network visitor who lacks the fresh-instance setup token", async () => {
    const app = await appWithAuth(CLOSED_SIGNUP_ENV);
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
}

function registerOpenSignupEscapeTests(): void {
  it("allows sign-up with users already present only when CAPACITYLENS_ALLOW_OPEN_SIGNUP=1", async () => {
    const app = await appWithAuth({
      ...CLOSED_SIGNUP_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
    });
    // First user consumes the bootstrap exception; the second still succeeds because the flag
    // re-opens sign-up unconditionally.
    expect((await signUpWithSetupToken(app, "first@capacitylens.dev")).statusCode).toBe(200);
    const res = await signUpWithSetupToken(app);
    expect(res.statusCode).toBe(200);
    expect(cookiesOf(res)).toContain("capacitylens.session_token");
  });

  it("open email signup validation failures leave the external bootstrap-claim table empty", async () => {
    const env = { ...CLOSED_SIGNUP_ENV, CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1" };
    const db = openDb(":memory:");
    const { mode, auth } = createAuthFromEnvironment(db, env);
    await runAuthMigrations(parseConfiguredAuth(auth));
    const app = createApp(db, { authMode: mode, auth });
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
}

function registerClosedSignupStatusTests(): void {
  it("keeps the library flag OFF — the live hook owns the gate (disableSignUp stays false)", () => {
    // Better Auth 1.6.23 enforces disableSignUp even for server-side auth.api.signUpEmail
    // (sign-up.mjs:143), so the static flag must stay false in BOTH postures — the closed
    // behaviour above comes from hooks.before, never from this option.
    const open = createAuthFromEnvironment(openDb(":memory:"), {
      ...CLOSED_SIGNUP_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
    });
    const closed = createAuthFromEnvironment(openDb(":memory:"), CLOSED_SIGNUP_ENV);
    expect(parseConfiguredAuth(open.auth).options.emailAndPassword?.disableSignUp).toBe(false);
    expect(parseConfiguredAuth(closed.auth).options.emailAndPassword?.disableSignUp).toBe(false);
  });

  it("reports needsSetup on the /api/auth/me 401 at zero users, and drops it once a user exists", async () => {
    const app = await appWithAuth(CLOSED_SIGNUP_ENV);
    // Zero users: the login screen must offer "Create the owner account" instead of a dead end.
    const before = await call(app, { method: "GET", url: "/api/auth/me" });
    expect(before.statusCode).toBe(401);
    expect(parseNeedsSetup(before)).toBe(true);
    // The 401 shape still excludes account facts (only authMode/error/needsSetup — no capFields).
    expect(Object.keys(parseJsonObject(before)).sort()).toEqual(["authMode", "error", "needsSetup", "providers"]);
    // One user later, the flag is GONE (absent, not false — the client fail-closes on absence).
    expect((await signUpWithSetupToken(app, "owner@capacitylens.dev")).statusCode).toBe(200);
    const after = await call(app, { method: "GET", url: "/api/auth/me" });
    expect(after.statusCode).toBe(401);
    expect(hasNeedsSetup(after)).toBe(false);
  });
}

describe("closed self-registration (P1.7) + first-run bootstrap", () => {
  registerClosedSignupLifecycleTests();
  registerClosedSignupRejectionTests();
  registerOpenSignupEscapeTests();
  registerClosedSignupStatusTests();
});

const BOOTSTRAP_PASSWORD = "operator-managed-bootstrap-password";
const CLOSED_ENV: Record<string, string> = { ...PASSWORD_ENV };
delete CLOSED_ENV.CAPACITYLENS_ALLOW_OPEN_SIGNUP;

/** authFromEnv + migrations on a fresh in-memory DB, ready for createBootstrapAdmin. */
async function bootstrapFixture(env: Record<string, string> = CLOSED_ENV) {
  const db = openDb(":memory:");
  const { mode, auth } = createAuthFromEnvironment(db, env);
  await runAuthMigrations(parseConfiguredAuth(auth));
  return { db, mode, auth };
}

// First-run owner bootstrap (--create-owner-admin-admin / CAPACITYLENS_CREATE_ADMIN_ADMIN=1):
// createBootstrapAdmin creates admin@admin.admin with an operator-managed password on an EMPTY user
// table, skips (one line, not an error) when users exist, and refuses outside password mode.
function registerBootstrapCreationTests(): void {
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
    const restarted = createAuthFromEnvironment(db, CLOSED_ENV);
    expect(parseConfiguredAuth(restarted.auth).options.emailAndPassword?.minPasswordLength).toBe(MIN_PASSWORD_LENGTH);
    const app = createApp(db, { authMode: restarted.mode, auth: restarted.auth });
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

    const restarted = createAuthFromEnvironment(db, CLOSED_ENV);
    const app = createApp(db, { authMode: restarted.mode, auth: restarted.auth });
    const signIn = await call(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: BOOTSTRAP_ADMIN_EMAIL, password: BOOTSTRAP_PASSWORD },
    });
    expect(signIn.statusCode).toBe(200);
  });
}

function registerBootstrapCredentialPolicyTests(): void {
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
    expect(parseConfiguredAuth(auth).options.emailAndPassword?.minPasswordLength).toBe(MIN_PASSWORD_LENGTH);
    const seeded = await bootstrapFixture();
    await createBootstrapAdmin(seeded.db, seeded.mode, seeded.auth, () => {});
    const populated = createAuthFromEnvironment(seeded.db, CLOSED_ENV);
    expect(parseConfiguredAuth(populated.auth).options.emailAndPassword?.minPasswordLength).toBe(MIN_PASSWORD_LENGTH);
    const plain = createAuthFromEnvironment(openDb(":memory:"), CLOSED_ENV);
    expect(parseConfiguredAuth(plain.auth).options.emailAndPassword?.minPasswordLength).toBe(MIN_PASSWORD_LENGTH);
  });

  it("REJECTS a 5-char sign-up password during a boot where the bootstrap just ran (the floor is never bent for anything else)", async () => {
    const { db, mode, auth } = await bootstrapFixture();
    await createBootstrapAdmin(db, mode, auth, () => {});
    // Same DB, open self-registration so the sign-up ROUTE (not the bootstrap's internalAdapter
    // path) is reachable — this is exactly the "operator's own reset" / "sign-up that boot" case
    // the finding called out: it must NOT inherit any lowered floor.
    const open = createAuthFromEnvironment(db, {
      ...CLOSED_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
    });
    const app = createApp(db, { authMode: open.mode, auth: open.auth });
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
    expect(parseErrorCode(res)).toBe("PASSWORD_TOO_SHORT");
  });
}

function registerBootstrapUnicodePolicyTests(): void {
  it("enforces sign-up bounds in Unicode code points rather than UTF-16 code units", async () => {
    const { db } = await bootstrapFixture();
    const open = createAuthFromEnvironment(db, {
      ...CLOSED_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1",
    });
    const app = createApp(db, { authMode: open.mode, auth: open.auth });
    const signUpWith = (email: string, password: string) =>
      call(app, {
        method: "POST",
        url: "/api/auth/sign-up/email",
        payload: { name: "Unicode User", email, password },
      });

    const tooShort = await signUpWith("astral-short@capacitylens.dev", "🔐".repeat(14));
    expect(tooShort.statusCode).toBe(400);
    expect(parseErrorCode(tooShort)).toBe("PASSWORD_TOO_SHORT");
    expect((await signUpWith("astral-min@capacitylens.dev", "🔐".repeat(15))).statusCode).toBe(200);
    expect((await signUpWith("astral-max@capacitylens.dev", "🔐".repeat(128))).statusCode).toBe(200);
    const tooLong = await signUpWith("astral-long@capacitylens.dev", "🔐".repeat(129));
    expect(tooLong.statusCode).toBe(400);
    expect(parseErrorCode(tooLong)).toBe("PASSWORD_TOO_LONG");
  });

  it("enforces the code-point policy on direct identity creation that bypasses HTTP routes", async () => {
    const { auth } = await bootstrapFixture();
    if (auth === null) throw new Error("Expected password authentication to be configured.");
    await expect(
      auth.createCredentialUser({
        email: "direct-short@capacitylens.dev",
        name: "Direct Short",
        password: "🔐".repeat(14),
      }),
    ).rejects.toThrow(`at least ${MIN_PASSWORD_LENGTH} characters`);
    const createdUser: unknown = await auth.createCredentialUser({
      email: "direct-max@capacitylens.dev",
      name: "Direct Max",
      password: "🔐".repeat(128),
    });
    expect(parseCreatedUserId(createdUser)).toBeTypeOf("string");
  });
}

function registerBootstrapLifecycleTests(): void {
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
    const sso = createAuthFromEnvironment(openDb(":memory:"), SSO_ENV);
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
}

describe("first-run owner bootstrap (createBootstrapAdmin)", () => {
  beforeEach(() => vi.stubEnv("CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD", BOOTSTRAP_PASSWORD));
  afterEach(() => vi.unstubAllEnvs());

  registerBootstrapCreationTests();
  registerBootstrapCredentialPolicyTests();
  registerBootstrapUnicodePolicyTests();
  registerBootstrapLifecycleTests();
});

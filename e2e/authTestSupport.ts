import { expect, request as playwrightRequest } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ports } from "../scripts/ports.mjs";

// Keep password-server fixture setup in one place so bootstrap credentials and request shapes remain consistent.

/** The auth-e2e API origin (the password-auth server the *.auth specs drive). */
// Lane-derived, exactly as playwright.config.ts derives the port it boots that server on: a literal
// here would point every auth spec at lane 0 while the server moved.
export const AUTH_API = `http://localhost:${ports().authApi}`;

/** The password every auth-e2e fixture signs up / signs in with. */
export const AUTH_PASSWORD = "demo-password-123456";

/**
 * Fixed first-run administrator credentials used only by the disposable auth server.
 * Their presence selects the ordinary sign-in screen rather than zero-user setup.
 * Keep these literals aligned with start:auth-e2e; importing auth.ts would load the auth runtime into Playwright.
 */
export const BOOTSTRAP_ADMIN = { email: "admin@admin.admin", password: "auth-e2e-password-2026" };

const AUTH_E2E_DATABASE = fileURLToPath(new URL("../apps/backend/.auth-e2e.db", import.meta.url));
// Keep the table order aligned with Object.values(tables).reverse() in state_repository.resetState.
const COMPANY_DATA_RESET_ORDER = [
  "closures",
  "time_off",
  "allocations",
  "activities",
  "resources",
  "phases",
  "projects",
  "disciplines",
  "clients",
  "accounts",
] as const;

/** Opens only the native auth E2E database after verifying its path and schema markers. */
function openAuthE2EDatabase(): DatabaseSync {
  if (!existsSync(AUTH_E2E_DATABASE))
    throw new Error("The disposable auth E2E database is unavailable; start the auth E2E server first.");

  const db = new DatabaseSync(AUTH_E2E_DATABASE);
  try {
    const main = db
      .prepare("PRAGMA database_list")
      .all()
      .find((database) => database.name === "main") as { file: string } | undefined;
    if (
      !main ||
      resolve(main.file) !== resolve(AUTH_E2E_DATABASE) ||
      realpathSync(AUTH_E2E_DATABASE) !== resolve(AUTH_E2E_DATABASE)
    )
      throw new Error("Auth E2E fixtures may only access apps/backend/.auth-e2e.db.");

    const tableNames = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    );
    if (
      [
        "users",
        "memberships",
        "adonis_sessions",
        "user_session_index",
        "audit_entries",
        "account_member_resources",
        ...COMPANY_DATA_RESET_ORDER,
      ].some((table) => !tableNames.has(table))
    )
      throw new Error("The database does not match the native auth E2E schema.");

    db.exec("PRAGMA busy_timeout = 5000");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Clears company data while preserving the auth E2E users and sessions. */
export function resetAuthE2ECompanyData(): void {
  const db = openAuthE2EDatabase();
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const foreignKeysEnabled = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    if (foreignKeysEnabled.foreign_keys !== 1)
      throw new Error("Auth E2E fixture cleanup requires SQLite foreign keys.");

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM audit_entries");
      for (const table of COMPANY_DATA_RESET_ORDER) db.exec(`DELETE FROM ${table}`);
      // This table deliberately has no foreign keys, so remove its company-scoped links explicitly.
      db.exec("DELETE FROM account_member_resources");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

function cookiesOf(setCookie: string): string {
  return setCookie
    .split("\n")
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function postSignUp(ctx: APIRequestContext, email: string, name = email.split("@")[0]): Promise<string> {
  const res = await ctx.post(`${AUTH_API}/api/auth/sign-up`, {
    data: { email, password: AUTH_PASSWORD, name },
  });
  expect(res.ok(), `sign-up ${email}`).toBeTruthy();
  return cookiesOf(res.headers()["set-cookie"] ?? "");
}

/**
 * Seed only disposable auth-e2e role/access fixtures. Real invitation tests use the addressed invite path.
 * The principal must already exist in the disposable auth database.
 * @throws When the principal is absent or database writes fail.
 */
export function seedFixtureMember(accountId: string, email: string, role: "admin" | "editor" | "viewer"): void {
  const db = openAuthE2EDatabase();
  try {
    const principal = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email.toLowerCase()) as
      { id: string } | undefined;
    if (!principal) throw new Error(`Missing E2E fixture identity for ${email}`);
    db.prepare(
      `INSERT INTO memberships (id, account_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    ).run(crypto.randomUUID(), accountId, principal.id, role, new Date().toISOString(), new Date().toISOString());
  } finally {
    db.close();
  }
}

/** Revokes a disposable E2E principal's real session authority without relying on browser cookie timing. */
export function revokeFixtureSessions(email: string): void {
  const db = openAuthE2EDatabase();
  try {
    const principal = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email.toLowerCase()) as
      { id: string } | undefined;
    if (!principal) throw new Error(`Missing E2E fixture identity for ${email}`);
    const removed = db.prepare("DELETE FROM user_session_index WHERE user_id = ?").run(principal.id);
    if (removed.changes === 0) throw new Error(`Missing E2E fixture session for ${email}`);
  } finally {
    db.close();
  }
}

/**
 * Sign up one user in an isolated request context and return its email and auto-signed-in session
 * cookie in one HTTP request. Use this when the test needs the cookie for API calls or browser
 * sign-in. When the test needs the user ID (for a PATCH/DELETE .../members/<userId> or a
 * toUserId transfer), use signUpUserWithId; it makes a second request to GET /api/auth/me.
 *
 * Each user gets a separate context because an APIRequestContext keeps a cookie jar. Product
 * sign-up creates a session in the same request, and its Set-Cookie header belongs only to this
 * fixture. This matches the server unit fixtures, which do not need a separate sign-in or email
 * step. Callers add a unique suffix to each email so a reused server
 * does not encounter duplicates.
 */
export async function signUpUser(email: string, name?: string): Promise<{ email: string; cookie: string }> {
  const ctx = await playwrightRequest.newContext();
  try {
    const cookie = await postSignUp(ctx, email, name);
    return { email, cookie };
  } finally {
    await ctx.dispose();
  }
}

/** Resets disposable company data, then creates the first company through its ordinary route. */
export async function bootstrapOrg(request: APIRequestContext, cookie: string, name: string): Promise<string> {
  resetAuthE2ECompanyData();
  const res = await request.post(`${AUTH_API}/api/orgs`, {
    headers: { cookie },
    data: { name },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}

/**
 * Sign up one user and also resolve its user ID (a second request, `GET /api/auth/me`, on top of
 * the sign-up). Use this only when a test needs the ID. Other tests should use the cheaper
 * `signUpUser` helper above. See its TSDoc for the isolated-context rationale.
 */
export async function signUpUserWithId(
  email: string,
  name?: string,
): Promise<{ email: string; cookie: string; userId: string }> {
  const ctx = await playwrightRequest.newContext();
  try {
    const cookie = await postSignUp(ctx, email, name);
    const me = await ctx.get(`${AUTH_API}/api/auth/me`, { headers: { cookie } });
    const userId = (await me.json()).user.id as string;
    return { email, cookie, userId };
  } finally {
    await ctx.dispose();
  }
}

/** Seed the durable address proof produced by Google in the disposable native auth database.
 * The browser test still performs real password sign-in and membership admission. */
export function seedFixtureGoogleEmailProof(email: string): void {
  const db = openAuthE2EDatabase();
  try {
    const normalized = email.toLowerCase();
    const principal = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(normalized) as
      { id: string } | undefined;
    if (!principal) throw new Error(`Missing E2E fixture identity for ${email}`);
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO email_proofs (id, user_id, email, verified_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(crypto.randomUUID(), principal.id, normalized, now, now, now);
      db.prepare("UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?").run(now, principal.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

/** Mark only the legacy email flag in the disposable native auth database. A joining test uses this
 * to prove that the flag alone is not the durable address evidence required for policy admission. */
export function seedFixtureLegacyEmailFlag(email: string): void {
  const db = openAuthE2EDatabase();
  try {
    const updated = db
      .prepare("UPDATE users SET email_verified = 1, updated_at = ? WHERE lower(email) = ?")
      .run(new Date().toISOString(), email.toLowerCase());
    if (updated.changes !== 1) throw new Error(`Missing E2E fixture identity for ${email}`);
  } finally {
    db.close();
  }
}

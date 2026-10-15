import { expect, request as playwrightRequest } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
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

/** The operator bootstrap token (set in server's start:auth-e2e script). A fresh sign-up is not a
 * first-run bootstrap and holds no membership; this is the documented operator path to provision
 * an org (`POST /api/orgs`) on an already-populated instance. */
export const BOOTSTRAP_TOKEN = "auth-e2e-bootstrap-token-0123456789abcdef";

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
  const path = fileURLToPath(new URL("../apps/backend/.auth-e2e.db", import.meta.url));
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
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

/** Provisions a disposable company through operator bootstrap, makes the principal identified by cookie its Owner, and returns its account ID. */
export async function bootstrapOrg(request: APIRequestContext, cookie: string, name: string): Promise<string> {
  const res = await request.post(`${AUTH_API}/api/orgs`, {
    headers: { cookie, "x-capacitylens-bootstrap-token": BOOTSTRAP_TOKEN },
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

/** Seed a pre-existing trusted address only in the disposable auth-e2e database. This prepares
 * the policy-joining prerequisite; the browser test still performs real sign-in and membership
 * admission. It does not test provider or mailbox proof issuance. */
export function seedFixtureEmailProof(email: string): void {
  const path = fileURLToPath(new URL("../server/.auth-e2e.db", import.meta.url));
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const principal = db.prepare("SELECT id FROM user WHERE lower(email) = ?").get(email.toLowerCase()) as
      { id: string } | undefined;
    if (!principal) throw new Error(`Missing E2E fixture identity for ${email}`);
    db.prepare(
      "INSERT INTO identity_email_proofs (principalId, email, source, provenAt) VALUES (?, ?, 'google', ?)",
    ).run(principal.id, email.toLowerCase(), new Date().toISOString());
  } finally {
    db.close();
  }
}

/** Mark only the legacy auth-vendor flag in the disposable E2E database. A joining test uses this
 * to prove that the flag alone is not the durable address evidence required for policy admission. */
export function seedFixtureLegacyEmailFlag(email: string): void {
  const path = fileURLToPath(new URL("../server/.auth-e2e.db", import.meta.url));
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const updated = db.prepare("UPDATE user SET emailVerified = 1 WHERE lower(email) = ?").run(email.toLowerCase());
    if (updated.changes !== 1) throw new Error(`Missing E2E fixture identity for ${email}`);
  } finally {
    db.close();
  }
}

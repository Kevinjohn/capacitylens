import { vi } from "vitest";
import { createAuthFromEnvironment, runAuthMigrations } from "../auth";
import type { Auth } from "../auth";
import { insertRow, openDb } from "../db";

/**
 * Collects sent mail so provider proof tests can inspect delivery without an external mail
 * service.
 */
const sentMessages = vi.hoisted(() => [] as Array<{ to: string; text: string }>);
/**
 * Lets provider proof tests force a delivery failure without changing production behavior.
 */
const mailFailure = vi.hoisted(() => ({ enabled: false }));
export { sentMessages, mailFailure };
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: { to: string; text: string }) => {
        if (mailFailure.enabled) {
          throw Object.assign(new Error(`SMTP unavailable: private credential and message ${message.text}`), {
            code: "EAUTH",
            responseCode: 535,
          });
        }
        sentMessages.push(message);
      },
    }),
  },
}));

/**
 * Pins the Microsoft tenant used by provider proof tests so identity claims stay deterministic.
 */
export const tenant = "01234567-89ab-cdef-0123-456789abcdef";
/**
 * Provides the local origin used by browser proof tests without contacting a real provider.
 */
export const origin = "http://localhost:8787";
/**
 * Provides controlled auth configurations for provider proof tests.
 */
export const environments = {
  CAPACITYLENS_MODE: "sso-only",
  CAPACITYLENS_SECRET: "unit-test-secret-0123456789abcdef-0123",
  CAPACITYLENS_PUBLIC_URL: origin,
  CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS: "bruce@example.com",
  CAPACITYLENS_MICROSOFT_CLIENT_ID: "microsoft-client",
  CAPACITYLENS_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  CAPACITYLENS_MICROSOFT_TENANT_ID: tenant,
  CAPACITYLENS_MAIL_HOST: "mail.example.test",
  CAPACITYLENS_MAIL_PORT: "587",
  CAPACITYLENS_MAIL_USER: "mailer",
  CAPACITYLENS_MAIL_PASSWORD: "mail-secret",
  CAPACITYLENS_MAIL_FROM: "identity@example.com",
};

function jwt(claims: Record<string, unknown>): string {
  return `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
}

/**
 * Builds the Cookie header from Set-Cookie values so callback tests preserve browser state.
 */
export function cookieHeader(setCookies: readonly string[]): string {
  return setCookies.map((line) => line.split(";", 1)[0]).join("; ");
}

/**
 * Reads callback state from a URL so tests exercise the browser state check.
 */
export function requiredState(url: string): string {
  const state = new URL(url).searchParams.get("state");
  if (!state) throw new Error("Expected a native OAuth state.");
  return state;
}

/**
 * Replaces matching cookie values so tests can follow a browser callback across responses.
 */
export function replaceCookies(existing: string, replacement: readonly string[]): string {
  const cookies = new Map<string, string>();
  for (const pair of existing.split("; ")) {
    const name = pair.split("=", 1)[0];
    if (name) cookies.set(name, pair);
  }
  for (const pair of cookieHeader(replacement).split("; ")) {
    const name = pair.split("=", 1)[0];
    if (name) cookies.set(name, pair);
  }
  return [...cookies.values()].join("; ");
}

/**
 * Supplies deterministic Microsoft token claims without making a network request.
 */
export function mockMicrosoftToken(claims: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string | URL) => {
      const url = String(target);
      if (url === `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`) {
        return Response.json({
          access_token: "controlled-access",
          id_token: jwt(claims),
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (new URL(url).origin === "https://graph.microsoft.com") return new Response(null, { status: 404 });
      throw new Error(`Unexpected outbound request: ${url}`);
    }),
  );
}

/**
 * Builds an auth instance with a controlled Microsoft proof configuration for tests.
 */
export async function configured(mode: "sso-only" | "password-and-sso" = "sso-only") {
  const db = openDb(":memory:");
  const { auth } = createAuthFromEnvironment(
    db,
    { ...environments, CAPACITYLENS_MODE: mode },
    {
      externalIdentityAdmission: ({ email, emailVerified, providerId }) =>
        providerId === "microsoft" && emailVerified === true && email === "bruce@example.com",
    },
  );
  if (!auth?.microsoftProof) throw new Error("Microsoft proof was not configured.");
  await runAuthMigrations(auth);
  return { db, auth: auth as Auth & { microsoftProof: NonNullable<Auth["microsoftProof"]> } };
}

/**
 * Builds a Microsoft profile with the requested verified-email state for tests.
 */
export function claims(email?: string) {
  return {
    iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
    aud: "microsoft-client",
    exp: Math.floor(Date.now() / 1000) + 600,
    tid: tenant,
    oid: "stable-object-id",
    sub: "other-subject",
    name: "Bruce Wayne",
    ...(email ? { email, email_verified: true } : {}),
  };
}

/**
 * Starts a Microsoft proof flow through the auth instance used by the test.
 */
export async function begin(auth: Auth & { microsoftProof: NonNullable<Auth["microsoftProof"]> }) {
  const result = await auth.microsoftProof.start({
    body: {
      purpose: "bootstrap",
      email: "bruce@example.com",
      callbackURL: `${origin}/`,
      errorCallbackURL: `${origin}/`,
    },
    headers: new Headers(),
    sourceIp: "127.0.0.1",
  });
  const state = new URL(result.url).searchParams.get("state");
  if (!state) throw new Error("Native Microsoft authorization did not return OAuth state.");
  return { state, cookies: cookieHeader(result.setCookies) };
}

/**
 * Completes the Microsoft proof callback with the state and cookies held by the test browser.
 */
export async function callback(auth: Auth, state: string, cookies: string) {
  return auth.handler(
    new Request(`${origin}/api/auth/callback/microsoft?code=controlled-code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: cookies },
    }),
  );
}

/**
 * Creates a verified federated account fixture so callback tests start from a proven identity.
 */
export function insertProofAccount(db: ReturnType<typeof openDb>, accountId: "a-studio" | "a-loft"): void {
  insertRow(db, "accounts", {
    id: accountId,
    name: accountId === "a-studio" ? "Wayne Enterprises" : "Stark Industries",
    color: "#6366f1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

import { vi } from "vitest";
import { createAuthFromEnvironment, runAuthMigrations, type Auth } from "../auth";
import { openDb } from "../db";

const sentMessages = vi.hoisted(() => [] as Array<{ to: string; text: string }>);
const mailFailure = vi.hoisted(() => ({ enabled: false }));
export { sentMessages, mailFailure };
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: { to: string; text: string }) => {
        if (mailFailure.enabled) throw new Error("SMTP unavailable");
        sentMessages.push(message);
      },
    }),
  },
}));

export const tenant = "01234567-89ab-cdef-0123-456789abcdef";
export const origin = "http://localhost:8787";
export const environments = {
  SMALLSASS_ACCOUNT_MODE: "sso",
  SMALLSASS_ACCOUNT_SECRET: "unit-test-secret-0123456789abcdef-0123",
  SMALLSASS_ACCOUNT_PUBLIC_URL: origin,
  SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS: "bruce@example.com",
  SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID: "microsoft-client",
  SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID: tenant,
  SMALLSASS_ACCOUNT_MAIL_HOST: "mail.example.test",
  SMALLSASS_ACCOUNT_MAIL_PORT: "587",
  SMALLSASS_ACCOUNT_MAIL_USER: "mailer",
  SMALLSASS_ACCOUNT_MAIL_PASSWORD: "mail-secret",
  SMALLSASS_ACCOUNT_MAIL_FROM: "identity@example.com",
};

function jwt(claims: Record<string, unknown>): string {
  return `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
}

export function cookieHeader(setCookies: readonly string[]): string {
  return setCookies.map((line) => line.split(";", 1)[0]).join("; ");
}

export function requiredState(url: string): string {
  const state = new URL(url).searchParams.get("state");
  if (!state) throw new Error("Expected a native OAuth state.");
  return state;
}

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
      if (url.includes("graph.microsoft.com")) return new Response(null, { status: 404 });
      throw new Error(`Unexpected outbound request: ${url}`);
    }),
  );
}

export async function configured(mode: "sso" | "password" = "sso") {
  const db = openDb(":memory:");
  const { auth } = createAuthFromEnvironment(
    db,
    { ...environments, SMALLSASS_ACCOUNT_MODE: mode },
    {
      externalIdentityAdmission: ({ email, emailVerified, providerId }) =>
        providerId === "microsoft" && emailVerified === true && email === "bruce@example.com",
    },
  );
  if (!auth?.microsoftProof) throw new Error("Microsoft proof was not configured.");
  await runAuthMigrations(auth);
  return { db, auth: auth as Auth & { microsoftProof: NonNullable<Auth["microsoftProof"]> } };
}

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

export async function callback(auth: Auth, state: string, cookies: string) {
  return auth.handler(
    new Request(`${origin}/api/auth/callback/microsoft?code=controlled-code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: cookies },
    }),
  );
}

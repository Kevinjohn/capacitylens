import type { BetterAuthOptions } from "better-auth";
import type { Db } from "../db";

/** Request header carrying the client address the server resolved (`resolveRequestClientIp`). The
 * root request hook overwrites any client-supplied value, so it is the only address Better Auth
 * trusts for rate limiting and session records. */
export const AUTH_CLIENT_IP_HEADER = "x-capacitylens-client-ip";

export function buildSessionPolicy({
  db,
  secret,
  baseURL,
  cookiePrefix,
  secureCookies,
  sessionAbsoluteTtlSeconds,
  sessionFreshAgeSeconds,
}: {
  db: Db;
  secret: string;
  baseURL: string;
  cookiePrefix: string;
  secureCookies: boolean;
  sessionAbsoluteTtlSeconds: number;
  sessionFreshAgeSeconds: number;
}): Pick<
  BetterAuthOptions,
  "database" | "secret" | "baseURL" | "basePath" | "verification" | "account" | "advanced" | "session" | "telemetry"
> {
  return {
    database: db, // node:sqlite DatabaseSync, same file as the app data (see header)
    secret,
    baseURL,
    basePath: "/api/auth",
    // Better Auth defaults verification identifiers to plaintext. Reset identifiers contain the
    // live bearer token (`reset-password:<token>`), so a DB/backup reader could otherwise take over
    // the account. The library hashes on both create and consume, preserving the normal API while
    // ensuring no live reset/email-verification token is recoverable from storage.
    verification: { storeIdentifier: "hashed" },
    // Email is an attribute, never an account-link key. Linking requires a separate authenticated
    // ceremony outside an OIDC callback, so a newly observed issuer/subject cannot attach itself to
    // an existing local principal merely by presenting the same verified email address.
    //
    // Provider access/refresh/id tokens are encrypted with the application secret before they reach
    // SQLite, so a stolen database or backup copy alone does not surrender live provider credentials,
    // defence in depth between database-copy theft and application-secret theft.
    account: { accountLinking: { disableImplicitLinking: true }, encryptOAuthTokens: true },
    // Session-cookie hardening follows the public Better Auth URL, not the Node listener: an HTTPS
    // browser origin still needs Secure cookies when nginx proxies to Node over HTTP. Better Auth's
    // built-in secure-cookie switch emits the weaker `__Secure-` name prefix. Disable that naming
    // helper and express Secure directly so every HTTPS cookie can use the stricter `__Host-`
    // prefix (Secure + Path=/ + no Domain). Loopback HTTP keeps an unprefixed development name.
    // `sameSite:'lax'` (not 'strict') is required for SSO: 'strict' would
    // drop the session cookie on the top-level OAuth redirect back from the IdP → broken sign-in;
    // 'lax' still sends the cookie on that GET callback and is safe. `httpOnly:true` keeps the token
    // out of document.cookie (no JS read).
    // Better Auth would otherwise read a raw `X-Forwarded-For`: a client could spoof it past the
    // credential rate limits, and without it every client would share one bucket per path.
    advanced: {
      // Better Auth checks the schema as soon as it is constructed, which on a fresh database is
      // before runAuthMigrations creates its tables: it logged a false "schema mismatch" error
      // advising `npx auth migrate`, which would bypass the app's ledger and snapshot.
      // runAuthMigrations verifies the same schema after migrating and refuses to start instead.
      database: { validateSchema: false },
      ipAddress: { ipAddressHeaders: [AUTH_CLIENT_IP_HEADER] },
      useSecureCookies: false,
      cookiePrefix,
      defaultCookieAttributes: {
        sameSite: "lax",
        httpOnly: true,
        ...(secureCookies ? { secure: true } : {}),
      },
    },
    // Fixed 12-hour absolute lifetime: refresh is disabled, so activity can never extend a stolen
    // session indefinitely. The wrapper below separately enforces a 30-minute inactivity timeout
    // without moving expiresAt. `freshAge` supplies a 15-minute step-up window for sensitive actions.
    session: {
      expiresIn: sessionAbsoluteTtlSeconds,
      disableSessionRefresh: true,
      freshAge: sessionFreshAgeSeconds,
    },
    telemetry: { enabled: false },
  };
}

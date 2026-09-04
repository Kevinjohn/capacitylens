import type { BetterAuthOptions } from "better-auth";
import type { Db } from "../db";

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
    database: db, // node:sqlite DatabaseSync — same file as the app data (see header)
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
    // SQLite, so a stolen database or backup copy alone does not surrender live provider credentials
    // — defence in depth between database-copy theft and application-secret theft.
    account: { accountLinking: { disableImplicitLinking: true }, encryptOAuthTokens: true },
    // Session-cookie hardening follows the PUBLIC Better Auth URL, not the Node listener: an HTTPS
    // browser origin still needs Secure cookies when nginx proxies to Node over HTTP. Better Auth's
    // built-in secure-cookie switch emits the weaker `__Secure-` name prefix. Disable that naming
    // helper and express Secure directly so every HTTPS cookie can use the stricter `__Host-`
    // prefix (Secure + Path=/ + no Domain). Loopback HTTP keeps an unprefixed development name.
    // `sameSite:'lax'` (NOT 'strict') is required for SSO: 'strict' would
    // drop the session cookie on the top-level OAuth redirect back from the IdP → broken sign-in;
    // 'lax' still sends the cookie on that GET callback and is safe. `httpOnly:true` keeps the token
    // out of document.cookie (no JS read).
    advanced: {
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

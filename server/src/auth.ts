import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'
import type { SocialProviders } from 'better-auth/social-providers'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { getMigrations } from 'better-auth/db/migration'
import type { Db } from './db'

// Better Auth integration (production plan P3.1). Decision (Phase 0 #7): a third-party
// OSS library owns the session/credential/OIDC machinery — accepted precisely so we
// don't own crypto/session code. THE OFF GUARANTEE: with CAPACITYLENS_AUTH unset or 'off',
// nothing in this module runs — Better Auth is never initialised, no BETTER_AUTH_* env
// is read, no auth tables are created, zero new attack surface (authFromEnv returns
// { mode: 'off', auth: null } before touching anything else).
//
// Storage (P3.1 spike, verified 2026-06-12 on Node 24 / better-auth 1.6.18): Better
// Auth's own tables — user, session, account, verification — live in the SAME SQLite
// file, created by runAuthMigrations from the node:sqlite DatabaseSync handle directly
// (no extra driver; better-sqlite3 stays the pre-approved fallback if that regresses).
// These tables are NOT AppData entities: the entity drift-proofing lists (KNOWN_KEYS /
// tables.ts / sanitize) deliberately do not cover them, and db.ts wipe()/loadState()
// never touch them.

export type AuthMode = 'off' | 'password' | 'sso'

/** The narrow Better Auth surface the server actually uses. betterAuth()'s concrete
 *  return type is invariant in its options generic (a plugin-parametrised instantiation
 *  won't assign to Auth<BetterAuthOptions>), so authFromEnv collapses it to this
 *  structural interface once at creation — everything downstream stays decoupled from
 *  the library's generics. */
export interface Auth {
  /** Web-standard Request → Response handler, mounted at /api/auth/* when mode ≠ off. */
  handler: (request: Request) => Promise<Response>
  api: {
    getSession: (input: { headers: Headers }) => Promise<{ user: SessionUser } | null>
  }
  /** Resolved options — what getMigrations needs to create the auth tables. */
  options: BetterAuthOptions
}

/** The identity attached to every request in 'off' mode — the seam Stage C will later
 *  replace with the session user to derive accountId server-side. Off is trusted-local, so
 *  the synthetic principal is treated as verified (`emailVerified: true`) and given a clearly
 *  non-routable `.local` demo email so nothing mistakes it for a real verified identity. */
export const DEMO_USER: SessionUser = {
  id: 'demo',
  name: 'Demo',
  email: 'demo@capacitylens.local',
  emailVerified: true,
}

/**
 * The normalized session principal the whole server depends on (membership lookups,
 * `/api/auth/me`, P1.10 invite binding) — decoupled from Better Auth's richer user type.
 *
 * `emailVerified` is the IdP-asserted verified-email flag. It defaults to `false` when a
 * provider omits it (see {@link normalizeSessionUser}): an unverifiable provider is treated as
 * unverified. The email-preauth invites in P1.10 bind a session to a pending invite ONLY when
 * `emailVerified === true`, so this flag is load-bearing for that gate — never widen it to
 * "truthy" or default it to `true`.
 */
export interface SessionUser {
  id: string
  email: string
  emailVerified: boolean
  name: string
}

/** The subset of Better Auth's user we read before narrowing to {@link SessionUser}. Better
 *  Auth types `emailVerified` as a boolean it sets per provider; the optional/`null` here is
 *  the safety net for a provider/version that leaves it unset. */
interface RawSessionUser {
  id: string
  email: string
  name: string
  emailVerified?: boolean | null
}

/**
 * Narrow Better Auth's full user to the {@link SessionUser} the server uses, reading
 * `emailVerified` from the raw user and defaulting it to `false`.
 *
 * Better Auth sets `emailVerified` per provider during sign-in (Google/Microsoft OIDC derive
 * it from the `email_verified` claim; GitHub and email+password sign-up leave it `false` until
 * verified). We deliberately do NOT branch on a provider allow-list — we trust Better Auth's
 * per-provider value and use `?? false` as the safety net for any provider that omits it, so an
 * unverifiable provider can never present as verified.
 */
export function normalizeSessionUser(raw: RawSessionUser): SessionUser {
  return {
    id: raw.id,
    email: raw.email,
    emailVerified: raw.emailVerified ?? false,
    name: raw.name,
  }
}

/** Misconfiguration that must refuse boot loudly (same posture as assertSchemaCurrent) —
 *  the entrypoint catches this, prints the message, and exits 1. */
export class AuthConfigError extends Error {}

export function parseAuthMode(raw: string | undefined): AuthMode {
  const mode = raw === undefined || raw === '' ? 'off' : raw
  if (mode === 'off' || mode === 'password' || mode === 'sso') return mode
  throw new AuthConfigError(
    `CAPACITYLENS_AUTH must be 'off', 'password' or 'sso' — got '${raw}'. Unset it for today's no-auth behaviour.`,
  )
}

type Env = Record<string, string | undefined>

/** Better Auth signs sessions/cookies with BETTER_AUTH_SECRET — a short secret is
 *  brute-forceable, so refuse anything weaker than this. (Better Auth's own guidance and
 *  generators emit 32+ char secrets.) */
export const MIN_BETTER_AUTH_SECRET_LENGTH = 32

function required(env: Env, key: string, context: string): string {
  const value = env[key]
  if (!value) throw new AuthConfigError(`${key} is required when ${context}.`)
  return value
}

/** Native social sign-in providers, assembled purely from env (P1.7). Each of Google /
 *  Microsoft / GitHub is ADDITIVE and FAIL-CLOSED-ABSENT: a provider is only configured
 *  when BOTH its client id and secret are present, so an unset provider is simply not
 *  offered (no half-configured provider, no boot refusal). These are independent of the
 *  'sso' genericOAuth plugin — they coexist with it in auth-on modes. Social sign-in is the
 *  primary path (email+password is the secondary fallback); NEW-USER invite-gating of a
 *  social sign-in is DEFERRED to P1.9/P1.10 (no invite mechanism exists yet), so today a
 *  configured provider can create a user — the secure default holds because out of the box
 *  no provider env is set AND email self-registration is closed (see authFromEnv). */
function socialProvidersFromEnv(env: Env): SocialProviders {
  const providers: SocialProviders = {}
  const { CAPACITYLENS_GOOGLE_CLIENT_ID: gId, CAPACITYLENS_GOOGLE_CLIENT_SECRET: gSecret } = env
  if (gId && gSecret) providers.google = { clientId: gId, clientSecret: gSecret }
  const { CAPACITYLENS_MICROSOFT_CLIENT_ID: msId, CAPACITYLENS_MICROSOFT_CLIENT_SECRET: msSecret } = env
  if (msId && msSecret) {
    // tenantId defaults to 'common' (multi-tenant) when not pinned to a single Entra tenant.
    providers.microsoft = {
      clientId: msId,
      clientSecret: msSecret,
      tenantId: env.CAPACITYLENS_MICROSOFT_TENANT_ID || 'common',
    }
  }
  const { CAPACITYLENS_GITHUB_CLIENT_ID: ghId, CAPACITYLENS_GITHUB_CLIENT_SECRET: ghSecret } = env
  if (ghId && ghSecret) providers.github = { clientId: ghId, clientSecret: ghSecret }
  return providers
}

/** Build the Better Auth instance for the parsed mode — or null in 'off' mode, where no
 *  env beyond CAPACITYLENS_AUTH itself is read. `trustedOrigins` should be the same browser
 *  origins the CORS allow-list names (Better Auth checks Origin on state-changing calls);
 *  the same-origin production deploy needs none.
 *
 *  `https` is THREADED from the caller (index.ts derives it from CAPACITYLENS_HTTPS — auth.ts
 *  deliberately does NOT read that env itself, mirroring how the HSTS flag is threaded into
 *  buildApp). It is the single knob that ties the session cookie's `Secure` attribute to a real
 *  HTTPS origin (see the betterAuth call below). */
export function authFromEnv(
  db: Db,
  env: Env,
  opts: { trustedOrigins?: string[]; https?: boolean } = {},
): { mode: AuthMode; auth: Auth | null } {
  const mode = parseAuthMode(env.CAPACITYLENS_AUTH)
  if (mode === 'off') return { mode, auth: null }

  const secret = required(env, 'BETTER_AUTH_SECRET', `CAPACITYLENS_AUTH=${mode}`)
  // Fail closed + loud on a weak secret (message states the requirement + actual length,
  // never the secret value itself — no leak into logs/exit output).
  if (secret.length < MIN_BETTER_AUTH_SECRET_LENGTH) {
    throw new AuthConfigError(
      `BETTER_AUTH_SECRET must be at least ${MIN_BETTER_AUTH_SECRET_LENGTH} characters when CAPACITYLENS_AUTH=${mode} (got ${secret.length}).`,
    )
  }
  const baseURL = required(env, 'BETTER_AUTH_URL', `CAPACITYLENS_AUTH=${mode}`)

  // Provider choice stays deferred (Phase 0 #7): 'sso' wires the generic OAuth2/OIDC
  // plugin entirely from env, so picking Google/Microsoft/an IdP later is config, not code.
  const plugins =
    mode === 'sso'
      ? [
          genericOAuth({
            config: [
              {
                providerId: env.CAPACITYLENS_SSO_PROVIDER_ID || 'sso',
                clientId: required(env, 'CAPACITYLENS_SSO_CLIENT_ID', 'CAPACITYLENS_AUTH=sso'),
                clientSecret: required(env, 'CAPACITYLENS_SSO_CLIENT_SECRET', 'CAPACITYLENS_AUTH=sso'),
                // Either a discovery URL (OIDC) or explicit endpoints.
                discoveryUrl: env.CAPACITYLENS_SSO_DISCOVERY_URL,
                authorizationUrl: env.CAPACITYLENS_SSO_AUTHORIZATION_URL,
                tokenUrl: env.CAPACITYLENS_SSO_TOKEN_URL,
                scopes: (env.CAPACITYLENS_SSO_SCOPES ?? 'openid profile email').split(' ').filter(Boolean),
              },
            ],
          }),
        ]
      : []
  if (mode === 'sso' && !env.CAPACITYLENS_SSO_DISCOVERY_URL && !(env.CAPACITYLENS_SSO_AUTHORIZATION_URL && env.CAPACITYLENS_SSO_TOKEN_URL)) {
    throw new AuthConfigError(
      'CAPACITYLENS_AUTH=sso needs CAPACITYLENS_SSO_DISCOVERY_URL, or CAPACITYLENS_SSO_AUTHORIZATION_URL + CAPACITYLENS_SSO_TOKEN_URL.',
    )
  }

  // SECURE DEFAULT (P1.7): self-service signup is closed / invite-only by design (Decisions —
  // social SSO is the primary path; email+password a secondary fallback). disableSignUp is
  // therefore ON unless CAPACITYLENS_ALLOW_OPEN_SIGNUP === '1'. That flag is an INTERIM
  // trusted-instance/dev escape that re-opens open email self-registration until the invite
  // flow (P1.9/P1.10) provides the proper gated path; OFF by default = open registration
  // impossible (POST /api/auth/sign-up/email returns 400 EMAIL_PASSWORD_SIGN_UP_DISABLED).
  const allowOpenSignup = env.CAPACITYLENS_ALLOW_OPEN_SIGNUP === '1'

  const instance = betterAuth({
    database: db, // node:sqlite DatabaseSync — same file as the app data (see header)
    secret,
    baseURL,
    basePath: '/api/auth',
    emailAndPassword: { enabled: mode === 'password', disableSignUp: !allowOpenSignup },
    // Native Google/Microsoft/GitHub sign-in, each only when its env is set (see helper).
    // Independent of the 'sso' genericOAuth plugin above; an empty object = none configured.
    socialProviders: socialProvidersFromEnv(env),
    plugins,
    trustedOrigins: opts.trustedOrigins,
    // Session-cookie hardening (P1.16), pinned so a Better Auth default change can't silently
    // alter our cookies. `Secure` is TIED to a real HTTPS origin via the threaded `https` flag
    // (mirrors the HSTS↔CAPACITYLENS_HTTPS coupling): it MUST be false over plain HTTP, because a
    // browser drops a Secure cookie sent over HTTP → the session token never persists → an endless
    // login loop. The default deploy runs HTTP behind a TLS-terminating proxy, so this is the #1
    // footgun to keep coupled. `sameSite:'lax'` (NOT 'strict') is required for SSO: 'strict' would
    // drop the session cookie on the top-level OAuth redirect back from the IdP → broken sign-in;
    // 'lax' still sends the cookie on that GET callback and is safe. `httpOnly:true` keeps the token
    // out of document.cookie (no JS read).
    advanced: {
      useSecureCookies: opts.https ?? false,
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
    },
    // Session lifetime pinned to Better Auth's own defaults (7-day absolute expiry, refreshed once a
    // day as the user stays active) so a future library default change can't silently re-tune how
    // long a session lives. expiresIn/updateAge are in SECONDS.
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    telemetry: { enabled: false },
  })
  // Collapse the invariant generic to the structural Auth surface (see Auth), AND normalize at
  // this single narrowing boundary (P1.7a): Better Auth's full user carries the richer fields we
  // drop here, so this is exactly where `emailVerified` is read and defaulted before everything
  // downstream sees only the {id,email,emailVerified,name} SessionUser.
  const raw = instance as unknown as {
    handler: Auth['handler']
    api: { getSession: (input: { headers: Headers }) => Promise<{ user: RawSessionUser } | null> }
    options: BetterAuthOptions
  }
  const auth: Auth = {
    handler: raw.handler,
    options: raw.options,
    api: {
      async getSession(input) {
        const session = await raw.api.getSession(input)
        return session ? { user: normalizeSessionUser(session.user) } : null
      },
    },
  }
  return { mode, auth }
}

/** Create/upgrade Better Auth's tables in the shared SQLite file. Called at boot ONLY
 *  when mode ≠ off — an off-mode DB never grows auth tables (the OFF guarantee). */
export async function runAuthMigrations(auth: Auth): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
}

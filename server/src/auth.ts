import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'
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
 *  replace with the session user to derive accountId server-side. */
export const DEMO_USER = { id: 'demo', name: 'Demo' }

export interface SessionUser {
  id: string
  name: string
  email?: string
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

/** Build the Better Auth instance for the parsed mode — or null in 'off' mode, where no
 *  env beyond CAPACITYLENS_AUTH itself is read. `trustedOrigins` should be the same browser
 *  origins the CORS allow-list names (Better Auth checks Origin on state-changing calls);
 *  the same-origin production deploy needs none. */
export function authFromEnv(
  db: Db,
  env: Env,
  opts: { trustedOrigins?: string[] } = {},
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

  const auth = betterAuth({
    database: db, // node:sqlite DatabaseSync — same file as the app data (see header)
    secret,
    baseURL,
    basePath: '/api/auth',
    emailAndPassword: { enabled: mode === 'password' },
    plugins,
    trustedOrigins: opts.trustedOrigins,
    telemetry: { enabled: false },
  }) as unknown as Auth // collapse the invariant generic to the structural surface (see Auth)
  return { mode, auth }
}

/** Create/upgrade Better Auth's tables in the shared SQLite file. Called at boot ONLY
 *  when mode ≠ off — an off-mode DB never grows auth tables (the OFF guarantee). */
export async function runAuthMigrations(auth: Auth): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
}

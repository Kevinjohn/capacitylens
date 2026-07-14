import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import type { BetterAuthOptions } from 'better-auth'
import type { SocialProviders } from 'better-auth/social-providers'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { getMigrations } from 'better-auth/db/migration'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@capacitylens/shared/domain/password'
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

/** Public, non-secret provider metadata exposed by `/api/auth/me` so the login screen never
 * hardcodes a provider id or advertises a provider the server did not configure. Every external
 * provider remains explicitly experimental until CapacityLens has exercised its callback flow in
 * production. */
export interface AuthProviderInfo {
  id: string
  label: string
  kind: 'social' | 'oidc'
  experimental: true
}

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
    /** Better Auth's server-side reset-token mint (P1.18) — call it ONLY through
     *  {@link mintPasswordResetToken}, which provides the AsyncLocalStorage capture context the
     *  sendResetPassword callback delivers the token into. Anti-enumeration by design: it resolves
     *  with a generic success whether or not the email matched a user. */
    requestPasswordReset: (input: { body: { email: string } }) => Promise<unknown>
  }
  /** Resolved options — what getMigrations needs to create the auth tables. */
  options: BetterAuthOptions
  /** Configured external identity providers, safe to return to unauthenticated clients. */
  providers: AuthProviderInfo[]
  /** Create a user + credential account as ONE atomic-by-convention operation, bypassing the
   *  public sign-up ROUTE entirely (and with it, the route's minPasswordLength check —
   *  internalAdapter.createUser never validates password shape, only the sign-up.mjs handler
   *  does). This is why the instance-wide minPasswordLength floor no longer needs to be bent for
   *  the bootstrap boot (see the comment on minPasswordLength below authFromEnv).
   *
   *  Deliberately the ONLY way to reach Better Auth's internalAdapter from outside this module —
   *  earlier this exposed hashPassword/createUser/linkAccount as three independently callable
   *  methods, an interface shape that invited a future caller to create a user with no credential
   *  (an orphaned row that permanently locks out the bootstrap: {@link countUsers} > 0 forever,
   *  with no sign-in-able account). This method owns hash → createUser → linkAccount sequencing
   *  and the failure handling (best-effort rollback of the user row if linkAccount fails), so that
   *  hazard can't recur. Resolves once Better Auth's async init context ($context) is ready;
   *  nothing else should call it — every other caller goes through the narrow api surface above.
   *
   *  @throws when linkAccount fails after createUser succeeds — the thrown Error carries
   *  `{ cause }` (the original failure) and states that a rollback was attempted, per
   *  DEFENSIVE-CODING §1.
   */
  createCredentialUser: (
    email: string,
    name: string,
    password: string,
    emailVerified?: boolean,
  ) => Promise<{ id: string }>
  /** Remove a just-created credential identity when a later invite claim cannot commit. */
  deleteCredentialUser: (userId: string) => Promise<void>
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
 * unverified. SSO email-preauthorised invites bind a session only when `emailVerified === true`;
 * password deployments instead treat possession of the addressed invite as the verification
 * ceremony because they have no outbound email-verification service. Never widen the SSO check to
 * "truthy" or default this flag to `true`.
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

/** Constant-time comparison for the first-run setup secret. Empty/unset secrets never match. */
function setupTokenMatches(configured: string | undefined, presented: string | null): boolean {
  if (!configured || !presented) return false
  const expected = Buffer.from(configured, 'utf8')
  const actual = Buffer.from(presented, 'utf8')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

// ── Admin-issued password-reset links (P1.18) ──────────────────────────────────────────────────
// CapacityLens deliberately has NO email infrastructure (docs/self-hosting.md — a standing
// non-goal), so Better Auth's reset flow is repurposed: `sendResetPassword` (the "send the email"
// hook) doesn't send anything — it CAPTURES the minted token and hands it back to the admin-gated
// route, which returns it exactly once (the invite-link pattern: write-once, distributed
// out-of-band by the admin). Everything else — hashed-at-rest token storage, single-use
// consumption, expiry, and the public POST /api/auth/reset-password redeem endpoint — stays
// Better Auth's.

/** Reset links are admin-minted and handed over out-of-band (Slack/chat), so the 1-hour Better
 *  Auth default is too tight — the recipient may not be at a keyboard. 24h matches the "share a
 *  link with a colleague" reality while staying far below the invite TTL (an invite grants entry;
 *  a reset link grants an EXISTING identity, so it stays the shorter-lived of the two). */
export const RESET_LINK_TTL_SECONDS = 60 * 60 * 24

/** Per-call capture context for {@link mintPasswordResetToken}. AsyncLocalStorage (not a module
 *  variable) so two concurrent admin resets can never swap tokens across their await chains, and
 *  so a PUBLIC call to POST /api/auth/request-password-reset — which Better Auth exposes once
 *  sendResetPassword is configured — finds NO store and the token goes nowhere (that public route
 *  is inert-by-design here: no email is ever sent, and its anti-enumeration response is unchanged). */
const resetTokenCapture = new AsyncLocalStorage<{ token: string | null }>()

/** The `emailAndPassword.sendResetPassword` hook: deliver the token to the capturing admin route
 *  (if any) instead of emailing it. Never throws — a throw here would surface as a Better Auth
 *  background-task error log, not a useful signal. */
async function captureResetToken({ token }: { token: string }): Promise<void> {
  const store = resetTokenCapture.getStore()
  if (store) store.token = token
  // No store = a public /api/auth/request-password-reset call: no email infra exists, so the
  // token is deliberately dropped (the endpoint's generic success reply is the anti-enumeration
  // surface either way).
}

/**
 * Mint a single-use, {@link RESET_LINK_TTL_SECONDS}-lived password-reset token for `email` via
 * Better Auth's own verification store (P1.18). Returns the token, or `null` when Better Auth
 * matched no user for the email (its anti-enumeration success tells us nothing, so "callback never
 * fired" IS the no-such-user signal). The caller (the admin-gated route in app.ts) turns the token
 * into a link and returns it exactly once. Better Auth persists only a digest of the identifier;
 * the bearer token itself is never stored or logged here.
 *
 * Password mode only: in 'sso' the IdP owns credentials and `sendResetPassword` is not configured,
 * so Better Auth itself refuses with RESET_PASSWORD_DISABLED — the route gates on mode first and
 * never reaches that.
 */
export async function mintPasswordResetToken(auth: Auth, email: string): Promise<string | null> {
  const store: { token: string | null } = { token: null }
  // The sendResetPassword hook is AWAITED inside requestPasswordReset (no backgroundTasks handler
  // is configured), so the capture is complete when this resolves.
  await resetTokenCapture.run(store, () => auth.api.requestPasswordReset({ body: { email } }))
  return store.token
}

/**
 * Delete every OUTSTANDING (unredeemed) password-reset token for `userId` (P1.18 escalation fix).
 *
 * A reset link is authorized at MINT time, but it lives for {@link RESET_LINK_TTL_SECONDS}; if the
 * member is PROMOTED within that window (an editor made owner, or handed ownership), a link minted
 * while they were a non-owner would still redeem into their now-owner identity — a takeover the
 * mint-time guard already refused for the new role. So every role ELEVATION calls this to burn the
 * user's outstanding links, re-closing the window: the promoted member (or their admin) must mint a
 * fresh link, which is then judged against the new role.
 *
 * Better Auth stores a reset token as a `verification` row: `identifier = 'reset-password:<token>'`,
 * `value = <userId>` (verified against better-auth 1.6.20, dist/api/routes/password.mjs —
 * createVerificationValue there; same version erasure.ts pins). We delete by `value = userId` AND
 * the `reset-password:` identifier prefix, so ONLY reset tokens go (never email-verification or
 * other verification rows). No-ops cleanly when the auth tables are absent (OFF mode never mounts
 * them, and the role routes that call this are inert no-ops in OFF anyway).
 *
 * @param db      The open SQLite handle.
 * @param userId  The user whose outstanding reset tokens to revoke.
 */
export function revokeResetTokensForUser(db: Db, userId: string): void {
  if (!verificationTableExists(db)) return // OFF / auth-off: no Better Auth tables exist.
  // Verification identifiers are deliberately hashed at rest, so their purpose prefix is no
  // longer queryable. Revoking all outstanding verification ceremonies for a user on a privilege
  // change is the safe conservative action (and avoids retaining any other takeover-capable link).
  db.prepare(`DELETE FROM verification WHERE value = ?`).run(userId)
}

/**
 * Per-handle cache of whether Better Auth's `verification` table exists, so the sqlite_master probe
 * runs at most ONCE per Db handle instead of on every membership write (the sole caller,
 * upsertMember, hits this on each role change / invite accept / org create).
 *
 * BOTH outcomes are safe to cache because table existence is FIXED for the life of a handle: Better
 * Auth's schema migration (runAuthMigrations) runs exactly once, at server boot — index.ts calls it
 * before the Fastify app is built, i.e. before any request can trigger a membership write — and in
 * OFF / auth-off mode it never runs at all, so the table is never created later. Nothing in the codebase
 * (or in the tests, which each open a fresh `openDb(':memory:')` handle and, when they exercise auth,
 * run migrations in setup before the first write) creates `verification` on a handle that has already
 * been probed. If a future path could create auth tables lazily AFTER a first write on a live handle,
 * this must switch to caching only the `true` outcome so a stale `false` can't hide a real table.
 *
 * WeakMap keyed by the Db handle: an entry is collected with its handle, so tests that spin up many
 * short-lived in-memory handles don't leak.
 */
const verificationTablePresence = new WeakMap<Db, boolean>()

function verificationTableExists(db: Db): boolean {
  const cached = verificationTablePresence.get(db)
  if (cached !== undefined) return cached
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'verification'`)
    .get() as { name?: string } | undefined
  const exists = row?.name === 'verification'
  verificationTablePresence.set(db, exists)
  return exists
}

/**
 * Per-handle cache of whether Better Auth's `user` table exists — caches the TRUE outcome ONLY,
 * unlike {@link verificationTablePresence} (which safely caches both ways). The difference:
 * {@link countUsers} is consulted BEFORE runAuthMigrations as well as after it — authFromEnv makes
 * its boot-time minPasswordLength decision on the pre-migration handle, where the table does not
 * exist yet. Caching that pre-migration `false` would make every later per-request call read
 * "zero users" forever, holding first-run sign-up open on a populated instance — the exact stale-
 * `false` hazard the verificationTablePresence comment warns about. So absence is re-probed every
 * call (cheap: one sqlite_master lookup, and only until the table appears); presence, once true,
 * is fixed for the life of the handle (nothing ever drops Better Auth's tables).
 */
const userTablePresence = new WeakMap<Db, true>()

function userTableExists(db: Db): boolean {
  if (userTablePresence.get(db)) return true
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'`)
    .get() as { name?: string } | undefined
  const exists = row?.name === 'user'
  if (exists) userTablePresence.set(db, true)
  return exists
}

/**
 * Count Better Auth `user` rows — the first-run signal. Zero means "no one can sign in yet", which
 * is what opens the one-time bootstrap paths: the live sign-up gate (hooks.before in
 * {@link authFromEnv}), the `needsSetup` flag on /api/auth/me's 401, and the
 * {@link createBootstrapAdmin} escape hatch all key on this. Safe to call before runAuthMigrations:
 * a missing `user` table (pre-migration, or an off-mode DB that never grows one) counts as zero
 * rather than throwing a confusing "no such table" (same probe posture as verificationTableExists).
 *
 * @param db The open SQLite handle.
 * @returns The number of Better Auth users, or 0 when the table does not exist (yet).
 */
export function countUsers(db: Db): number {
  if (!userTableExists(db)) return 0
  const row = db.prepare(`SELECT COUNT(*) AS n FROM user`).get() as { n?: number | bigint } | undefined
  return Number(row?.n ?? 0)
}

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

function optionalPair(env: Env, idKey: string, secretKey: string, label: string): [string, string] | null {
  const id = env[idKey]
  const secret = env[secretKey]
  if (!id && !secret) return null
  if (!id || !secret) {
    throw new AuthConfigError(`${idKey} and ${secretKey} must both be set to enable ${label}.`)
  }
  return [id, secret]
}

/** Native social providers assembled from env. Unset pairs are absent; a partial pair refuses
 * startup. New external identities are separately verified and invite-gated in the database hook. */
function socialProvidersFromEnv(env: Env): SocialProviders {
  const providers: SocialProviders = {}
  const google = optionalPair(env, 'CAPACITYLENS_GOOGLE_CLIENT_ID', 'CAPACITYLENS_GOOGLE_CLIENT_SECRET', 'Google sign-in')
  if (google) providers.google = { clientId: google[0], clientSecret: google[1] }
  const microsoft = optionalPair(
    env,
    'CAPACITYLENS_MICROSOFT_CLIENT_ID',
    'CAPACITYLENS_MICROSOFT_CLIENT_SECRET',
    'Microsoft sign-in',
  )
  if (microsoft) {
    // tenantId defaults to 'common' (multi-tenant) when not pinned to a single Entra tenant.
    providers.microsoft = {
      clientId: microsoft[0],
      clientSecret: microsoft[1],
      tenantId: env.CAPACITYLENS_MICROSOFT_TENANT_ID || 'common',
    }
  }
  const github = optionalPair(env, 'CAPACITYLENS_GITHUB_CLIENT_ID', 'CAPACITYLENS_GITHUB_CLIENT_SECRET', 'GitHub sign-in')
  if (github) providers.github = { clientId: github[0], clientSecret: github[1] }
  return providers
}

function externalProviderInfo(env: Env, genericProviderId: string | null): AuthProviderInfo[] {
  const providers: AuthProviderInfo[] = []
  if (env.CAPACITYLENS_GOOGLE_CLIENT_ID && env.CAPACITYLENS_GOOGLE_CLIENT_SECRET) {
    providers.push({ id: 'google', label: 'Google', kind: 'social', experimental: true })
  }
  if (env.CAPACITYLENS_MICROSOFT_CLIENT_ID && env.CAPACITYLENS_MICROSOFT_CLIENT_SECRET) {
    providers.push({ id: 'microsoft', label: 'Microsoft', kind: 'social', experimental: true })
  }
  if (env.CAPACITYLENS_GITHUB_CLIENT_ID && env.CAPACITYLENS_GITHUB_CLIENT_SECRET) {
    providers.push({ id: 'github', label: 'GitHub', kind: 'social', experimental: true })
  }
  if (genericProviderId) {
    providers.push({
      id: genericProviderId,
      label: env.CAPACITYLENS_SSO_LABEL?.trim() || 'Single sign-on',
      kind: 'oidc',
      experimental: true,
    })
  }
  return providers
}

function externalIdentityPath(path: string | undefined): boolean {
  return path?.startsWith('/callback/') === true || path?.startsWith('/oauth2/callback/') === true
}

/** Decide whether Better Auth may create a new external identity. Existing identities do not pass
 * through this creation hook. The first user needs an operator allow-list entry; later users need
 * a live email-preauthorised invite. Unverified or missing email always fails closed. */
export function externalIdentityAllowed(db: Db, env: Env, user: { email?: string; emailVerified?: boolean }): boolean {
  if (user.emailVerified !== true || !user.email) return false
  const email = user.email.trim().toLowerCase()
  if (!email) return false

  const bootstrapEmails = (env.CAPACITYLENS_SSO_BOOTSTRAP_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  if (countUsers(db) === 0 && bootstrapEmails.includes(email)) return true

  const invite = db.prepare(`
    SELECT 1 AS allowed
      FROM invites
     WHERE lower(trim(preauthEmail)) = ?
       AND usedAt IS NULL
       AND expiresAt > ?
     LIMIT 1
  `).get(email, new Date().toISOString()) as { allowed?: number } | undefined
  return invite?.allowed === 1
}

/** Build the Better Auth instance for the parsed mode — or null in 'off' mode, where no
 *  env beyond CAPACITYLENS_AUTH itself is read. `trustedOrigins` should be the same browser
 *  origins the CORS allow-list names (Better Auth checks Origin on state-changing calls);
 *  the same-origin production deploy needs none.
 *
 *  Cookie security is derived from `BETTER_AUTH_URL`, the browser-facing public origin. It must
 *  never be tied to whether the Node hop itself terminates TLS: the normal nginx deployment uses
 *  HTTPS in the browser and HTTP between nginx and Node. */
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

  let publicUrl: URL
  try {
    publicUrl = new URL(baseURL)
  } catch (cause) {
    throw new AuthConfigError('BETTER_AUTH_URL must be an absolute http:// or https:// URL.', { cause })
  }
  if (publicUrl.protocol !== 'http:' && publicUrl.protocol !== 'https:') {
    throw new AuthConfigError('BETTER_AUTH_URL must use http:// or https://.')
  }
  const loopbackHost =
    publicUrl.hostname === 'localhost' ||
    publicUrl.hostname.endsWith('.localhost') ||
    publicUrl.hostname === '127.0.0.1' ||
    publicUrl.hostname === '[::1]'
  if (env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:' && !loopbackHost) {
    throw new AuthConfigError(
      'BETTER_AUTH_URL must use https:// for a non-loopback production origin; credentials and session cookies must not cross plaintext HTTP.',
    )
  }

  // Generic OAuth/OIDC is additive in password mode and exclusive in sso mode. This lets an
  // installation keep a password fallback while trialling SSO, then switch to SSO-only without
  // changing provider configuration.
  const genericSsoConfigured = Boolean(env.CAPACITYLENS_SSO_CLIENT_ID || env.CAPACITYLENS_SSO_CLIENT_SECRET)
  if (genericSsoConfigured) {
    optionalPair(env, 'CAPACITYLENS_SSO_CLIENT_ID', 'CAPACITYLENS_SSO_CLIENT_SECRET', 'generic SSO')
  }
  if (mode === 'sso' && !genericSsoConfigured) {
    throw new AuthConfigError(
      'CAPACITYLENS_AUTH=sso requires CAPACITYLENS_SSO_CLIENT_ID and CAPACITYLENS_SSO_CLIENT_SECRET.',
    )
  }
  const genericProviderId = genericSsoConfigured ? env.CAPACITYLENS_SSO_PROVIDER_ID || 'sso' : null
  const plugins =
    genericProviderId
      ? [
          genericOAuth({
            config: [
              {
                providerId: genericProviderId,
                clientId: required(env, 'CAPACITYLENS_SSO_CLIENT_ID', 'generic SSO'),
                clientSecret: required(env, 'CAPACITYLENS_SSO_CLIENT_SECRET', 'generic SSO'),
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
  if (genericProviderId && !env.CAPACITYLENS_SSO_DISCOVERY_URL && !(env.CAPACITYLENS_SSO_AUTHORIZATION_URL && env.CAPACITYLENS_SSO_TOKEN_URL)) {
    throw new AuthConfigError(
      'Generic SSO needs CAPACITYLENS_SSO_DISCOVERY_URL, or CAPACITYLENS_SSO_AUTHORIZATION_URL + CAPACITYLENS_SSO_TOKEN_URL.',
    )
  }

  // SECURE DEFAULT (P1.7) + FIRST-RUN SETUP: self-service signup is closed / invite-only by
  // design (Decisions — social SSO is the primary path; email+password a secondary fallback),
  // with EXACTLY ONE bootstrap exception: an EMPTY user table plus the operator-configured setup
  // token. The first sign-up creates the owner; the token prevents an arbitrary network visitor
  // from claiming that seat. The gate is enforced LIVE, per request, by the hooks.before below —
  // NOT by Better Auth's static
  // disableSignUp, because a boot-time boolean cannot express "open while zero users, closed the
  // moment the first user exists": a still-running server would keep signup open until a restart
  // (a hole). CAPACITYLENS_ALLOW_OPEN_SIGNUP=1 keeps its meaning — an INTERIM trusted-instance/dev
  // escape that re-opens signup unconditionally. With neither condition, POST
  // /api/auth/sign-up/email returns the same 400 EMAIL_PASSWORD_SIGN_UP_DISABLED as before.
  const allowOpenSignup = env.CAPACITYLENS_ALLOW_OPEN_SIGNUP === '1'
  const setupToken = env.CAPACITYLENS_SETUP_TOKEN || undefined
  if (mode === 'password' && setupToken && Buffer.byteLength(setupToken, 'utf8') < 32) {
    throw new AuthConfigError('CAPACITYLENS_SETUP_TOKEN must be at least 32 bytes.')
  }
  if (!allowOpenSignup) {
    db.exec(`CREATE TABLE IF NOT EXISTS capacitylens_bootstrap_claim (
      id INTEGER PRIMARY KEY CHECK (id = 1), claimedAt TEXT NOT NULL
    )`)
    // A crash before user creation must not permanently strand first-run setup.
    db.prepare(`DELETE FROM capacitylens_bootstrap_claim WHERE claimedAt < ?`).run(
      new Date(Date.now() - 5 * 60_000).toISOString(),
    )
  }

  // The password floor remains unconditional, including when the optional bootstrap-owner flag
  // is active. createBootstrapAdmin generates a high-entropy password that comfortably exceeds it.

  const instance = betterAuth({
    database: db, // node:sqlite DatabaseSync — same file as the app data (see header)
    secret,
    baseURL,
    basePath: '/api/auth',
    // Better Auth defaults verification identifiers to plaintext. Reset identifiers contain the
    // live bearer token (`reset-password:<token>`), so a DB/backup reader could otherwise take over
    // the account. The library hashes on both create and consume, preserving the normal API while
    // ensuring no live reset/email-verification token is recoverable from storage.
    verification: { storeIdentifier: 'hashed' },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            // Internal credential creation is reachable only through CapacityLens's own
            // invite/bootstrap services and deliberately has no web request context.
            if (!context?.path) return
            const emailSignup = context.path === '/sign-up/email'
            const externalSignup = externalIdentityPath(context.path)
            if (!emailSignup && !externalSignup) return

            // Open EMAIL registration never opens external identity creation as a side effect.
            // Social/OIDC remains verified-email + invitation/allow-list gated in every posture.
            if (externalSignup && !externalIdentityAllowed(db, env, user)) {
              throw APIError.from('FORBIDDEN', {
                message: 'This identity is not invited to this CapacityLens instance.',
                code: 'EXTERNAL_IDENTITY_NOT_INVITED',
              })
            }
            if (allowOpenSignup) return

            // The route-level check may have observed zero users concurrently with another
            // request. Re-check at the actual user insertion boundary and fail closed once the
            // winner exists; otherwise a delayed loser could still create an orphan identity.
            if (emailSignup && countUsers(db) !== 0) {
              throw APIError.from('CONFLICT', {
                message: 'The first owner account has already been created.',
                code: 'BOOTSTRAP_ALREADY_CLAIMED',
              })
            }
            // Only the first identity needs the cross-request bootstrap claim. Later external
            // identities are independently authorised by their live pre-authorised invite.
            if (countUsers(db) === 0) {
              try {
                db.prepare(`INSERT INTO capacitylens_bootstrap_claim (id, claimedAt) VALUES (1, ?)`).run(
                  new Date().toISOString(),
                )
              } catch {
                throw APIError.from('CONFLICT', {
                  message: 'First-owner setup is already in progress.',
                  code: 'BOOTSTRAP_ALREADY_IN_PROGRESS',
                })
              }
            }
          },
        },
      },
    },
    emailAndPassword: {
      enabled: mode === 'password',
      // The static library flag stays OFF so the sign-up gate has ONE owner: the live hooks.before
      // below (see the SECURE DEFAULT comment above). Better Auth 1.6.20 enforces disableSignUp
      // even for server-side auth.api.signUpEmail calls (sign-up.mjs:143), so leaving it on would
      // also break the BROWSER first-run bootstrap (the login screen's "Create the owner account"
      // form, which really does POST /api/auth/sign-up/email) — the headless
      // --create-owner-admin-admin path is unaffected either way, since it now bypasses this route
      // entirely (see createBootstrapAdmin).
      disableSignUp: false,
      // PIN the minimum length to the shared constant rather than inheriting Better Auth's default,
      // so the server bound and the client reset-page pre-check (both read MIN_PASSWORD_LENGTH) can't
      // drift — and a library-default change can't silently move the server's floor. UNCONDITIONAL:
      // no boot, flagged or not, ever lowers this — see the bootstrap comment above for how the
      // generated bootstrap password comfortably satisfies the same policy.
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // PIN the maximum length to the shared constant too (same no-drift contract as the min): the
      // client reset-page pre-check reads MAX_PASSWORD_LENGTH, so the bound it states is the bound the
      // server enforces, and a library-default change can't silently move the server's ceiling.
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      // Admin-issued reset links (P1.18) — password mode ONLY: 'sso' delegates credentials to the
      // IdP, and configuring sendResetPassword would needlessly enable Better Auth's public
      // request-password-reset endpoint there. See captureResetToken/mintPasswordResetToken above.
      ...(mode === 'password'
        ? {
            sendResetPassword: captureResetToken,
            resetPasswordTokenExpiresIn: RESET_LINK_TTL_SECONDS,
            // A reset is "I lost control of my credential" (or an admin offboarding a laptop):
            // every existing session for that user dies with the old password.
            revokeSessionsOnPasswordReset: true,
          }
        : {}),
    },
    // Native Google/Microsoft/GitHub sign-in, each only when its env is set (see helper).
    // Independent of the 'sso' genericOAuth plugin above; an empty object = none configured.
    socialProviders: socialProvidersFromEnv(env),
    // The LIVE sign-up gate (see the SECURE DEFAULT comment above): allowed when the operator
    // opted in, or for the empty-table owner bootstrap when the request proves knowledge of the
    // configured setup secret. countUsers(db) is consulted per request so the bootstrap route
    // closes immediately after the first identity is created.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return
        if (allowOpenSignup) return
        // A fresh password instance is never claimable merely because it is reachable. The
        // operator configures CAPACITYLENS_SETUP_TOKEN and the owner-setup form presents it in
        // this header. index.ts also refuses a fresh password boot when the secret is absent.
        if (
          countUsers(db) === 0 &&
          setupTokenMatches(setupToken, ctx.headers?.get('x-capacitylens-setup-token') ?? null)
        ) return
        // The EXACT refusal Better Auth's own disableSignUp emits (sign-up.mjs, 1.6.20), so the
        // client and tests see one unchanged error shape regardless of which gate closed the door.
        throw APIError.from('BAD_REQUEST', {
          message: 'Email and password sign up is not enabled',
          code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED',
        })
      }),
      after: createAuthMiddleware(async (ctx) => {
        // Open signup never creates the claim table. Closed signup releases its claim on both
        // success and failure so erasing the sole identity can reopen setup in the same process.
        if (!allowOpenSignup && (ctx.path === '/sign-up/email' || externalIdentityPath(ctx.path))) {
          db.prepare(`DELETE FROM capacitylens_bootstrap_claim WHERE id = 1`).run()
        }
      }),
    },
    plugins,
    trustedOrigins: opts.trustedOrigins,
    // Session-cookie hardening. `Secure` follows the PUBLIC Better Auth URL, not the Node listener:
    // an HTTPS browser origin still needs Secure cookies when nginx proxies to Node over HTTP.
    // `sameSite:'lax'` (NOT 'strict') is required for SSO: 'strict' would
    // drop the session cookie on the top-level OAuth redirect back from the IdP → broken sign-in;
    // 'lax' still sends the cookie on that GET callback and is safe. `httpOnly:true` keeps the token
    // out of document.cookie (no JS read).
    advanced: {
      useSecureCookies: publicUrl.protocol === 'https:',
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
    api: {
      getSession: (input: { headers: Headers }) => Promise<{ user: RawSessionUser } | null>
      requestPasswordReset: Auth['api']['requestPasswordReset']
    }
    options: BetterAuthOptions
    // Better Auth's async init context (verified against better-auth 1.6.20,
    // dist/auth/base.mjs:37 `$context: authContext` and dist/db/internal-adapter.mjs:78-91,148-161,
    // 499-505 for the createUser/deleteUser/linkAccount shapes, dist/context/create-context.mjs:
    // 175-183 for `password.hash`). Read ONLY through {@link Auth.createCredentialUser} — see its
    // TSDoc for why.
    $context: Promise<{
      password: { hash: (password: string) => Promise<string> }
      internalAdapter: {
        createUser: (input: { email: string; name: string; emailVerified: boolean }) => Promise<{ id: string }>
        deleteUser: (userId: string) => Promise<void>
        linkAccount: (input: {
          userId: string
          providerId: string
          accountId: string
          password: string
        }) => Promise<unknown>
      }
    }>
  }
  const auth: Auth = {
    handler: raw.handler,
    options: raw.options,
    providers: externalProviderInfo(env, genericProviderId),
    api: {
      async getSession(input) {
        const session = await raw.api.getSession(input)
        return session ? { user: normalizeSessionUser(session.user) } : null
      },
      // Bound (not bare-referenced): Better Auth's api endpoints resolve their context via `this`.
      requestPasswordReset: (input) => raw.api.requestPasswordReset(input),
    },
    createCredentialUser: (email, name, password, emailVerified = false) =>
      raw.$context.then((ctx) => createCredentialUserWith(ctx, email, name, password, emailVerified)),
    deleteCredentialUser: (userId) => raw.$context.then((ctx) => ctx.internalAdapter.deleteUser(userId)),
  }
  return { mode, auth }
}

/** The subset of Better Auth's `$context` {@link createCredentialUserWith} needs — factored out
 *  so the rollback-on-failure contract (Finding 1) can be pinned in tests against a fake context,
 *  without a live Better Auth instance. */
interface CredentialUserContext {
  password: { hash: (password: string) => Promise<string> }
  internalAdapter: {
    createUser: (input: { email: string; name: string; emailVerified: boolean }) => Promise<{ id: string }>
    deleteUser: (userId: string) => Promise<void>
    linkAccount: (input: {
      userId: string
      providerId: string
      accountId: string
      password: string
    }) => Promise<unknown>
  }
}

/**
 * hash → createUser → linkAccount, with a best-effort rollback of the user row if linkAccount
 * fails (Finding 1: an orphaned, credential-less user would make {@link countUsers} > 0 forever,
 * permanently locking out both first-run bootstrap paths). Exported ONLY so tests can exercise the
 * rollback against a fake {@link CredentialUserContext}; production reaches this exclusively
 * through {@link Auth.createCredentialUser}, bound to the real Better Auth `$context`.
 *
 * @throws when linkAccount fails — the thrown Error carries `{ cause }` (the original failure)
 * and its message names the rollback, per DEFENSIVE-CODING §1.
 */
export async function createCredentialUserWith(
  ctx: CredentialUserContext,
  email: string,
  name: string,
  password: string,
  emailVerified = false,
): Promise<{ id: string }> {
  const hash = await ctx.password.hash(password)
  const user = await ctx.internalAdapter.createUser({ email, name, emailVerified })
  try {
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: hash,
    })
  } catch (e) {
    // Roll back so a half-created (credential-less) user cannot strand the
    // instance: countUsers>0 with no sign-in-able account would close BOTH bootstrap paths (the
    // browser first-run form and --create-owner-admin-admin) forever. If cleanup also fails, both
    // failures must surface: claiming rollback succeeded would conceal the exact manual repair an
    // operator now needs to perform.
    let rollbackError: unknown
    try {
      await ctx.internalAdapter.deleteUser(user.id)
    } catch (cleanupError) {
      rollbackError = cleanupError
    }
    if (rollbackError !== undefined) {
      throw new AggregateError(
        [e, rollbackError],
        `createCredentialUser: linkAccount failed after createUser (userId=${user.id}), and the user-row rollback also failed; manual cleanup is required before bootstrap can be retried`,
        { cause: e },
      )
    }
    throw new Error(
      `createCredentialUser: linkAccount failed after createUser (userId=${user.id}); user row rolled back to keep the first-run bootstrap recoverable`,
      { cause: e },
    )
  }
  return user
}

/** Create/upgrade Better Auth's tables in the shared SQLite file. Called at boot ONLY
 *  when mode ≠ off — an off-mode DB never grows auth tables (the OFF guarantee). */
export async function runAuthMigrations(auth: Auth): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
}

// ── First-run owner bootstrap (--create-owner-admin-admin / CAPACITYLENS_CREATE_ADMIN_ADMIN=1) ────
// The headless escape hatch for a first login: a fresh password-mode instance normally bootstraps
// through the login screen's "Create the owner account" form (the browser path), but a scripted /
// container deploy may want a credential ready at boot. The flag creates admin@admin.admin with a
// fresh high-entropy password ONLY on an EMPTY user table and prints it once at startup.

/** Stable identity for the optional bootstrap owner. Its password is random per creation. */
export const BOOTSTRAP_ADMIN_NAME = 'admin'
export const BOOTSTRAP_ADMIN_EMAIL = 'admin@admin.admin'

/**
 * Create the bootstrap owner account when — and only
 * when — the Better Auth `user` table has ZERO rows. Called at boot from index.ts, after
 * runAuthMigrations and before buildApp, whenever the operator passed --create-owner-admin-admin
 * (or CAPACITYLENS_CREATE_ADMIN_ADMIN=1).
 *
 * Outcomes, deliberately tiered:
 * - **Empty user table → 'created'.** The account is created through {@link Auth.createCredentialUser} —
 *   Better Auth's internalAdapter.createUser + linkAccount directly, NOT the public sign-up
 *   route/auth.api.signUpEmail — and a LOUD framed warning naming the exact credential is
 *   printed once so the operator can sign in.
 * - **Users already exist → 'skipped'.** One log line, boot continues normally — the flag is
 *   idempotent by design so a deploy script can leave it set across restarts without erroring.
 * - **Auth off / sso → throws {@link AuthConfigError}.** The flag creates an email+password
 *   credential, so it is meaningless without password mode — refusing loudly (the entrypoint
 *   frames it via refuseToStart) beats silently ignoring an operator's explicit instruction.
 *
 * @param db    The open SQLite handle (for the zero-users check).
 * @param mode  The parsed auth mode — must be 'password'.
 * @param auth  The Better Auth instance — non-null exactly when mode ≠ 'off'.
 * @param log   Line sink for the warning/skip output (console.log in production; injectable for tests).
 * @returns 'created' when the account was made, 'skipped' when users already existed.
 * @throws AuthConfigError when mode is not 'password' (boot must refuse, not limp on).
 */
export async function createBootstrapAdmin(
  db: Db,
  mode: AuthMode,
  auth: Auth | null,
  log: (line: string) => void = console.log,
): Promise<'created' | 'skipped'> {
  if (mode !== 'password' || !auth) {
    throw new AuthConfigError(
      `--create-owner-admin-admin (CAPACITYLENS_CREATE_ADMIN_ADMIN=1) creates an email+password credential, which is meaningless when CAPACITYLENS_AUTH is '${mode}'. Set CAPACITYLENS_AUTH=password, or drop the flag.`,
    )
  }
  if (countUsers(db) > 0) {
    // Not an error: the flag is a first-run bootstrap, and this run isn't the first. One line so
    // the operator can see the flag was noticed, then boot continues untouched.
    log('capacitylens-server: --create-owner-admin-admin skipped: users already exist')
    return 'skipped'
  }
  // Bypass the public sign-up route for this bootstrap write. The generated password exceeds the
  // normal password floor. createCredentialUser owns the createUser→linkAccount sequencing and rolls
  // back the user row if linkAccount fails, so a partial write here can never leave an orphaned,
  // credential-less user that would strand every bootstrap path (see its TSDoc, Finding 1).
  // Default to a fresh high-entropy secret (the secure norm — no fixed password baked into the
  // product). An explicit CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD overrides it for a scripted / e2e
  // deploy that must know the credential up front rather than scrape the one-time banner; an empty
  // value reads as unset. createCredentialUser bypasses the public sign-UP floor, so an operator may
  // pin even a short password here. productionGuard surfaces the override under NODE_ENV=production.
  const bootstrapPassword =
    process.env.CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD || randomBytes(24).toString('base64url')
  await auth.createCredentialUser(BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, bootstrapPassword)
  // Print the one-time credential prominently. The frame is measured
  // from the content (not hand-padded) so a future wording tweak can't skew the box.
  const content = [
    'A bootstrap owner credential was just created:',
    `    email:    ${BOOTSTRAP_ADMIN_EMAIL}`,
    `    password: ${bootstrapPassword}`,
    'Store this generated password securely, sign in, and change it via',
    'Settings → Members → Reset password. Then remove',
    'the --create-owner-admin-admin flag / CAPACITYLENS_CREATE_ADMIN_ADMIN env.',
  ]
  const width = Math.max(...content.map((line) => line.length))
  log(
    [
      '',
      `  ╔${'═'.repeat(width + 4)}╗`,
      ...content.map((line) => `  ║  ${line.padEnd(width)}  ║`),
      `  ╚${'═'.repeat(width + 4)}╝`,
      '',
    ].join('\n'),
  )
  return 'created'
}

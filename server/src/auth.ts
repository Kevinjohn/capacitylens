import { timingSafeEqual } from "node:crypto";
import type { Db } from "./db";
import { assertBootstrapClaimCurrent } from "./bootstrapClaim";
import { accountConfigKey } from "./accountConfig";
import { StrictOidcVerificationError } from "./strictOidc";
import type { Auth, AuthMode } from "./authConfig/authTypes";
import { resetTokenCapture } from "./authConfig/captureContexts";
import { buildAuthFromEnv } from "./authConfig/authFromEnv";
import { buildAuthAdapter } from "./authConfig/authAdapter";
import { buildCreateBootstrapAdmin } from "./authConfig/bootstrapAdmin";

export type { AuthMode, AuthProviderInfo, Auth, SessionUser } from "./authConfig/authTypes";
export { DEMO_USER, DEFAULT_ACCOUNT_APPLICATION } from "./authConfig/authTypes";
export {
  RESET_LINK_TTL_SECONDS,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_FRESH_AGE_SECONDS,
  SESSION_INACTIVITY_TTL_SECONDS,
  FEDERATED_SUBJECT_UNIQUE_INDEX,
  FEDERATED_PRINCIPAL_PROVIDER_UNIQUE_INDEX,
  FEDERATED_OBSERVATION_TRIGGER,
  MIN_BETTER_AUTH_SECRET_LENGTH,
} from "./authConfig/authConstants";
export { verifyPasswordWithBackpressure, hashPasswordWithBackpressure } from "./authConfig/passwordBackpressure";
export { enforceSessionActivity, normalizeSessionUser } from "./authConfig/sessionActivity";
export {
  FEDERATED_IDENTITY_V25_DEFINITION,
  migrateFederatedIdentityV25,
  ensureFederatedIdentitySchema,
  assertFederatedIdentitySchemaCurrent,
} from "./authConfig/federatedIdentitySchema";
export { runAuthMigrations, planAuthSchemaMigrations, BOOTSTRAP_ADMIN_EMAIL } from "./authConfig/bootstrapAdmin";

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

/** Misconfiguration that must refuse boot loudly (same posture as assertSchemaCurrent) —
 *  the entrypoint catches this, prints the message, and exits 1. */
export class AuthConfigError extends Error {}

// Constant-time secret compare shared by the first-run setup token and the P1.8 bootstrap
// token. Returns false UNLESS the configured token is a non-empty string AND the presented
// value is a non-empty string of the SAME byte length whose bytes match — so an unset/empty
// token (the default) never allows the token path, and the length-equality short-circuit
// doesn't reveal the secret's length by timing (timingSafeEqual itself requires equal-length
// buffers). Headers arrive as string | string[] | undefined from Fastify, or string | null
// from a Better Auth ctx; `unknown` covers both — only a single string can match.
export function secretTokenMatches(configured: string | undefined, presented: unknown): boolean {
  if (!configured || typeof presented !== "string" || presented.length === 0) return false;
  const a = Buffer.from(configured, "utf8");
  const b = Buffer.from(presented, "utf8");
  // timingSafeEqual throws on a length mismatch — guard first; an attacker learns only "wrong
  // length" (already observable from the response), not the secret's bytes.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Admin-issued password-reset links (P1.18) ──────────────────────────────────────────────────
// CapacityLens deliberately has NO email infrastructure (docs-src/security/privacy.md — a standing
// non-goal), so Better Auth's reset flow is repurposed: `sendResetPassword` (the "send the email"
// hook) doesn't send anything — it CAPTURES the minted token and hands it back to the admin-gated
// route, which returns it exactly once (the invite-link pattern: write-once, distributed
// out-of-band by the admin). Everything else — hashed-at-rest token storage, single-use
// consumption, expiry, and the public POST /api/auth/reset-password redeem endpoint — stays
// Better Auth's.

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
  const store: { token: string | null } = { token: null };
  // The sendResetPassword hook is AWAITED inside requestPasswordReset (no backgroundTasks handler
  // is configured), so the capture is complete when this resolves.
  await resetTokenCapture.run(store, () => auth.api.requestPasswordReset({ body: { email } }));
  return store.token;
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
 * Better Auth stores reset and other verification ceremonies with `value = <userId>`. Their
 * identifiers are hashed at rest, so purpose-specific deletion is unavailable; a privilege change
 * conservatively revokes every outstanding ceremony for that identity. No-ops cleanly when the auth
 * tables are absent (OFF mode never mounts them, and its role routes are inert no-ops).
 *
 * @param db      The open SQLite handle.
 * @param userId  The user whose outstanding reset tokens to revoke.
 */
export function revokeResetTokensForUser(db: Db, userId: string): void {
  if (!verificationTableExists(db)) return; // OFF / auth-off: no Better Auth tables exist.
  // Verification identifiers are deliberately hashed at rest, so their purpose prefix is no
  // longer queryable. Revoking all outstanding verification ceremonies for a user on a privilege
  // change is the safe conservative action (and avoids retaining any other takeover-capable link).
  db.prepare(`DELETE FROM verification WHERE value = ?`).run(userId);
}

/** Revoke Better Auth's still-pending OAuth link state for one principal inside the caller's
 * transaction. The state has no foreign key to the application ceremony, so identity mutations
 * must explicitly clear both stores. */
export function revokeFederatedLinkStateInTx(db: Db, principalId: string): void {
  if (!verificationTableExists(db)) return;
  db.prepare(
    `DELETE FROM verification
      WHERE json_valid(value)
        AND json_extract(value, '$.link.userId') = ?`,
  ).run(principalId);
}

/**
 * Factory for a per-handle "cache TRUE only" table-existence probe, so the sqlite_master lookup
 * runs at most ONCE per Db handle once the table is seen to exist. WeakMap keyed by the Db
 * handle: an entry is collected with its handle, so tests that spin up many short-lived
 * in-memory handles don't leak.
 *
 * Absence is deliberately re-probed on every call (never cached): a table this factory guards may
 * not exist yet on a handle this function is consulted on BEFORE the migration that creates it
 * runs on that same handle. Caching a pre-migration `false` would make every later call on that
 * handle read "table absent" forever, which is the specific hazard each call site below documents.
 */
export function cachedTableExists(table: string): (db: Db) => boolean {
  const presence = new WeakMap<Db, true>();
  return (db: Db): boolean => {
    if (presence.get(db)) return true;
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as
      { name?: string } | undefined;
    const exists = row?.name === table;
    if (exists) presence.set(db, true);
    return exists;
  };
}

// The sole caller, upsertMember, hits this on each role change / invite accept / org create.
// Application migration v12 may probe this table before runAuthMigrations creates it on the same
// handle when an existing auth-off database first enables password auth; caching that pre-auth
// `false` would permanently suppress reset-token revocation for the rest of the process.
const verificationTableExists = cachedTableExists("verification");

// {@link countUsers} is consulted BEFORE runAuthMigrations as well as after it — authFromEnv makes
// its boot-time minPasswordLength decision on the pre-migration handle, where the table does not
// exist yet. Caching that pre-migration `false` would make every later per-request call read
// "zero users" forever, holding first-run sign-up open on a populated instance.
const userTableExists = cachedTableExists("user");

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
  if (!userTableExists(db)) return 0;
  const row = db.prepare(`SELECT COUNT(*) AS n FROM user`).get() as { n?: number | bigint } | undefined;
  return Number(row?.n ?? 0);
}

/** Identity-storage-owned lookup for the operator recovery tool: the ids of every credential
 * identity registered under this normalized address. The caller passes a limit one higher than
 * the count it accepts so ambiguity is detectable without walking the whole table. */
export function findUserIdsByEmail(db: Db, email: string, limit: number): string[] {
  const rows = db.prepare(`SELECT id FROM user WHERE email = ? LIMIT ?`).all(email, limit) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function parseAuthMode(raw: string | undefined): AuthMode {
  const mode = raw === undefined || raw === "" ? "off" : raw;
  if (mode === "off" || mode === "password" || mode === "sso") return mode;
  throw new AuthConfigError(
    `SMALLSASS_ACCOUNT_MODE must be 'off', 'password' or 'sso' — got '${raw}'. Unset it for today's no-auth behaviour.`,
  );
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string, context: string): string {
  const value = env[key];
  if (!value) throw new AuthConfigError(`${accountConfigKey(key)} is required when ${context}.`);
  return value;
}

function externalIdentityPath(path: string | undefined): boolean {
  return path?.startsWith("/callback/") === true || path?.startsWith("/oauth2/callback/") === true;
}

export function providerIdFromExternalContext(
  context:
    | {
        path?: string;
        params?: Record<string, unknown>;
      }
    | null
    | undefined,
): string | null {
  if (!externalIdentityPath(context?.path)) return null;
  // Better Auth's database-hook context uses the route template as `path` and carries the concrete
  // provider in params. Older/custom adapters may provide a concrete path instead, so retain that
  // safe fallback while explicitly refusing template placeholders.
  const parameter = context?.params?.providerId ?? context?.params?.id;
  const value = typeof parameter === "string" ? parameter : context?.path?.split("/").filter(Boolean).at(-1);
  if (!value || value.startsWith(":")) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed percent escape is attacker-controlled path input, not an internal failure.
    // Returning no provider keeps assurance fail-closed while Better Auth renders its normal 4xx.
    return null;
  }
}

/** Accept a false/missing verification claim only for an exact row with durable verified-admission evidence. */
export function assertStrictOidcEmailAdmission(
  db: Db,
  providerId: string,
  profile: { sub: string; emailVerified: boolean },
): void {
  if (profile.emailVerified) return;
  // Only a durable observation created by the v25 trigger proves that this exact provider row was
  // admitted under the verified-email invariant. Legacy rows predate that proof and must relink.
  const existing = db
    .prepare(
      `SELECT 1
         FROM account AS account
         JOIN capacitylens_federated_link_observations AS observation
           ON observation.accountRowId = account.id
          AND observation.principalId = account.userId
          AND observation.providerId = account.providerId
          AND observation.subject = account.accountId
        WHERE account.providerId = ? AND account.accountId = ?
        LIMIT 1`,
    )
    .get(providerId, profile.sub);
  if (!existing) {
    throw new StrictOidcVerificationError(
      "OIDC user-info response must assert a verified email address for admission or linking.",
    );
  }
}

/** Verify and maintain CapacityLens's versioned first-owner claim control after application
 * migrations have succeeded. Schema changes belong exclusively to the application migration ledger. */
export function ensureAuthControlTables(db: Db, env: Env): void {
  // Open registration applies only to email credentials. A first external identity still needs
  // the single-winner bootstrap claim, so this table is required in both registration postures.
  // Keep `env` in the signature because auth setup deliberately shares the same contract as the
  // other auth controls, even though this control is unconditional in auth-on.
  void env;
  assertBootstrapClaimCurrent(db);
  // A crash before user creation must not permanently strand first-run setup.
  const now = Date.now();
  const leaseMs = 5 * 60_000;
  const claims = db.prepare(`SELECT id, claimedAt FROM capacitylens_bootstrap_claim`).all() as Array<{
    id: number;
    claimedAt: string;
  }>;
  const remove = db.prepare(`DELETE FROM capacitylens_bootstrap_claim WHERE id = ? AND claimedAt = ?`);
  for (const claim of claims) {
    const claimedAt = Date.parse(claim.claimedAt);
    if (!Number.isFinite(claimedAt) || claimedAt < now - leaseMs || claimedAt > now + leaseMs) {
      remove.run(claim.id, claim.claimedAt);
    }
  }
}

/** Structural half of a SQLite UNIQUE-constraint collision on the bootstrap-claim insert,
 *  shared by both acquisition sites. Each caller ORs its own message-regex clause on top (the
 *  two patterns differ deliberately for now), so this only covers the code/errcode probe. */
function isSqliteConstraintCollision(sqlite: { code?: unknown; errcode?: unknown }): boolean {
  return sqlite.errcode === 19 || (typeof sqlite.code === "string" && sqlite.code.startsWith("SQLITE_CONSTRAINT"));
}

export const authFromEnv = buildAuthFromEnv({
  AuthConfigError,
  parseAuthMode,
  required,
  assertStrictOidcEmailAdmission,
  isSqliteConstraintCollision,
  providerIdFromExternalContext,
  countUsers,
  externalIdentityPath,
  secretTokenMatches,
  ensureAuthControlTables,
  createAuthAdapter: buildAuthAdapter({ revokeFederatedLinkStateInTx, AuthConfigError, providerIdFromExternalContext }),
});

export const createBootstrapAdmin = buildCreateBootstrapAdmin({
  AuthConfigError,
  countUsers,
  isSqliteConstraintCollision,
});

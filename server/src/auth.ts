import { timingSafeEqual } from "node:crypto";
import type { Db } from "./db";
import { assertBootstrapClaimCurrent } from "./bootstrapClaim";
import type { AccountMode, Auth } from "./authConfig/authTypes";
import { resetTokenCapture } from "./authConfig/captureContexts";
import { createAuthFromEnvironmentFactory } from "./authConfig/authFromEnv";
import { createAuthAdapterFactory } from "./authConfig/authAdapter";
import { createBootstrapAdminFactory } from "./authConfig/bootstrapAdmin";
import { createTableExistenceProbe } from "./authConfig/tableAccess";
export { createTableExistenceProbe, revokeResetTokensForUser } from "./authConfig/tableAccess";

export type { AccountMode, AuthMode, AuthProviderInfo, Auth, SessionUser } from "./authConfig/authTypes";
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
export { enforceSessionActivity, buildSessionUser } from "./authConfig/sessionActivity";
export {
  FEDERATED_IDENTITY_V25_DEFINITION,
  migrateFederatedIdentityV25,
  ensureFederatedIdentitySchema,
  assertFederatedIdentitySchemaCurrent,
} from "./authConfig/federatedIdentitySchema";
export { runAuthMigrations, planAuthSchemaMigrations, BOOTSTRAP_ADMIN_EMAIL } from "./authConfig/bootstrapAdmin";

// Better Auth owns session, credential, and named provider sign-in. With CAPACITYLENS_MODE unset or
// `off`, authFromEnv returns before initializing Better Auth, reading credentials, or creating auth
// tables. Better Auth tables — user, session, account, and verification — share the SQLite file
// and are created by runAuthMigrations. They are not AppData entities: the entity lists (KNOWN_KEYS /
// tables.ts / sanitize) deliberately do not cover them, and db.ts wipe()/loadState()
// never touch them.

/** Misconfiguration that must refuse boot loudly (same posture as assertSchemaCurrent) —
 *  the entrypoint catches this, prints the message, and exits 1. */
export class AuthConfigError extends Error {}

// Constant-time secret compare shared by the first-run setup token and bootstrap
// token. Returns false UNLESS the configured token is a non-empty string AND the presented
// value is a non-empty string of the SAME byte length whose bytes match — so an unset/empty
// token (the default) never allows the token path, and the length-equality short-circuit
// doesn't reveal the secret's length by timing (timingSafeEqual itself requires equal-length
// buffers). Headers arrive as string | string[] | undefined from Fastify, or string | null
// from a Better Auth ctx; `unknown` covers both — only a single string can match.
export function isMatchingSecretToken(configured: string | undefined, presented: unknown): boolean {
  if (!configured || typeof presented !== "string" || presented.length === 0) return false;
  const a = Buffer.from(configured, "utf8");
  const b = Buffer.from(presented, "utf8");
  // timingSafeEqual throws on a length mismatch — guard first; an attacker learns only "wrong
  // length" (already observable from the response), not the secret's bytes.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Admin-issued password-reset links.
// Admin requests capture the token instead of emailing it, preserving the write-once copy-link
// flow. Public requests use optional SMTP. Better Auth owns token storage, expiry, single-use
// consumption and the public POST /api/auth/reset-password redeem endpoint.

/**
 * Mint a single-use, {@link RESET_LINK_TTL_SECONDS}-lived password-reset token for `email` via
 * Better Auth's verification store. Returns the token, or `null` when Better Auth
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
  if (microsoftProofTableExists(db)) {
    db.prepare(
      `UPDATE microsoft_identity_proofs SET state = 'cancelled', tokenHash = NULL, updatedAt = ?
      WHERE principalId = ? AND state IN ('started', 'mail-sent', 'approved')`,
    ).run(Date.now(), principalId);
  }
}

const verificationTableExists = createTableExistenceProbe("verification");
const microsoftProofTableExists = createTableExistenceProbe("microsoft_identity_proofs");

// {@link countUsers} is consulted BEFORE runAuthMigrations as well as after it — authFromEnv makes
// its boot-time minPasswordLength decision on the pre-migration handle, where the table does not
// exist yet. Caching that pre-migration `false` would make every later per-request call read
// "zero users" forever, holding first-run sign-up open on a populated instance.
const userTableExists = createTableExistenceProbe("user");

/**
 * Count Better Auth `user` rows — the first-run signal. Zero means "no one can sign in yet", which
 * is what opens the one-time bootstrap paths: the live sign-up gate (hooks.before in
 * {@link createAuthFromEnvironment}), the `needsSetup` flag on /api/auth/me's 401, and the
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
export function listUserIdsByEmail(db: Db, email: string, limit: number): string[] {
  const rows = db.prepare(`SELECT id FROM user WHERE email = ? LIMIT ?`).all(email, limit) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function parseAuthMode(raw: string | undefined): AccountMode {
  const mode = raw === undefined || raw === "" ? "off" : raw;
  if (mode === "off" || mode === "password-only" || mode === "sso-only" || mode === "password-and-sso") return mode;
  if (mode === "password" || mode === "sso") {
    throw new AuthConfigError(
      `CAPACITYLENS_MODE=${mode} was removed. Use ${mode === "sso" ? "sso-only" : "password-only or password-and-sso (if provider sign-in is intended)"}.`,
    );
  }
  throw new AuthConfigError(
    `CAPACITYLENS_MODE must be 'off', 'password-only', 'sso-only' or 'password-and-sso' — got '${raw}'.`,
  );
}

type Env = Record<string, string | undefined>;

function readRequiredSetting(environment: Env, key: string, context: string): string {
  const value = environment[key];
  if (!value) throw new AuthConfigError(`${key} is required when ${context}.`);
  return value;
}

function isExternalIdentityPath(path: string | undefined): boolean {
  return path?.startsWith("/callback/") === true;
}

function readProviderIdFromExternalContext(context: {
  path?: string;
  params?: Record<string, unknown>;
}): string | undefined {
  const providerId = context.params?.providerId;
  if (typeof providerId === "string") return providerId;
  const id = context.params?.id;
  if (typeof id === "string") return id;
  return context.path?.split("/").filter(Boolean).at(-1);
}

export function parseProviderIdFromExternalContext(
  context:
    | {
        path?: string;
        params?: Record<string, unknown>;
      }
    | null
    | undefined,
): string | null {
  if (!isExternalIdentityPath(context?.path)) return null;
  // Better Auth's database-hook context uses the route template as `path` and carries the concrete
  // provider in params. Older/custom adapters may provide a concrete path instead, so retain that
  // safe fallback while explicitly refusing template placeholders.
  if (!context) return null;
  const value = readProviderIdFromExternalContext(context);
  if (!value || value.startsWith(":")) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed percent escape is attacker-controlled path input, not an internal failure.
    // Returning no provider keeps assurance fail-closed while Better Auth renders its normal 4xx.
    return null;
  }
}

/** Verify and maintain CapacityLens's versioned first-owner claim control after application
 * migrations have succeeded. Schema changes belong exclusively to the application migration ledger. */
export function ensureAuthControlTables(db: Db, environment: Env): void {
  // Open registration applies only to email credentials. A first external identity still needs
  // the single-winner bootstrap claim, so this table is required in both registration postures.
  // Keep `env` in the signature because auth setup deliberately shares the same contract as the
  // other auth controls, even though this control is unconditional in auth-on.
  void environment;
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

export const createAuthFromEnvironment = createAuthFromEnvironmentFactory({
  AuthConfigError,
  parseAuthMode,
  required: readRequiredSetting,
  isSqliteConstraintCollision,
  providerIdFromExternalContext: parseProviderIdFromExternalContext,
  countUsers,
  externalIdentityPath: isExternalIdentityPath,
  secretTokenMatches: isMatchingSecretToken,
  ensureAuthControlTables,
  createAuthAdapter: createAuthAdapterFactory({
    revokeFederatedLinkStateInTx,
    AuthConfigError,
    providerIdFromExternalContext: parseProviderIdFromExternalContext,
  }),
});

export const createBootstrapAdmin = createBootstrapAdminFactory({
  AuthConfigError,
  countUsers,
  isSqliteConstraintCollision,
});

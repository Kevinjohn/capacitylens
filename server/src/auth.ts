import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import type { SocialProviders } from "better-auth/social-providers";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_PASSWORD_INPUT_CODE_UNITS,
  passwordLengthFailure,
} from "@capacitylens/shared/domain/password";
import { cleanText } from "@capacitylens/shared/lib/strings";
import { APP_NAME } from "@capacitylens/shared/brand";
import type { AccountMode, BoundApplication } from "@capacitylens/shared/account/types";
import { boundApplicationFailure } from "@capacitylens/shared/account/validation";
import {
  ACCOUNT_SESSION_ABSOLUTE_TTL_SECONDS,
  ACCOUNT_SESSION_FRESH_AGE_SECONDS,
} from "@capacitylens/shared/account/sessionPolicy";
import type { Db } from "./db";
import { assertBootstrapClaimCurrent } from "./bootstrapClaim";
import { accountConfigKey, resolveAccountEnvironment } from "./accountConfig";
import { createStrictOidcClient, StrictOidcVerificationError, type StrictOidcClient } from "./strictOidc";
import {
  PASSWORD_CONTEXT_WORDS,
  PasswordPolicyDependencyError,
  PasswordPolicyError,
  assertNoContextSpecificPassword,
  assertPasswordNotBreached,
  scryptPasswordHasher,
  type PasswordHasher,
} from "./passwordSecurity";
import { WorkQueueFullError } from "./workQueue";
import { bindFederatedProvider, recordSessionAssurance, removeSessionAssurance } from "./accounts/state";
import { applicationSessionHandle } from "./accounts/sessionHandle";
import { tx } from "./txn";
import {
  createFederatedLinkCeremony,
  deleteFederatedLinkCeremony,
  reconcileObservedFederatedLinks,
  type ObservedFederatedLink,
} from "./federatedLinkLifecycle";

/** Translate password-work backpressure before Better Auth can mistake it for a credential verdict
 * or an undifferentiated internal error. Malformed hashes still resolve false inside the hasher. */
export async function verifyPasswordWithBackpressure(
  hasher: PasswordHasher,
  input: Parameters<PasswordHasher["verify"]>[0],
): Promise<boolean> {
  try {
    return await hasher.verify(input);
  } catch (error) {
    if (error instanceof WorkQueueFullError) {
      throw APIError.from("SERVICE_UNAVAILABLE", {
        message: error.message,
        code: "PASSWORD_PROCESSING_UNAVAILABLE",
      });
    }
    throw error;
  }
}

/** Apply the same retryable boundary to new hashes; queue pressure is availability, not an
 * unclassified authentication failure. */
export async function hashPasswordWithBackpressure(hasher: PasswordHasher, password: string): Promise<string> {
  try {
    return await hasher.hash(password);
  } catch (error) {
    if (error instanceof WorkQueueFullError) {
      throw APIError.from("SERVICE_UNAVAILABLE", {
        message: error.message,
        code: "PASSWORD_PROCESSING_UNAVAILABLE",
      });
    }
    throw error;
  }
}

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

/** @deprecated Prefer the provider-neutral AccountMode outside the identity adapter. */
export type AuthMode = AccountMode;

/** Public, non-secret provider metadata exposed by `/api/auth/me` so the login screen never
 * hardcodes a provider id or advertises a provider the server did not configure. Every external
 * named social providers remain experimental; the strict generic OIDC path is first-class. */
export interface AuthProviderInfo {
  id: string;
  label: string;
  kind: "social" | "oidc";
  experimental: boolean;
}

/** The narrow Better Auth surface the server actually uses. betterAuth()'s concrete
 *  return type is invariant in its options generic (a plugin-parametrised instantiation
 *  won't assign to Auth<BetterAuthOptions>), so authFromEnv collapses it to this
 *  structural interface once at creation — everything downstream stays decoupled from
 *  the library's generics. */
export interface Auth {
  /** Web-standard Request → Response handler, mounted at /api/auth/* when mode ≠ off. */
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (input: { headers: Headers }) => Promise<{
      user: SessionUser;
      session?: {
        id: string;
        createdAt: string;
        expiresAt: string | null;
      };
    } | null>;
    /** Better Auth's server-side reset-token mint (P1.18) — call it ONLY through
     *  {@link mintPasswordResetToken}, which provides the AsyncLocalStorage capture context the
     *  sendResetPassword callback delivers the token into. Anti-enumeration by design: it resolves
     *  with a generic success whether or not the email matched a user. */
    requestPasswordReset: (input: { body: { email: string } }) => Promise<unknown>;
  };
  /** Resolved options — what getMigrations needs to create the auth tables. */
  options: BetterAuthOptions;
  /** Configured external identity providers, safe to return to unauthenticated clients. */
  providers: AuthProviderInfo[];
  /** Configured upstream issuer for each local provider alias. Used for `(issuer, subject)` keys. */
  federatedIssuers: ReadonlyMap<string, string>;
  /** The one strict OIDC provider used by the supported SSO cutover ceremony. */
  strictProvider?: AuthProviderInfo | null;
  /** Validate and persist immutable issuer-to-provider aliases after app migrations complete. */
  ensureProviderBindings: () => void;
  /** Verify every configured issuer/provider alias without writing (operator preflight). */
  assertProviderBindings?: () => void;
  /** Create a user + credential account as one SQLite transaction, bypassing the
   *  public sign-up ROUTE entirely (and with it, the route's minPasswordLength check —
   *  internalAdapter.createUser never validates password shape, only the sign-up.mjs handler
   *  does). This is why the instance-wide minPasswordLength floor no longer needs to be bent for
   *  the bootstrap boot (see the comment on minPasswordLength below authFromEnv).
   *
   *  Deliberately the ONLY way to reach Better Auth's internalAdapter from outside this module —
   *  earlier this exposed hashPassword/createUser/linkAccount as three independently callable
   *  methods, an interface shape that invited a future caller to create a user with no credential
   *  (an orphaned row that permanently locks out the bootstrap: {@link countUsers} > 0 forever,
   *  with no sign-in-able account). This method owns hash → user → credential-link sequencing
   *  and the transaction boundary, so that hazard can't recur. An optional local correlation
   *  callback joins another same-database write (the invitation command's principal coordinate)
   *  to that transaction. Resolves once Better Auth's async init context ($context) is ready;
   *  nothing else should call it — every other caller goes through the narrow api surface above.
   *
   *  @throws when hashing or any transaction participant fails; SQLite rolls every credential and
   *  correlation write back before the failure escapes.
   */
  createCredentialUser: (
    email: string,
    name: string,
    password: string,
    emailVerified?: boolean,
    correlateInTransaction?: (principalId: string) => void,
  ) => Promise<{ id: string }>;
  /** Remove a just-created credential identity when a later invite claim cannot commit. */
  deleteCredentialUser: (userId: string) => Promise<void>;
  /** Revoke every active session for a user (administrator offboarding/compromise response). */
  revokeUserSessions: (userId: string) => Promise<void>;
  /** Start the only supported explicit identity-link ceremony. The raw provider route remains
   * shadowed at the HTTP adapter, so freshness and provider policy cannot be bypassed. */
  beginFederatedLink?: (input: {
    headers: Headers;
    principalId: string;
    callbackURL: string;
    errorCallbackURL: string;
  }) => Promise<{ url: string; setCookies: string[] }>;
  /** Finish any callback that committed before its audit/observation transaction completed. */
  reconcileFederatedLinks?: () => void;
}

/** The identity attached to every request in 'off' mode — the seam Stage C will later
 *  replace with the session user to derive accountId server-side. Off is trusted-local, so
 *  the synthetic principal is treated as verified (`emailVerified: true`) and given a clearly
 *  non-routable `.local` demo email so nothing mistakes it for a real verified identity. */
export const DEMO_USER: SessionUser = {
  id: "demo",
  name: "Demo",
  email: "demo@capacitylens.local",
  emailVerified: true,
  twoFactorEnabled: true,
  image: null,
};

export const DEFAULT_ACCOUNT_APPLICATION: BoundApplication = {
  applicationId: "capacitylens",
  displayName: APP_NAME,
  branding: {
    totpIssuer: APP_NAME,
    passwordContextWords: PASSWORD_CONTEXT_WORDS,
    defaultProviderLabel: "Single sign-on",
  },
};

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
  id: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled?: boolean;
  name: string;
  /** The IdP-asserted avatar URL (OIDC `picture` claim) mapped into Better Auth's `user.image`
   *  column. Already https-validated at capture time by strictOidc's `optionalPictureUrl`; `null`
   *  for accounts/providers that carry no picture. */
  image: string | null;
  /** Server-only freshness input for step-up checks; never used as an authenticator. */
  sessionCreatedAt?: string;
}

/** The subset of Better Auth's user we read before narrowing to {@link SessionUser}. Better
 *  Auth types `emailVerified` as a boolean it sets per provider; the optional/`null` here is
 *  the safety net for a provider/version that leaves it unset. */
interface RawSessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean | null;
  twoFactorEnabled?: boolean | null;
  image?: string | null;
}

/** Parse a stored `session.updatedAt` without assuming its representation: Better Auth's
 *  node:sqlite adapter stores ISO-8601 text (the column is declared `date`, NUMERIC affinity),
 *  while test fixtures historically wrote integer epoch milliseconds. Anything else is NaN,
 *  which every caller treats as fail-closed. */
function parseSessionTimestamp(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  return Number.NaN;
}

/**
 * Apply the app's idle timeout to a session Better Auth has already resolved.
 *
 * STORAGE REPRESENTATION IS NOT ASSUMED. Better Auth 1.6.x on node:sqlite stores
 * `session.updatedAt` as ISO-8601 *text*, not the integer epoch milliseconds an earlier
 * version of this function trusted a comment about. Comparing or writing numbers against a
 * text-valued column means SQL predicates silently never match (INTEGER always sorts before
 * TEXT), which turned both the expiry compare-and-set and the activity touch into no-ops on
 * production rows. So: read the raw stored value, parse whatever is there, compare-and-set
 * against the RAW value, and write back in the SAME representation that is stored. Direct
 * conditional SQL is required because the adapter exposes only unconditional async writes and
 * cannot provide compare-and-set; the CAS keeps deletes and touches monotonic even when
 * overlapping requests settle out of order. Fails closed (row deleted, `null` returned) on an
 * unparseable timestamp.
 */
export async function enforceSessionActivity<
  Session extends {
    session: { token: string; updatedAt: Date | string };
  },
>(session: Session, db: Db): Promise<Session | null> {
  const token = session.session.token;
  const readRaw = (): { updatedAt: string | number | null } | undefined =>
    db.prepare(`SELECT updatedAt FROM session WHERE token = ?`).get(token) as
      { updatedAt: string | number | null } | undefined;
  const destroy = (): null => {
    db.prepare(`DELETE FROM session WHERE token = ?`).run(token);
    return null;
  };
  const lastActivity = new Date(session.session.updatedAt).getTime();
  const now = Date.now();
  const elapsed = now - lastActivity;
  if (!Number.isFinite(lastActivity) || elapsed < 0 || elapsed >= SESSION_INACTIVITY_TTL_SECONDS * 1000) {
    if (!Number.isFinite(lastActivity)) return destroy();
    const row = readRaw();
    if (!row) return null;
    const rowMs = parseSessionTimestamp(row.updatedAt);
    if (!Number.isFinite(rowMs)) return destroy();
    if (rowMs === lastActivity) {
      const removed = db
        .prepare(`DELETE FROM session WHERE token = ? AND updatedAt = ?`)
        .run(token, row.updatedAt as string | number);
      if (removed.changes >= 1) return null;
      // Lost a race to a concurrent touch between the read and the delete — re-read it.
      const current = readRaw();
      if (!current) return null;
      const currentMs = parseSessionTimestamp(current.updatedAt);
      if (!Number.isFinite(currentMs)) return destroy();
      session.session.updatedAt = new Date(currentMs);
      return session;
    }
    // A concurrent request touched the row after this request resolved its session.
    // Adopt that newer activity instead of deleting it from a stale snapshot.
    session.session.updatedAt = new Date(rowMs);
    return session;
  }
  if (elapsed >= SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS * 1000) {
    const row = readRaw();
    if (!row) return null;
    const rowMs = parseSessionTimestamp(row.updatedAt);
    if (!Number.isFinite(rowMs)) return destroy();
    let adopted = rowMs;
    if (rowMs < now) {
      const next: string | number = typeof row.updatedAt === "number" ? now : new Date(now).toISOString();
      const touched = db
        .prepare(`UPDATE session SET updatedAt = ? WHERE token = ? AND updatedAt = ?`)
        .run(next, token, row.updatedAt as string | number);
      if (touched.changes >= 1) adopted = now;
      else {
        // A concurrent touch won the CAS; adopt whatever it wrote.
        const current = readRaw();
        if (!current) return null;
        const currentMs = parseSessionTimestamp(current.updatedAt);
        if (!Number.isFinite(currentMs)) return destroy();
        adopted = currentMs;
      }
    }
    session.session.updatedAt = new Date(adopted);
  }
  return session;
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
  const name = cleanText(typeof raw.name === "string" ? raw.name : "");
  return {
    id: raw.id,
    email: raw.email,
    emailVerified: raw.emailVerified ?? false,
    twoFactorEnabled: raw.twoFactorEnabled === true,
    name: name || "User",
    image: normalizeImageUrl(raw.image),
  };
}

/** `user.image` is only ever written by strictOidc's `optionalPictureUrl` (https-only, no embedded
 *  credentials, ≤2048 chars — see server/src/strictOidc.ts), so a stored value is already validated.
 *  This backstop re-asserts the https invariant at the narrowing boundary so a non-https value (a
 *  hand-edited row, a future writer) can never reach the client as an `<img src>`. */
function normalizeImageUrl(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("https://") ? value : null;
}

/** Misconfiguration that must refuse boot loudly (same posture as assertSchemaCurrent) —
 *  the entrypoint catches this, prints the message, and exits 1. */
export class AuthConfigError extends Error {}

/** Constant-time comparison for the first-run setup secret. Empty/unset secrets never match. */
function setupTokenMatches(configured: string | undefined, presented: string | null): boolean {
  if (!configured || !presented) return false;
  const expected = Buffer.from(configured, "utf8");
  const actual = Buffer.from(presented, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ── Admin-issued password-reset links (P1.18) ──────────────────────────────────────────────────
// CapacityLens deliberately has NO email infrastructure (docs/security/privacy.md — a standing
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
export const RESET_LINK_TTL_SECONDS = 60 * 60 * 24;
/** A session can never outlive this wall-clock duration, regardless of activity. */
export const SESSION_ABSOLUTE_TTL_SECONDS = ACCOUNT_SESSION_ABSOLUTE_TTL_SECONDS;
export const SESSION_FRESH_AGE_SECONDS = ACCOUNT_SESSION_FRESH_AGE_SECONDS;
/** Re-authentication is required after this much server-observed inactivity. */
export const SESSION_INACTIVITY_TTL_SECONDS = 30 * 60;
/** Bound session activity writes while keeping idle expiry accurate to within one minute. */
export const SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS = 60;

/** Reserved v25 index enforcing one principal for each external provider subject. */
export const FEDERATED_SUBJECT_UNIQUE_INDEX = "idx_account_provider_subject_unique";
/** Reserved v25 index enforcing one subject per provider for each local principal. */
export const FEDERATED_PRINCIPAL_PROVIDER_UNIQUE_INDEX = "idx_account_principal_provider_unique";
/** Reserved v25 trigger that atomically records newly admitted external provider rows. */
export const FEDERATED_OBSERVATION_TRIGGER = "capacitylens_observe_federated_account";

/** Unreleased v25 application migration definition. The CapacityLens-owned tables make provider
 * callbacks recoverable and their audits at-least-once. The account indexes close Better Auth's
 * subject and per-principal find-then-create races; the trigger records a verified external row in
 * the same SQLite statement that creates it, including direct OIDC admissions. */
export const FEDERATED_IDENTITY_V25_DEFINITION = `
CREATE TABLE IF NOT EXISTS capacitylens_federated_link_ceremonies (
  id TEXT NOT NULL PRIMARY KEY,
  principalId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  completedAt TEXT
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_capacitylens_federated_link_ceremonies_principal
  ON capacitylens_federated_link_ceremonies(principalId, providerId);
CREATE TABLE IF NOT EXISTS capacitylens_federated_link_observations (
  accountRowId TEXT NOT NULL PRIMARY KEY,
  principalId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  subject TEXT NOT NULL,
  verifiedAt TEXT NOT NULL,
  auditedAt TEXT,
  UNIQUE(providerId, subject)
) STRICT;
CREATE TABLE IF NOT EXISTS capacitylens_sso_cutover_state (
  applicationId TEXT NOT NULL PRIMARY KEY,
  activatedAt TEXT NOT NULL
) STRICT;
guard:sqlite_master(account):reject-duplicate-provider-coordinates:v2
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider_subject_unique ON account(providerId, accountId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_principal_provider_unique ON account(userId, providerId);
CREATE TRIGGER IF NOT EXISTS capacitylens_observe_federated_account
AFTER INSERT ON account
WHEN NEW.providerId <> 'credential'
BEGIN
  INSERT INTO capacitylens_federated_link_observations
    (accountRowId, principalId, providerId, subject, verifiedAt, auditedAt)
  VALUES (NEW.id, NEW.userId, NEW.providerId, NEW.accountId, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL);
END;
`;

function federatedObservationTriggerSql(): string {
  const marker = `CREATE TRIGGER IF NOT EXISTS ${FEDERATED_OBSERVATION_TRIGGER}`;
  const start = FEDERATED_IDENTITY_V25_DEFINITION.indexOf(marker);
  if (start < 0) throw new Error("The v25 identity definition is missing its observation trigger.");
  return FEDERATED_IDENTITY_V25_DEFINITION.slice(start).trim();
}

/** SQLite removes IF NOT EXISTS from sqlite_master but otherwise retains the trigger definition. */
function expectedStoredFederatedObservationTriggerSql(): string {
  return federatedObservationTriggerSql()
    .replace(/^CREATE TRIGGER IF NOT EXISTS\s+/, "CREATE TRIGGER ")
    .replace(/;\s*$/, "");
}

function normalizeSchemaSql(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sqliteTableExists(db: Db, table: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== undefined;
}

/** Immutable implementation shared by the unreleased v25 ledger step and its same-version
 * post-Better-Auth repair pass. Future schema versions must compose a new helper rather than edit
 * this one, preserving the shipped migration definition and behavior together. */
function installFederatedIdentityV25(db: Db): void {
  db.exec(
    FEDERATED_IDENTITY_V25_DEFINITION.slice(
      0,
      FEDERATED_IDENTITY_V25_DEFINITION.indexOf("guard:sqlite_master(account)"),
    ),
  );
  if (!sqliteTableExists(db, "account")) return;

  const duplicate = db
    .prepare(
      `SELECT a.providerId, a.accountId, GROUP_CONCAT(a.userId, ', ') AS principalIds,
              GROUP_CONCAT(COALESCE(u.email, a.userId), ', ') AS people
         FROM account AS a
         LEFT JOIN user AS u ON u.id = a.userId
        GROUP BY a.providerId, a.accountId
       HAVING COUNT(*) > 1
        LIMIT 1`,
    )
    .get() as { providerId: string; accountId: string; principalIds: string; people: string } | undefined;
  if (duplicate) {
    throw new Error(
      `Federated subject duplication blocks the SSO migration — provider ${duplicate.providerId}, ` +
        `subject ${duplicate.accountId}, principals ${duplicate.principalIds} (${duplicate.people}). ` +
        "Reconcile the incorrect provider link before retrying.",
    );
  }
  const repeatedProvider = db
    .prepare(
      `SELECT a.userId, a.providerId, GROUP_CONCAT(a.accountId, ', ') AS subjects,
              COALESCE(u.email, a.userId) AS person
         FROM account AS a
         LEFT JOIN user AS u ON u.id = a.userId
        GROUP BY a.userId, a.providerId
       HAVING COUNT(*) > 1
        LIMIT 1`,
    )
    .get() as { userId: string; providerId: string; subjects: string; person: string } | undefined;
  if (repeatedProvider) {
    throw new Error(
      `Multiple provider links block the SSO migration — principal ${repeatedProvider.userId} ` +
        `(${repeatedProvider.person}), provider ${repeatedProvider.providerId}, subjects ${repeatedProvider.subjects}. ` +
        "Remove the incorrect exact provider row before retrying.",
    );
  }

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${FEDERATED_SUBJECT_UNIQUE_INDEX} ON account(providerId, accountId);`);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${FEDERATED_PRINCIPAL_PROVIDER_UNIQUE_INDEX} ON account(userId, providerId);`,
  );
  db.exec(federatedObservationTriggerSql());
}

/** Apply only the frozen v25 identity migration. */
export function migrateFederatedIdentityV25(db: Db): void {
  installFederatedIdentityV25(db);
}

/** Install/verify the current application-owned backstop around Better Auth's provider-account
 * table. App migrations run before Better Auth creates tables on a fresh auth-enabled database,
 * so this is deliberately idempotent and is also called immediately after auth migrations. */
export function ensureFederatedIdentitySchema(db: Db): void {
  installFederatedIdentityV25(db);
}

/** Fail unless every v25 identity table, index, and trigger has the exact owned shape. */
export function assertFederatedIdentitySchemaCurrent(db: Db): void {
  const expectedTables = new Map([
    [
      "capacitylens_federated_link_ceremonies",
      [
        ["id", "TEXT", 1, 1],
        ["principalId", "TEXT", 1, 0],
        ["providerId", "TEXT", 1, 0],
        ["createdAt", "TEXT", 1, 0],
        ["expiresAt", "TEXT", 1, 0],
        ["completedAt", "TEXT", 0, 0],
      ],
    ],
    [
      "capacitylens_federated_link_observations",
      [
        ["accountRowId", "TEXT", 1, 1],
        ["principalId", "TEXT", 1, 0],
        ["providerId", "TEXT", 1, 0],
        ["subject", "TEXT", 1, 0],
        ["verifiedAt", "TEXT", 1, 0],
        ["auditedAt", "TEXT", 0, 0],
      ],
    ],
    [
      "capacitylens_sso_cutover_state",
      [
        ["applicationId", "TEXT", 1, 1],
        ["activatedAt", "TEXT", 1, 0],
      ],
    ],
  ] as const);
  for (const [table, expectedColumns] of expectedTables) {
    const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as
      { sql: string } | undefined;
    if (!schema) throw new Error(`DB identity schema is missing ${table}.`);
    const columns = (
      db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>
    ).map(({ name, type, notnull, pk }) => [name, type, notnull, pk]);
    if (JSON.stringify(columns) !== JSON.stringify(expectedColumns) || !/\)\s*STRICT\s*$/i.test(schema.sql)) {
      throw new Error(`DB identity schema has an invalid ${table} definition.`);
    }
  }
  const ceremonyIndexes = db.prepare(`PRAGMA index_list(capacitylens_federated_link_ceremonies)`).all() as Array<{
    name: string;
    unique: number;
  }>;
  const ceremonyColumns = db
    .prepare(`PRAGMA index_info(idx_capacitylens_federated_link_ceremonies_principal)`)
    .all() as Array<{ name: string }>;
  if (
    !ceremonyIndexes.some(
      ({ name, unique }) => name === "idx_capacitylens_federated_link_ceremonies_principal" && unique === 1,
    ) ||
    ceremonyColumns.map(({ name }) => name).join(",") !== "principalId,providerId"
  ) {
    throw new Error("DB identity schema has an invalid federated-link ceremony index definition.");
  }
  const observationIndexes = db.prepare(`PRAGMA index_list(capacitylens_federated_link_observations)`).all() as Array<{
    name: string;
    unique: number;
    origin: string;
  }>;
  const hasProviderSubjectConstraint = observationIndexes.some(({ name, unique, origin }) => {
    if (unique !== 1 || origin !== "u") return false;
    const columns = db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name: string }>;
    return columns.map(({ name: column }) => column).join(",") === "providerId,subject";
  });
  if (!hasProviderSubjectConstraint) {
    throw new Error("DB identity schema is missing the provider-subject observation constraint.");
  }
  if (!sqliteTableExists(db, "account")) return;
  const accountIndexes = db.prepare(`PRAGMA index_list(account)`).all() as Array<{ name: string; unique: number }>;
  for (const [indexName, expectedColumns] of [
    [FEDERATED_SUBJECT_UNIQUE_INDEX, "providerId,accountId"],
    [FEDERATED_PRINCIPAL_PROVIDER_UNIQUE_INDEX, "userId,providerId"],
  ] as const) {
    const columns = db.prepare(`PRAGMA index_info(${indexName})`).all() as Array<{ name: string }>;
    const unique = accountIndexes.some((index) => index.name === indexName && index.unique === 1);
    if (!unique || columns.map(({ name }) => name).join(",") !== expectedColumns) {
      throw new Error(`DB identity schema has an invalid ${indexName} definition.`);
    }
  }
  const trigger = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`)
    .get(FEDERATED_OBSERVATION_TRIGGER) as { sql: string } | undefined;
  if (
    !trigger ||
    normalizeSchemaSql(trigger.sql) !== normalizeSchemaSql(expectedStoredFederatedObservationTriggerSql())
  ) {
    throw new Error(`DB identity schema has an invalid ${FEDERATED_OBSERVATION_TRIGGER} definition.`);
  }
}

/** Identity-adapter-owned read that proves an observation still names the exact live provider
 * account row before the lifecycle service emits its durable audit. */
function verifiedUnauditedFederatedLinks(db: Db): readonly ObservedFederatedLink[] {
  return db
    .prepare(
      `SELECT observation.accountRowId, observation.principalId, observation.providerId,
              observation.subject, observation.verifiedAt
         FROM capacitylens_federated_link_observations AS observation
         JOIN account AS providerAccount
           ON providerAccount.id = observation.accountRowId
          AND providerAccount.userId = observation.principalId
          AND providerAccount.providerId = observation.providerId
          AND providerAccount.accountId = observation.subject
        WHERE observation.auditedAt IS NULL
        ORDER BY observation.verifiedAt, observation.accountRowId`,
    )
    .all() as unknown as ObservedFederatedLink[];
}

/** Per-call capture context for {@link mintPasswordResetToken}. AsyncLocalStorage (not a module
 *  variable) so two concurrent admin resets can never swap tokens across their await chains, and
 *  so a PUBLIC call to POST /api/auth/request-password-reset — which Better Auth exposes once
 *  sendResetPassword is configured — finds NO store and the token goes nowhere (that public route
 *  is inert-by-design here: no email is ever sent, and its anti-enumeration response is unchanged). */
const resetTokenCapture = new AsyncLocalStorage<{ token: string | null }>();

/** Better Auth converts adapter exceptions into a generic 500 Response before its public handler
 * resolves. Capture the exact request-local exception so the callback seam can distinguish the
 * two federated-account uniqueness races from unrelated provider or network failures. */
const authHandlerErrorCapture = new AsyncLocalStorage<{ error: unknown }>();

function isFederatedAccountCoordinateConstraint(error: unknown): boolean {
  const sqlite = error as { code?: unknown; errcode?: unknown; message?: unknown };
  const constraint =
    sqlite?.errcode === 19 ||
    sqlite?.errcode === 2067 ||
    (typeof sqlite?.code === "string" && sqlite.code.startsWith("SQLITE_CONSTRAINT"));
  return (
    constraint &&
    typeof sqlite.message === "string" &&
    sqlite.message.includes("account.providerId") &&
    (sqlite.message.includes("account.accountId") || sqlite.message.includes("account.userId"))
  );
}

/** The `emailAndPassword.sendResetPassword` hook: deliver the token to the capturing admin route
 *  (if any) instead of emailing it. Never throws — a throw here would surface as a Better Auth
 *  background-task error log, not a useful signal. */
async function captureResetToken({ token }: { token: string }): Promise<void> {
  const store = resetTokenCapture.getStore();
  if (store) store.token = token;
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
 * Per-handle cache of whether Better Auth's `verification` table exists, so the sqlite_master probe
 * runs at most ONCE per Db handle instead of on every membership write (the sole caller,
 * upsertMember, hits this on each role change / invite accept / org create).
 *
 * Cache the TRUE outcome only. Application migration v12 may probe this table before
 * runAuthMigrations creates it on the same handle when an existing auth-off database first enables
 * password auth. Caching that pre-auth `false` would permanently suppress reset-token revocation for
 * the rest of the process. Absence is therefore re-probed until the table appears; presence is fixed.
 *
 * WeakMap keyed by the Db handle: an entry is collected with its handle, so tests that spin up many
 * short-lived in-memory handles don't leak.
 */
const verificationTablePresence = new WeakMap<Db, true>();

function verificationTableExists(db: Db): boolean {
  if (verificationTablePresence.get(db)) return true;
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'verification'`).get() as
    { name?: string } | undefined;
  const exists = row?.name === "verification";
  if (exists) verificationTablePresence.set(db, true);
  return exists;
}

/**
 * Per-handle cache of whether Better Auth's `user` table exists — caches the TRUE outcome ONLY,
 * like {@link verificationTablePresence}. The reason is the same:
 * {@link countUsers} is consulted BEFORE runAuthMigrations as well as after it — authFromEnv makes
 * its boot-time minPasswordLength decision on the pre-migration handle, where the table does not
 * exist yet. Caching that pre-migration `false` would make every later per-request call read
 * "zero users" forever, holding first-run sign-up open on a populated instance — the exact stale-
 * `false` hazard described above. So absence is re-probed every
 * call (cheap: one sqlite_master lookup, and only until the table appears); presence, once true,
 * is fixed for the life of the handle (nothing ever drops Better Auth's tables).
 */
const userTablePresence = new WeakMap<Db, true>();

function userTableExists(db: Db): boolean {
  if (userTablePresence.get(db)) return true;
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'`).get() as
    { name?: string } | undefined;
  const exists = row?.name === "user";
  if (exists) userTablePresence.set(db, true);
  return exists;
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

/** Better Auth signs sessions/cookies with BETTER_AUTH_SECRET — a short secret is
 *  brute-forceable, so refuse anything weaker than this. (Better Auth's own guidance and
 *  generators emit 32+ char secrets.) */
export const MIN_BETTER_AUTH_SECRET_LENGTH = 32;

function required(env: Env, key: string, context: string): string {
  const value = env[key];
  if (!value) throw new AuthConfigError(`${accountConfigKey(key)} is required when ${context}.`);
  return value;
}

function optionalPair(env: Env, idKey: string, secretKey: string, label: string): [string, string] | null {
  const id = env[idKey];
  const secret = env[secretKey];
  if (!id && !secret) return null;
  if (!id || !secret) {
    throw new AuthConfigError(
      `${accountConfigKey(idKey)} and ${accountConfigKey(secretKey)} must both be set to enable ${label}.`,
    );
  }
  return [id, secret];
}

function secureProviderUrl(env: Env, key: string): string | undefined {
  const raw = env[key]?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new AuthConfigError(`${accountConfigKey(key)} must be an absolute URL.`, { cause });
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new AuthConfigError(
      `${accountConfigKey(key)} must use https:// (loopback http:// is allowed for development).`,
    );
  }
  if (url.username || url.password) {
    throw new AuthConfigError(`${accountConfigKey(key)} must not contain URL credentials.`);
  }
  // Issuer identifiers are exact strings in OIDC. URL#toString() adds a trailing slash to a bare
  // origin, which would turn a correct configured `https://idp.example` issuer into a different
  // identity namespace and reject otherwise matching discovery metadata. Validate through URL,
  // but preserve the operator's trimmed value verbatim for protocol comparison.
  return raw;
}

/** Native social providers assembled from env. Unset pairs are absent; a partial pair refuses
 * startup. New external identities are separately verified and invite-gated in the database hook. */
function socialProvidersFromEnv(env: Env): SocialProviders {
  const providers: SocialProviders = {};
  const google = optionalPair(
    env,
    "CAPACITYLENS_GOOGLE_CLIENT_ID",
    "CAPACITYLENS_GOOGLE_CLIENT_SECRET",
    "Google sign-in",
  );
  if (google) providers.google = { clientId: google[0], clientSecret: google[1] };
  const microsoft = optionalPair(
    env,
    "CAPACITYLENS_MICROSOFT_CLIENT_ID",
    "CAPACITYLENS_MICROSOFT_CLIENT_SECRET",
    "Microsoft sign-in",
  );
  if (microsoft) {
    // tenantId defaults to 'common' (multi-tenant) when not pinned to a single Entra tenant.
    providers.microsoft = {
      clientId: microsoft[0],
      clientSecret: microsoft[1],
      tenantId: env.CAPACITYLENS_MICROSOFT_TENANT_ID || "common",
    };
  }
  const github = optionalPair(
    env,
    "CAPACITYLENS_GITHUB_CLIENT_ID",
    "CAPACITYLENS_GITHUB_CLIENT_SECRET",
    "GitHub sign-in",
  );
  if (github) providers.github = { clientId: github[0], clientSecret: github[1] };
  return providers;
}

// Provider ids are persisted as part of an external identity's namespace. Generic OIDC must not
// claim an id owned by a built-in sign-in method or one of CapacityLens' installed auth plugins:
// enabling that method later would otherwise reinterpret existing accounts or overwrite issuer
// routing. Keep this list aligned with socialProvidersFromEnv() and the plugins assembled below.
const RESERVED_GENERIC_PROVIDER_IDS = new Set([
  "credential",
  "generic-oauth",
  "two-factor",
  "google",
  "microsoft",
  "github",
]);

function externalProviderInfo(
  env: Env,
  genericProviderId: string | null,
  defaultProviderLabel: string,
): AuthProviderInfo[] {
  const providers: AuthProviderInfo[] = [];
  if (env.CAPACITYLENS_GOOGLE_CLIENT_ID && env.CAPACITYLENS_GOOGLE_CLIENT_SECRET) {
    providers.push({
      id: "google",
      label: "Google",
      kind: "social",
      experimental: true,
    });
  }
  if (env.CAPACITYLENS_MICROSOFT_CLIENT_ID && env.CAPACITYLENS_MICROSOFT_CLIENT_SECRET) {
    providers.push({
      id: "microsoft",
      label: "Microsoft",
      kind: "social",
      experimental: true,
    });
  }
  if (env.CAPACITYLENS_GITHUB_CLIENT_ID && env.CAPACITYLENS_GITHUB_CLIENT_SECRET) {
    providers.push({
      id: "github",
      label: "GitHub",
      kind: "social",
      experimental: true,
    });
  }
  if (genericProviderId) {
    providers.push({
      id: genericProviderId,
      label: env.CAPACITYLENS_SSO_LABEL?.trim() || defaultProviderLabel,
      kind: "oidc",
      experimental: false,
    });
  }
  return providers;
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
  opts: {
    trustedOrigins?: string[];
    deferDatabaseSetup?: boolean;
    application?: BoundApplication;
    /** Account-boundary admission decision for a prospective external local principal. Omission
     * fails closed; ordinary sign-in for an already-linked principal does not use this hook. */
    externalIdentityAdmission?: (candidate: { email?: string; emailVerified?: boolean }) => boolean | Promise<boolean>;
  } = {},
): { mode: AuthMode; auth: Auth | null } {
  const runtimeEnvironment = env.NODE_ENV ?? process.env.NODE_ENV;
  env = resolveAccountEnvironment(env, {
    ...(runtimeEnvironment === "test" ? { warn: () => {} } : {}),
  }).env;
  const mode = parseAuthMode(env.CAPACITYLENS_AUTH);
  if (mode === "off") return { mode, auth: null };
  const application = opts.application ?? DEFAULT_ACCOUNT_APPLICATION;
  const applicationFailure = boundApplicationFailure(application);
  if (applicationFailure) throw new AuthConfigError(applicationFailure);

  const secret = required(env, "BETTER_AUTH_SECRET", `SMALLSASS_ACCOUNT_MODE=${mode}`);
  // Fail closed + loud on a weak secret (message states the requirement + actual length,
  // never the secret value itself — no leak into logs/exit output).
  if (secret.length < MIN_BETTER_AUTH_SECRET_LENGTH) {
    throw new AuthConfigError(
      `SMALLSASS_ACCOUNT_SECRET must be at least ${MIN_BETTER_AUTH_SECRET_LENGTH} characters when SMALLSASS_ACCOUNT_MODE=${mode} (got ${secret.length}).`,
    );
  }
  const baseURL = required(env, "BETTER_AUTH_URL", `SMALLSASS_ACCOUNT_MODE=${mode}`);

  let publicUrl: URL;
  try {
    publicUrl = new URL(baseURL);
  } catch (cause) {
    throw new AuthConfigError("SMALLSASS_ACCOUNT_PUBLIC_URL must be an absolute http:// or https:// URL.", { cause });
  }
  if (publicUrl.protocol !== "http:" && publicUrl.protocol !== "https:") {
    throw new AuthConfigError("SMALLSASS_ACCOUNT_PUBLIC_URL must use http:// or https://.");
  }
  if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) {
    throw new AuthConfigError(
      "SMALLSASS_ACCOUNT_PUBLIC_URL must be an origin without credentials, a query string, or a fragment.",
    );
  }
  if (publicUrl.pathname !== "/" && publicUrl.pathname !== "") {
    throw new AuthConfigError("SMALLSASS_ACCOUNT_PUBLIC_URL must be an origin without a path.");
  }
  const loopbackHost =
    publicUrl.hostname === "localhost" ||
    publicUrl.hostname.endsWith(".localhost") ||
    publicUrl.hostname === "127.0.0.1" ||
    publicUrl.hostname === "[::1]";
  if (runtimeEnvironment === "production" && publicUrl.protocol !== "https:" && !loopbackHost) {
    throw new AuthConfigError(
      "SMALLSASS_ACCOUNT_PUBLIC_URL must use https:// for a non-loopback production origin; credentials and session cookies must not cross plaintext HTTP.",
    );
  }

  // Generic OAuth/OIDC is additive in password mode and exclusive in sso mode. This lets an
  // installation keep a password fallback while trialling SSO, then switch to SSO-only without
  // changing provider configuration.
  const genericSsoConfigured = Boolean(env.CAPACITYLENS_SSO_CLIENT_ID || env.CAPACITYLENS_SSO_CLIENT_SECRET);
  if (genericSsoConfigured) {
    optionalPair(env, "CAPACITYLENS_SSO_CLIENT_ID", "CAPACITYLENS_SSO_CLIENT_SECRET", "generic SSO");
  }
  if (mode === "sso" && !genericSsoConfigured) {
    throw new AuthConfigError(
      "SMALLSASS_ACCOUNT_MODE=sso requires SMALLSASS_ACCOUNT_OIDC_CLIENT_ID and SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET.",
    );
  }
  const genericProviderId = genericSsoConfigured ? env.CAPACITYLENS_SSO_PROVIDER_ID || "sso" : null;
  if (genericProviderId && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(genericProviderId)) {
    throw new AuthConfigError("SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID must match ^[a-z0-9][a-z0-9_-]{0,63}$.");
  }
  if (genericProviderId && RESERVED_GENERIC_PROVIDER_IDS.has(genericProviderId)) {
    throw new AuthConfigError(
      `SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID must not use reserved provider id "${genericProviderId}".`,
    );
  }
  const discoveryUrl = secureProviderUrl(env, "CAPACITYLENS_SSO_DISCOVERY_URL");
  const genericIssuer = secureProviderUrl(env, "CAPACITYLENS_SSO_ISSUER");
  if (genericIssuer) {
    const issuerUrl = new URL(genericIssuer);
    if (issuerUrl.search || issuerUrl.hash) {
      throw new AuthConfigError("SMALLSASS_ACCOUNT_OIDC_ISSUER must not contain a query string or fragment.");
    }
  }
  const authorizationUrl = secureProviderUrl(env, "CAPACITYLENS_SSO_AUTHORIZATION_URL");
  const tokenUrl = secureProviderUrl(env, "CAPACITYLENS_SSO_TOKEN_URL");
  const plugins: BetterAuthPlugin[] = [];
  let strictOidcClient: StrictOidcClient | null = null;
  let strictOidcAuthorizationProxyPath: string | null = null;
  if (genericProviderId) {
    if (!genericIssuer) {
      throw new AuthConfigError(
        "Strict OIDC requires SMALLSASS_ACCOUNT_OIDC_ISSUER for stable issuer-and-subject identity correlation.",
      );
    }
    const scopes = (env.CAPACITYLENS_SSO_SCOPES ?? "openid profile email").split(/\s+/).filter(Boolean);
    const missingScopes = ["openid", "profile", "email"].filter((scope) => !scopes.includes(scope));
    if (missingScopes.length > 0) {
      throw new AuthConfigError(
        `Generic OIDC requires the ${missingScopes.join(", ")} scope${missingScopes.length === 1 ? "" : "s"}.`,
      );
    }
    if (!discoveryUrl) {
      throw new AuthConfigError(
        "Strict OIDC requires SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL; endpoint-only generic OAuth is not accepted.",
      );
    }
    if (authorizationUrl || tokenUrl) {
      throw new AuthConfigError(
        "Strict OIDC endpoints must come from discovery; explicit authorization and token endpoint overrides are not accepted.",
      );
    }
    const genericClientId = required(env, "CAPACITYLENS_SSO_CLIENT_ID", "generic SSO");
    const genericClientSecret = required(env, "CAPACITYLENS_SSO_CLIENT_SECRET", "generic SSO");
    strictOidcClient = createStrictOidcClient({
      issuer: genericIssuer,
      clientId: genericClientId,
      clientSecret: genericClientSecret,
      discoveryUrl,
    });
    strictOidcAuthorizationProxyPath = `/api/auth/oidc/authorize/${genericProviderId}`;
    const oidcClient = strictOidcClient;
    plugins.push(
      genericOAuth({
        config: [
          {
            providerId: genericProviderId,
            clientId: genericClientId,
            clientSecret: genericClientSecret,
            // Do not give the generic plugin the discovery URL: it consumes discovery endpoints before
            // validating their issuer or transport. Its generated authorization request instead visits
            // our same-origin proxy below, and its code exchange delegates to the same issuer-pinned
            // metadata object. No browser redirect or client secret crosses an unvalidated endpoint.
            authorizationUrl: new URL(strictOidcAuthorizationProxyPath, publicUrl).toString(),
            // genericOAuth shape-validates a token URL while creating the authorization response even
            // when a custom getToken owns exchange. Keep that required placeholder same-origin; it is
            // never requested because getToken below always resolves the validated discovery endpoint.
            tokenUrl: new URL(`/api/auth/oidc/token/${genericProviderId}`, publicUrl).toString(),
            issuer: genericIssuer,
            // RFC 9207's authorization-response `iss` parameter is optional and is not emitted by
            // otherwise-conformant providers such as Dex. Do not make that extension a portability
            // requirement. The trust decision remains strict: discovery is issuer-pinned and
            // strictOidcUserInfo verifies the signed ID token's issuer and client audience before
            // accepting any identity claims.
            requireIssuerValidation: false,
            pkce: true,
            getToken: oidcClient.exchangeCode,
            getUserInfo: async (tokens) => {
              try {
                const profile = await oidcClient.getUserInfo(tokens);
                assertStrictOidcEmailAdmission(db, genericProviderId, profile);
                return profile;
              } catch (error) {
                if (!(error instanceof StrictOidcVerificationError)) throw error;
                console.error("Strict OIDC identity verification failed.", error);
                // generic-oauth performs its browser redirect only when getUserInfo returns no
                // profile. Preserve our stable reason in request-local state so the outer callback
                // seam can replace generic-oauth's `user_info_is_missing` redirect without
                // throwing an APIError that escapes to the browser as raw JSON.
                const capture = authHandlerErrorCapture.getStore();
                if (capture) {
                  capture.error = APIError.from("UNAUTHORIZED", {
                    message: "The identity provider response could not be verified.",
                    code: "OIDC_IDENTITY_VERIFICATION_FAILED",
                  });
                }
                return null;
              }
            },
            scopes,
          },
        ],
      }),
    );
  }
  if (mode === "password") {
    plugins.push(
      twoFactor({
        issuer: application.branding.totpIssuer,
        allowPasswordless: true,
        twoFactorCookieMaxAge: 5 * 60,
        trustDeviceMaxAge: 7 * 24 * 60 * 60,
        totpOptions: { digits: 6, period: 30, allowPasswordless: true },
        accountLockout: {
          enabled: true,
          maxFailedAttempts: 5,
          durationSeconds: 15 * 60,
        },
      }),
    );
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
  const allowOpenSignup = env.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1";
  const setupToken = env.CAPACITYLENS_SETUP_TOKEN || undefined;
  if (mode === "password" && setupToken && Buffer.byteLength(setupToken, "utf8") < 32) {
    throw new AuthConfigError("SMALLSASS_ACCOUNT_SETUP_TOKEN must be at least 32 bytes.");
  }
  // Resolve every remaining provider configuration before the first explicit database DDL below.
  // An invalid provider/URL must not leave a bootstrap-control table behind on an otherwise
  // untouched database merely because validation happened in an unfortunate order.
  const configuredSocialProviders = socialProvidersFromEnv(env);
  const configuredProviderInfo = externalProviderInfo(
    env,
    genericProviderId,
    application.branding.defaultProviderLabel,
  );
  // Experimental social providers still receive a stable issuer namespace so identity
  // correlation is always (issuer, subject), never email or a mutable display label. Generic
  // OIDC uses its actual issuer URL and remains the first-class path.
  const configuredFederatedIssuers = new Map<string, string>();
  if (configuredSocialProviders.google) configuredFederatedIssuers.set("google", "https://accounts.google.com");
  if (configuredSocialProviders.microsoft) {
    configuredFederatedIssuers.set(
      "microsoft",
      `urn:better-auth:microsoft:${env.CAPACITYLENS_MICROSOFT_TENANT_ID || "common"}`,
    );
  }
  if (configuredSocialProviders.github) configuredFederatedIssuers.set("github", "urn:better-auth:github");
  if (genericProviderId && genericIssuer) configuredFederatedIssuers.set(genericProviderId, genericIssuer);
  const acquireBootstrapClaim = (): string => {
    const claimToken = randomBytes(24).toString("base64url");
    try {
      db.prepare(`INSERT INTO capacitylens_bootstrap_claim (id, claimedAt, claimToken) VALUES (1, ?, ?)`).run(
        new Date().toISOString(),
        claimToken,
      );
      return claimToken;
    } catch (error) {
      const sqlite = error as {
        code?: unknown;
        errcode?: unknown;
        message?: unknown;
      };
      const collision =
        sqlite.errcode === 19 ||
        (typeof sqlite.code === "string" && sqlite.code.startsWith("SQLITE_CONSTRAINT")) ||
        (typeof sqlite.message === "string" && /constraint failed.*capacitylens_bootstrap_claim/i.test(sqlite.message));
      if (!collision) throw error;
      throw APIError.from("CONFLICT", {
        message: "First-owner setup is already in progress.",
        code: "BOOTSTRAP_ALREADY_IN_PROGRESS",
      });
    }
  };

  // The password floor remains unconditional, including when the optional bootstrap-owner flag
  // is active. createBootstrapAdmin generates a high-entropy password that comfortably exceeds it.

  const testRuntime = runtimeEnvironment === "test";
  if (testRuntime && !process.env.VITEST) {
    console.warn(
      "capacitylens-server: TEST credential profile active — scrypt cost is reduced and breached-password screening is disabled; never retain these credentials or expose this process.",
    );
  }
  const breachCheckEnabled = env.CAPACITYLENS_PASSWORD_BREACH_CHECK !== "off" && !testRuntime;
  const baseHasher = scryptPasswordHasher(testRuntime ? 2 ** 10 : undefined);
  const assertCredentialPasswordLength = (password: unknown): void => {
    if (typeof password !== "string") return;
    const failure = passwordLengthFailure(password);
    if (!failure) return;
    throw APIError.from(
      "BAD_REQUEST",
      failure === "too-short"
        ? {
            message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
            code: "PASSWORD_TOO_SHORT",
          }
        : {
            message: `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
            code: "PASSWORD_TOO_LONG",
          },
    );
  };
  const assertAuthRequestPasswordLength = (path: string, body: unknown): void => {
    if (typeof body !== "object" || body === null) return;
    const candidate = body as { password?: unknown; newPassword?: unknown };
    if (path === "/sign-up/email") assertCredentialPasswordLength(candidate.password);
    if (path === "/reset-password" || path === "/change-password") {
      assertCredentialPasswordLength(candidate.newPassword);
    }
  };
  const passwordHash = async (password: string): Promise<string> => {
    // Direct identity-port creation bypasses Better Auth's HTTP route guards. Keep the shared
    // Unicode code-point policy at the last common boundary before every new hash is produced.
    assertCredentialPasswordLength(password);
    try {
      assertNoContextSpecificPassword(password, application.branding.passwordContextWords);
      if (breachCheckEnabled) await assertPasswordNotBreached(password);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        throw APIError.from("BAD_REQUEST", {
          message: error.message,
          code: error.code,
        });
      }
      if (error instanceof PasswordPolicyDependencyError) {
        throw APIError.from("SERVICE_UNAVAILABLE", {
          message: error.message,
          code: error.code,
        });
      }
      throw error;
    }
    return hashPasswordWithBackpressure(baseHasher, password);
  };

  const cookiePrefix =
    publicUrl.protocol === "https:" ? `__Host-${application.applicationId}` : application.applicationId;
  const browserAuthErrorUrl = new URL("/", publicUrl);
  browserAuthErrorUrl.searchParams.set("externalSignInError", "1");

  const instance = betterAuth({
    database: db, // node:sqlite DatabaseSync — same file as the app data (see header)
    secret,
    baseURL,
    basePath: "/api/auth",
    // OAuth/OIDC callback failures are browser navigations, not JSON API calls. Route them back to
    // the product's sign-in wall, which renders one stable non-sensitive message and removes the
    // provider-controlled query values. Per-flow errorCallbackURL values preserve invite routes.
    onAPIError: {
      errorURL: browserAuthErrorUrl.toString(),
      onError(error) {
        const capture = authHandlerErrorCapture.getStore();
        if (capture) capture.error = error;
        // Supplying onError replaces Better Auth's default logger, so retain a breadcrumb for the
        // dependency failures that it has already normalized to a generic response.
        if (!(error instanceof APIError)) console.error("Better Auth request failed.", error);
      },
    },
    // Better Auth defaults verification identifiers to plaintext. Reset identifiers contain the
    // live bearer token (`reset-password:<token>`), so a DB/backup reader could otherwise take over
    // the account. The library hashes on both create and consume, preserving the normal API while
    // ensuring no live reset/email-verification token is recoverable from storage.
    verification: { storeIdentifier: "hashed" },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const cleanedName = cleanText(typeof user.name === "string" ? user.name : "");
            const sanitizedUser = { ...user, name: cleanedName || "User" };
            // Internal credential creation is reachable only through CapacityLens's own
            // invite/bootstrap services and deliberately has no web request context.
            if (!context?.path) return { data: sanitizedUser };
            const emailSignup = context.path === "/sign-up/email";
            const externalSignup = externalIdentityPath(context.path);
            if (!emailSignup && !externalSignup) return { data: sanitizedUser };

            // Open EMAIL registration never opens external identity creation as a side effect.
            // Social/OIDC remains verified-email + invitation/allow-list gated in every posture.
            const externalProviderId = externalSignup ? providerIdFromExternalContext(context) : null;
            if (externalSignup && mode === "sso" && externalProviderId !== genericProviderId) {
              // Named social providers remain compatibility sign-in doors for principals that
              // already exist. Letting one create a new principal after cutover would immediately
              // introduce a strict-provider readiness blocker on the next restart.
              throw APIError.from("FORBIDDEN", {
                message: "New SSO-only identities must sign in through the required OIDC provider.",
                code: "STRICT_PROVIDER_REQUIRED",
              });
            }
            if (externalSignup && !(await opts.externalIdentityAdmission?.(sanitizedUser))) {
              throw APIError.from("FORBIDDEN", {
                message: `This identity is not invited to this ${application.displayName} instance.`,
                code: "EXTERNAL_IDENTITY_NOT_INVITED",
              });
            }
            // Open signup applies only to email credentials. External identities remain subject to
            // the first-principal bootstrap claim and later invitation admission in every posture.
            if (allowOpenSignup && emailSignup) return { data: sanitizedUser };

            // The route-level check may have observed zero users concurrently with another
            // request. Re-check at the actual user insertion boundary and fail closed once the
            // winner exists; otherwise a delayed loser could still create an orphan identity.
            if (emailSignup && countUsers(db) !== 0) {
              throw APIError.from("CONFLICT", {
                message: "The first owner account has already been created.",
                code: "BOOTSTRAP_ALREADY_CLAIMED",
              });
            }
            // Only the first identity needs the cross-request bootstrap claim. Later external
            // identities are independently authorised by their live pre-authorised invite.
            if (countUsers(db) === 0) {
              if (!(context as { bootstrapClaimToken?: unknown }).bootstrapClaimToken) {
                throw APIError.from("CONFLICT", {
                  message: "First-owner setup did not hold its bootstrap claim.",
                  code: "BOOTSTRAP_ALREADY_IN_PROGRESS",
                });
              }
            }
            return { data: sanitizedUser };
          },
        },
      },
      session: {
        create: {
          after: async (session, context) => {
            const assurance = externalIdentityPath(context?.path)
              ? "federated"
              : context?.path?.startsWith("/two-factor/")
                ? "mfa"
                : "password";
            const providerId = assurance === "federated" ? providerIdFromExternalContext(context) : null;
            if (assurance === "federated" && (!providerId || !configuredFederatedIssuers.has(providerId))) {
              throw new Error("External session creation did not resolve a configured provider id.");
            }
            recordSessionAssurance(
              db,
              applicationSessionHandle(application.applicationId, String(session.token)),
              String(session.userId),
              assurance,
              providerId,
            );
          },
        },
        delete: {
          after: async (session) => {
            removeSessionAssurance(db, applicationSessionHandle(application.applicationId, String(session.token)));
          },
        },
      },
    },
    // Email is an attribute, never an account-link key. Linking requires a separate authenticated
    // ceremony outside an OIDC callback, so a newly observed issuer/subject cannot attach itself to
    // an existing local principal merely by presenting the same verified email address.
    account: { accountLinking: { disableImplicitLinking: true } },
    emailAndPassword: {
      enabled: mode === "password",
      // The static library flag stays OFF so the sign-up gate has ONE owner: the live hooks.before
      // below (see the SECURE DEFAULT comment above). Better Auth 1.6.23 enforces disableSignUp
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
      // required operator-supplied bootstrap password must satisfy the same policy.
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // Better Auth counts UTF-16 code units. Give its transport guard enough room for 128 astral
      // code points; the hook and hash boundary enforce CapacityLens's shared code-point ceiling.
      maxPasswordLength: MAX_PASSWORD_INPUT_CODE_UNITS,
      password: {
        hash: passwordHash,
        verify: (input) => verifyPasswordWithBackpressure(baseHasher, input),
      },
      // Admin-issued reset links (P1.18) — password mode ONLY: 'sso' delegates credentials to the
      // IdP, and configuring sendResetPassword would needlessly enable Better Auth's public
      // request-password-reset endpoint there. See captureResetToken/mintPasswordResetToken above.
      ...(mode === "password"
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
    socialProviders: configuredSocialProviders,
    // The LIVE sign-up gate (see the SECURE DEFAULT comment above): allowed when the operator
    // opted in, or for the empty-table owner bootstrap when the request proves knowledge of the
    // configured setup secret. countUsers(db) is consulted per request so the bootstrap route
    // closes immediately after the first identity is created.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Resolve a presented session once at the Better Auth pipeline boundary. Endpoint session
        // middleware reuses ctx.context.session, and /get-session can return it directly, so idle
        // enforcement no longer causes a wrapper lookup followed by the endpoint's second lookup.
        const cookie = ctx.headers?.get("cookie") ?? "";
        // Do not couple inactivity enforcement to Better Auth's internal session-cookie suffix.
        // Any presented cookie may be a session under a newer provider version; resolving it is the
        // fail-closed compatibility posture, while a truly cookieless public request still skips work.
        const sessionPresented = cookie.length > 0 || ctx.headers?.has("authorization") === true;
        let activeHookSession: Awaited<ReturnType<typeof getSessionFromCtx>> | undefined;
        if (sessionPresented) {
          const resolved = await getSessionFromCtx(ctx, {
            disableCookieCache: true,
            disableRefresh: true,
          });
          activeHookSession = resolved ? await enforceSessionActivity(resolved, db) : null;
          ctx.context.session = activeHookSession;
          if (ctx.path === "/get-session" && activeHookSession) return activeHookSession;
        }
        const continuingContext = () =>
          activeHookSession === undefined ? undefined : { context: { session: activeHookSession } };

        if (externalIdentityPath(ctx.path)) {
          if (countUsers(db) === 0) {
            return {
              context: {
                ...continuingContext()?.context,
                bootstrapClaimToken: acquireBootstrapClaim(),
              },
            };
          }
          return continuingContext();
        }
        if (allowOpenSignup) {
          assertAuthRequestPasswordLength(ctx.path, ctx.body);
          return continuingContext();
        }
        if (ctx.path !== "/sign-up/email") {
          assertAuthRequestPasswordLength(ctx.path, ctx.body);
          return continuingContext();
        }
        // A fresh password instance is never claimable merely because it is reachable. The
        // operator configures CAPACITYLENS_SETUP_TOKEN and the owner-setup form presents it in
        // this header. index.ts also refuses a fresh password boot when the secret is absent.
        if (
          countUsers(db) === 0 &&
          setupTokenMatches(setupToken, ctx.headers?.get("x-capacitylens-setup-token") ?? null)
        ) {
          // Validate before acquiring the one-at-a-time bootstrap claim: a malformed password must
          // not strand setup waiting for an after-hook that this before-hook failure never reaches.
          assertAuthRequestPasswordLength(ctx.path, ctx.body);
          return {
            context: {
              ...continuingContext()?.context,
              bootstrapClaimToken: acquireBootstrapClaim(),
            },
          };
        }
        // The EXACT refusal Better Auth's own disableSignUp emits (sign-up.mjs, 1.6.23), so the
        // client and tests see one unchanged error shape regardless of which gate closed the door.
        throw APIError.from("BAD_REQUEST", {
          message: "Email and password sign up is not enabled",
          code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
        });
      }),
      after: createAuthMiddleware(async (ctx) => {
        // Email open signup does not acquire a claim. External first-owner and closed email setup
        // release any claim on both success and failure so a failed attempt cannot strand setup.
        if (externalIdentityPath(ctx.path) || (!allowOpenSignup && ctx.path === "/sign-up/email")) {
          const claimToken = (ctx as { bootstrapClaimToken?: unknown }).bootstrapClaimToken;
          if (typeof claimToken === "string") {
            db.prepare(`DELETE FROM capacitylens_bootstrap_claim WHERE id = 1 AND claimToken = ?`).run(claimToken);
          }
        }
      }),
    },
    plugins,
    trustedOrigins: opts.trustedOrigins,
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
        ...(publicUrl.protocol === "https:" ? { secure: true } : {}),
      },
    },
    // Fixed 12-hour absolute lifetime: refresh is disabled, so activity can never extend a stolen
    // session indefinitely. The wrapper below separately enforces a 30-minute inactivity timeout
    // without moving expiresAt. `freshAge` supplies a 15-minute step-up window for sensitive actions.
    session: {
      expiresIn: SESSION_ABSOLUTE_TTL_SECONDS,
      disableSessionRefresh: true,
      freshAge: SESSION_FRESH_AGE_SECONDS,
    },
    telemetry: { enabled: false },
  });
  // betterAuth construction validates its resolved options but does not own this app-specific
  // table. Verify and expire its leases only after configuration and app migrations have succeeded.
  if (!opts.deferDatabaseSetup) ensureAuthControlTables(db, env);
  // Collapse the invariant generic to the structural Auth surface (see Auth), AND normalize at
  // this single narrowing boundary (P1.7a): Better Auth's full user carries the richer fields we
  // drop here, so this is exactly where `emailVerified` is read and defaulted before everything
  // downstream sees only the {id,email,emailVerified,name} SessionUser.
  const raw = instance as unknown as {
    handler: Auth["handler"];
    api: {
      getSession: (input: { headers: Headers }) => Promise<{
        user: RawSessionUser;
        session: {
          createdAt: Date | string;
          updatedAt: Date | string;
          token: string;
        };
      } | null>;
      requestPasswordReset: Auth["api"]["requestPasswordReset"];
    };
    options: BetterAuthOptions;
    // Better Auth's async init context (reverified against better-auth 1.6.23,
    // dist/auth/base.mjs:37 `$context: authContext`, dist/db/internal-adapter.mjs for deletion, and
    // dist/context/create-context.mjs for `password.hash`). Read only through the narrow Auth
    // methods below.
    $context: Promise<{
      password: { hash: (password: string) => Promise<string> };
      internalAdapter: {
        deleteUser: (userId: string) => Promise<void>;
        deleteUserSessions: (userId: string) => Promise<void>;
      };
    }>;
  };

  // raw.api.getSession runs through the same hooks.before pipeline as HTTP routes, so the session is
  // already idle-checked and touched once before it reaches this provider-neutral adapter.
  const activeSession = (headers: Headers) => raw.api.getSession({ headers });
  const strictProvider = configuredProviderInfo.find((provider) => provider.kind === "oidc") ?? null;
  const trustedLinkOrigins = new Set([
    publicUrl.origin,
    ...(opts.trustedOrigins ?? []).map((value) => {
      try {
        return new URL(value).origin;
      } catch (cause) {
        throw new AuthConfigError(`Trusted origin ${JSON.stringify(value)} must be an absolute URL.`, { cause });
      }
    }),
  ]);

  const linkReturnUrl = (value: string, parameter: string, ceremonyId: string): URL => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw APIError.from("BAD_REQUEST", {
        message: "The identity-link return URL is invalid.",
        code: "INVALID_CALLBACK_URL",
      });
    }
    if (!trustedLinkOrigins.has(url.origin) || url.username || url.password) {
      throw APIError.from("FORBIDDEN", {
        message: "The identity-link return URL is not a trusted browser origin.",
        code: "INVALID_CALLBACK_URL",
      });
    }
    url.searchParams.set(parameter, ceremonyId);
    return url;
  };

  const callbackErrorUrl = (request: Request): URL => {
    const fallback = new URL(browserAuthErrorUrl);
    if (!sqliteTableExists(db, "verification")) return fallback;
    const state = new URL(request.url).searchParams.get("state");
    if (!state) return fallback;
    // Better Auth stores the returned OAuth state as the verification identifier. Use that indexed
    // coordinate instead of parsing every reset, MFA, and abandoned OAuth row on each callback.
    const storedIdentifier = createHash("sha256").update(state).digest("base64url");
    const rows = db
      .prepare(`SELECT value FROM verification WHERE identifier = ? LIMIT 2`)
      .all(storedIdentifier) as Array<{
      value: string;
    }>;
    for (const { value } of rows) {
      try {
        const stored = JSON.parse(value) as { oauthState?: unknown; errorURL?: unknown };
        if (stored.oauthState !== state || typeof stored.errorURL !== "string") continue;
        const target = new URL(stored.errorURL);
        if (trustedLinkOrigins.has(target.origin) && !target.username && !target.password) return target;
      } catch {
        // Verification values are shared with non-OAuth ceremonies. Non-JSON rows cannot carry a
        // validated callback URL and deliberately fall through to the stable application target.
      }
    }
    return fallback;
  };

  const isStrictOidcVerificationFailure = (error: unknown): boolean =>
    error instanceof APIError && error.body?.code === "OIDC_IDENTITY_VERIFICATION_FAILED";

  const auth: Auth = {
    // Enforce inactivity even when a caller goes directly to an authenticated Better Auth route
    // such as change-password rather than first touching an application data route.
    handler: async (request) => {
      const callbackPath = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
      const callbackProviderId = providerIdFromExternalContext({ path: callbackPath });
      const failureTarget = callbackProviderId ? callbackErrorUrl(request) : null;
      if (strictOidcClient && strictOidcAuthorizationProxyPath) {
        const requestUrl = new URL(request.url);
        if (request.method === "GET" && requestUrl.pathname === strictOidcAuthorizationProxyPath) {
          try {
            const metadata = await strictOidcClient.metadata();
            const target = new URL(metadata.authorization_endpoint);
            for (const [key, value] of requestUrl.searchParams) target.searchParams.append(key, value);
            return new Response(null, {
              status: 302,
              headers: {
                location: target.toString(),
                "cache-control": "no-store",
                pragma: "no-cache",
              },
            });
          } catch (error) {
            console.error("Strict OIDC authorization initialization failed.", error);
            const target = new URL(browserAuthErrorUrl);
            target.searchParams.set("error", "provider_unavailable");
            return new Response(null, {
              status: 302,
              headers: {
                location: target.toString(),
                "cache-control": "no-store",
                pragma: "no-cache",
              },
            });
          }
        }
      }
      try {
        const capture = { error: null as unknown };
        const response = await authHandlerErrorCapture.run(capture, () => raw.handler(request));
        if (callbackProviderId && isStrictOidcVerificationFailure(capture.error)) {
          const target = failureTarget ?? new URL(browserAuthErrorUrl);
          target.searchParams.set("error", "OIDC_IDENTITY_VERIFICATION_FAILED");
          return Response.redirect(target, 302);
        }
        if (callbackProviderId && isFederatedAccountCoordinateConstraint(capture.error)) {
          const target = failureTarget ?? new URL(browserAuthErrorUrl);
          target.searchParams.set("error", "account_already_linked_to_different_user");
          return Response.redirect(target, 302);
        }
        if (callbackProviderId) {
          try {
            reconcileObservedFederatedLinks(db, application.applicationId, () => verifiedUnauditedFederatedLinks(db));
          } catch (error) {
            // The trigger already preserved the durable observation. Keep the browser response
            // truthful and let startup/request reconciliation retry the audit transaction.
            console.error("Federated identity link audit reconciliation is pending.", error);
          }
        }
        return response;
      } catch (error) {
        if (isFederatedAccountCoordinateConstraint(error)) {
          const target = failureTarget ?? new URL(browserAuthErrorUrl);
          target.searchParams.set("error", "account_already_linked_to_different_user");
          return Response.redirect(target, 302);
        }
        throw error;
      }
    },
    options: raw.options,
    providers: configuredProviderInfo,
    federatedIssuers: configuredFederatedIssuers,
    strictProvider,
    ensureProviderBindings: () => {
      for (const [providerId, issuer] of configuredFederatedIssuers) {
        bindFederatedProvider(db, application.applicationId, issuer, providerId);
      }
    },
    assertProviderBindings: () => {
      for (const [providerId, issuer] of configuredFederatedIssuers) {
        const row = db
          .prepare(
            `SELECT issuer, providerId
               FROM account_federated_provider_bindings
              WHERE applicationId = ? AND (issuer = ? OR providerId = ?)`,
          )
          .all(application.applicationId, issuer, providerId) as Array<{ issuer: string; providerId: string }>;
        if (row.length !== 1 || row[0]!.issuer !== issuer || row[0]!.providerId !== providerId) {
          throw new Error(`Persisted provider binding does not match configured provider ${providerId}.`);
        }
      }
    },
    api: {
      async getSession(input) {
        const session = await activeSession(input.headers);
        if (!session) return null;
        return {
          user: {
            ...normalizeSessionUser(session.user),
            sessionCreatedAt: new Date(session.session.createdAt).toISOString(),
          },
          session: {
            // Better Auth exposes the bearer token rather than its database row id here. Hash it
            // before it crosses our identity boundary; callers receive a stable opaque handle,
            // never a credential that could authenticate a request.
            id: applicationSessionHandle(application.applicationId, session.session.token),
            createdAt: new Date(session.session.createdAt).toISOString(),
            expiresAt: new Date(
              new Date(session.session.createdAt).getTime() + SESSION_ABSOLUTE_TTL_SECONDS * 1000,
            ).toISOString(),
          },
        };
      },
      // Bound (not bare-referenced): Better Auth's api endpoints resolve their context via `this`.
      requestPasswordReset: (input) => raw.api.requestPasswordReset(input),
    },
    createCredentialUser: (email, name, password, emailVerified = false, correlateInTransaction) =>
      raw.$context.then((ctx) =>
        createCredentialUserWith(ctx, db, email, name, password, emailVerified, correlateInTransaction),
      ),
    deleteCredentialUser: (userId) => raw.$context.then((ctx) => ctx.internalAdapter.deleteUser(userId)),
    revokeUserSessions: (userId) => raw.$context.then((ctx) => ctx.internalAdapter.deleteUserSessions(userId)),
    async beginFederatedLink({ headers, principalId, callbackURL, errorCallbackURL }) {
      if (!strictProvider) {
        throw APIError.from("BAD_REQUEST", {
          message: "No strict OIDC provider is configured for account linking.",
          code: "PROVIDER_NOT_FOUND",
        });
      }
      // A previous callback may have committed its provider row immediately before a process stop.
      // Repair that durable observation before starting another mutating link ceremony. Readiness
      // reads remain side-effect free.
      auth.reconcileFederatedLinks?.();
      const session = await activeSession(headers);
      if (!session || String(session.user.id) !== principalId) {
        throw APIError.from("UNAUTHORIZED", {
          message: "The identity-link session no longer matches the signed-in user.",
          code: "SESSION_EXPIRED",
        });
      }
      const existingLinks = db
        .prepare(`SELECT id FROM account WHERE userId = ? AND providerId = ? ORDER BY id LIMIT 2`)
        .all(principalId, strictProvider.id) as Array<{ id: string }>;
      if (existingLinks.length > 0) {
        throw APIError.from("CONFLICT", {
          message:
            existingLinks.length === 1
              ? "This identity provider is already connected."
              : "Multiple provider links require stopped-server repair before reconnecting.",
          code: existingLinks.length === 1 ? "PROVIDER_ALREADY_LINKED" : "MULTIPLE_PROVIDER_LINKS",
        });
      }
      const ceremonyId = randomBytes(24).toString("base64url");
      const success = linkReturnUrl(callbackURL, "capacitylensSsoLinked", ceremonyId);
      const failure = linkReturnUrl(errorCallbackURL, "capacitylensSsoLinkFailed", ceremonyId);
      const ceremony = createFederatedLinkCeremony(db, principalId, strictProvider.id, ceremonyId, () =>
        revokeFederatedLinkStateInTx(db, principalId),
      );
      const requestHeaders = new Headers(headers);
      requestHeaders.set("content-type", "application/json");
      const response = await raw.handler(
        new Request(new URL("/api/auth/oauth2/link", publicUrl), {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({
            providerId: strictProvider.id,
            callbackURL: success.toString(),
            errorCallbackURL: failure.toString(),
          }),
        }),
      );
      const body: unknown = await response.json().catch(() => null);
      const url = body && typeof body === "object" ? (body as { url?: unknown }).url : null;
      if (!response.ok || typeof url !== "string") {
        deleteFederatedLinkCeremony(db, ceremony.id);
        throw APIError.from("BAD_GATEWAY", {
          message: "The identity provider could not start the link ceremony.",
          code: "PROVIDER_UNAVAILABLE",
        });
      }
      return { url, setCookies: response.headers.getSetCookie() };
    },
    reconcileFederatedLinks() {
      reconcileObservedFederatedLinks(db, application.applicationId, () => verifiedUnauditedFederatedLinks(db));
    },
  };
  if (!opts.deferDatabaseSetup) auth.ensureProviderBindings();
  return { mode, auth };
}

/** The subset of Better Auth's `$context` {@link createCredentialUserWith} needs. Better Auth still
 * owns password hashing; CapacityLens owns the explicit same-file transaction needed to include
 * the command-ledger correlation that the provider adapter cannot see. */
interface CredentialUserContext {
  password: { hash: (password: string) => Promise<string> };
}

/**
 * Hash outside the write transaction, then commit the Better Auth user, credential link and an
 * optional same-database correlation callback as one synchronous SQLite unit. Better Auth's
 * node:sqlite adapter ultimately writes these same pinned tables; using the shared handle here is
 * what lets invitation onboarding cross its provider/coordinator boundary without a crash gap.
 */
async function createCredentialUserWith(
  ctx: CredentialUserContext,
  db: Db,
  email: string,
  name: string,
  password: string,
  emailVerified = false,
  correlateInTransaction?: (principalId: string) => void,
): Promise<{ id: string }> {
  const hash = await ctx.password.hash(password);
  const cleanedName = cleanText(name);
  return tx(
    db,
    () => {
      // Better Auth's default ids are opaque random strings. Keep the same 32-character base64url
      // shape while generating user and provider-link identities independently.
      const userId = randomBytes(24).toString("base64url");
      const accountId = randomBytes(24).toString("base64url");
      const now = Date.now();
      db.prepare(
        `
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      ).run(userId, cleanedName || "User", email.toLowerCase(), emailVerified ? 1 : 0, now, now);
      db.prepare(
        `
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (?, ?, 'credential', ?, ?, ?, ?)
    `,
      ).run(accountId, userId, userId, hash, now, now);
      correlateInTransaction?.(userId);
      return { id: userId };
    },
    "immediate",
  );
}

/** Create/upgrade Better Auth's tables in the shared SQLite file. Called at boot ONLY
 *  when mode ≠ off — an off-mode DB never grows auth tables (the OFF guarantee). */
export async function runAuthMigrations(auth: Auth): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  // Better Auth owns this schema and currently migrates by introspecting/adding tables and fields.
  // Re-introspect after its sequential DDL: startup must not serve traffic after a partial library
  // migration, even if the first pass returned without surfacing the missing remainder.
  const remaining = await planAuthSchemaMigrations(auth);
  if (remaining.pending) {
    throw new Error(
      `Better Auth schema migration did not converge; pending table change(s): ${remaining.tables.join(", ")}`,
    );
  }
  // A fresh database reaches application v25 before Better Auth creates `account`; install the
  // composite uniqueness backstop now that the provider-owned table is guaranteed to exist.
  const database = auth.options.database;
  if (database && typeof database === "object" && "prepare" in database) {
    ensureFederatedIdentitySchema(database as Db);
    assertFederatedIdentitySchemaCurrent(database as Db);
  }
}

export interface AuthSchemaMigrationPlan {
  pending: boolean;
  tables: string[];
}

/** Inspect Better Auth's pinned desired schema without executing its DDL. Production startup folds
 * this into the same pre-migration snapshot decision as app-owned migrations. */
export async function planAuthSchemaMigrations(auth: Auth): Promise<AuthSchemaMigrationPlan> {
  const plan = await getMigrations(auth.options);
  const tables = [...plan.toBeCreated.map((entry) => entry.table), ...plan.toBeAdded.map((entry) => entry.table)];
  return { pending: tables.length > 0, tables: [...new Set(tables)] };
}

// ── First-run owner bootstrap (--create-owner-admin-admin / CAPACITYLENS_CREATE_ADMIN_ADMIN=1) ────
// The headless escape hatch for a first login: a fresh password-mode instance normally bootstraps
// through the login screen's "Create the owner account" form (the browser path), but a scripted /
// container deploy may want a credential ready at boot. The flag creates admin@admin.admin with a
// operator-supplied password ONLY on an EMPTY user table. Requiring the caller to retain the
// credential outside this process avoids an irrecoverable secret if startup output fails.

/** Stable identity for the optional bootstrap owner. Its password is supplied by the operator. */
export const BOOTSTRAP_ADMIN_NAME = "admin";
export const BOOTSTRAP_ADMIN_EMAIL = "admin@admin.admin";

/**
 * Create the bootstrap owner account when — and only
 * when — the Better Auth `user` table has ZERO rows. Called at boot from index.ts, after
 * runAuthMigrations and before buildApp, whenever the operator passed --create-owner-admin-admin
 * (or CAPACITYLENS_CREATE_ADMIN_ADMIN=1).
 *
 * Outcomes, deliberately tiered:
 * - **Empty user table → 'created'.** The account is created through {@link Auth.createCredentialUser},
 *   not the public sign-up route/auth.api.signUpEmail, and a loud framed warning naming the exact
 *   identity is printed without repeating the operator-managed password.
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
): Promise<"created" | "skipped"> {
  if (mode !== "password" || !auth) {
    throw new AuthConfigError(
      `--create-owner-admin-admin (CAPACITYLENS_CREATE_ADMIN_ADMIN=1) creates an email+password credential, which is meaningless when SMALLSASS_ACCOUNT_MODE is '${mode}'. Set SMALLSASS_ACCOUNT_MODE=password, or drop the flag.`,
    );
  }
  if (countUsers(db) > 0) {
    // Not an error: the flag is a first-run bootstrap, and this run isn't the first. One line so
    // the operator can see the flag was noticed, then boot continues untouched.
    log("capacitylens-server: --create-owner-admin-admin skipped: users already exist");
    return "skipped";
  }
  // Bypass the public sign-up route for this bootstrap write. createCredentialUser commits the user
  // and credential link in one SQLite transaction, so a partial write cannot leave a
  // credential-less user that strands bootstrap.
  // The password must be retained by the invoking operator or secret manager before this process
  // starts. Generating it here would create an unrecoverable post-commit window if stdout or the
  // process failed before disclosure. createCredentialUser still applies the ordinary length,
  // breach, context-word and hashing policy.
  const bootstrapPassword = process.env.CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD;
  if (!bootstrapPassword) {
    throw new AuthConfigError(
      "--create-owner-admin-admin requires CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD so the initial credential remains recoverable if startup output fails.",
    );
  }
  if (passwordLengthFailure(bootstrapPassword)) {
    throw new AuthConfigError(
      `CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD must be ${MIN_PASSWORD_LENGTH}..${MAX_PASSWORD_LENGTH} characters.`,
    );
  }
  const claimToken = randomBytes(24).toString("base64url");
  try {
    db.prepare(`INSERT INTO capacitylens_bootstrap_claim (id, claimedAt, claimToken) VALUES (1, ?, ?)`).run(
      new Date().toISOString(),
      claimToken,
    );
  } catch (error) {
    const sqlite = error as { code?: unknown; errcode?: unknown; message?: unknown };
    const collision =
      sqlite.errcode === 19 ||
      (typeof sqlite.code === "string" && sqlite.code.startsWith("SQLITE_CONSTRAINT")) ||
      (typeof sqlite.message === "string" &&
        /unique constraint failed.*capacitylens_bootstrap_claim/i.test(sqlite.message));
    if (!collision) throw error;
    throw new AuthConfigError(
      "--create-owner-admin-admin could not acquire the first-owner claim because setup is already in progress; retry startup after the active setup completes or its five-minute crash lease expires.",
    );
  }
  try {
    // The durable singleton claim is acquired before hashing, so overlapping processes cannot both
    // pass the empty-user predicate and race the fixed bootstrap email inside separate transactions.
    if (countUsers(db) > 0) {
      log("capacitylens-server: --create-owner-admin-admin skipped: users already exist");
      return "skipped";
    }
    await auth.createCredentialUser(BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, bootstrapPassword);
  } finally {
    db.prepare(`DELETE FROM capacitylens_bootstrap_claim WHERE id = 1 AND claimToken = ?`).run(claimToken);
  }
  // Confirm creation without copying the operator-managed password into process logs. The frame is
  // measured from the content (not hand-padded) so a future wording tweak can't skew the box.
  const content = [
    "A bootstrap owner credential was just created:",
    `    email:    ${BOOTSTRAP_ADMIN_EMAIL}`,
    "Use the operator-supplied CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD, sign in, and change it via",
    "Team & access → Reset password. Then remove",
    "the --create-owner-admin-admin flag / CAPACITYLENS_CREATE_ADMIN_ADMIN env.",
  ];
  const width = Math.max(...content.map((line) => line.length));
  log(
    [
      "",
      `  ╔${"═".repeat(width + 4)}╗`,
      ...content.map((line) => `  ║  ${line.padEnd(width)}  ║`),
      `  ╚${"═".repeat(width + 4)}╝`,
      "",
    ].join("\n"),
  );
  return "created";
}

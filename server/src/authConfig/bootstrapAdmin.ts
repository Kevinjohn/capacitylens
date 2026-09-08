import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import { cleanText } from "@capacitylens/shared/lib/strings";
import type { Db } from "../db";
import { tx } from "../txn";
import type { Auth, AccountMode, CreateCredentialUserInput } from "./authTypes";
import type * as AuthFacade from "../auth";
import { ensureFederatedIdentitySchema, assertFederatedIdentitySchemaCurrent } from "./federatedIdentitySchema";

/** The subset of Better Auth's `$context` {@link createCredentialUserWith} needs. Better Auth still
 * owns password hashing; CapacityLens owns the explicit same-file transaction needed to include
 * the command-ledger correlation that the provider adapter cannot see. */
interface CredentialUserContext {
  password: { hash: (password: string) => Promise<string> };
}

interface CreateCredentialUserWithInput extends CreateCredentialUserInput {
  context: CredentialUserContext;
  db: Db;
}

/**
 * Hash outside the write transaction, then commit the Better Auth user, credential link and an
 * optional same-database correlation callback as one synchronous SQLite unit. Better Auth's
 * node:sqlite adapter ultimately writes these same pinned tables; using the shared handle here is
 * what lets invitation onboarding cross its provider/coordinator boundary without a crash gap.
 */
export async function createCredentialUserWith({
  context,
  db,
  email,
  name,
  password,
  emailVerified = false,
  correlateInTransaction,
}: CreateCredentialUserWithInput): Promise<{ id: string }> {
  const hash = await context.password.hash(password);
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
  const database: unknown = auth.options.database;
  if (database instanceof DatabaseSync) {
    ensureFederatedIdentitySchema(database);
    assertFederatedIdentitySchemaCurrent(database);
  }
}

interface AuthSchemaMigrationPlan {
  pending: boolean;
  tables: string[];
}

/** Inspect Better Auth's pinned desired schema without executing its DDL. Production startup folds
 * this into the same pre-migration snapshot decision as app-owned migrations. */
export async function planAuthSchemaMigrations(auth: Auth): Promise<AuthSchemaMigrationPlan> {
  const plan: unknown = await getMigrations(auth.options);
  if (!isAuthSchemaMigrationPlan(plan)) {
    throw new Error("Better Auth returned an invalid schema migration plan");
  }
  const tables = [...plan.toBeCreated.map((entry) => entry.table), ...plan.toBeAdded.map((entry) => entry.table)];
  return { pending: tables.length > 0, tables: [...new Set(tables)] };
}

function isAuthSchemaMigrationPlan(
  value: unknown,
): value is { toBeCreated: Array<{ table: string }>; toBeAdded: Array<{ table: string }> } {
  if (!value || typeof value !== "object" || !("toBeCreated" in value) || !("toBeAdded" in value)) return false;
  return isMigrationTableList(value.toBeCreated) && isMigrationTableList(value.toBeAdded);
}

function isMigrationTableList(value: unknown): value is Array<{ table: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry: unknown) => entry && typeof entry === "object" && "table" in entry && typeof entry.table === "string",
    )
  );
}

// ── First-run owner bootstrap (--create-owner-admin-admin / CAPACITYLENS_CREATE_ADMIN_ADMIN=1) ────
// The headless escape hatch for a first login: a fresh password-mode instance normally bootstraps
// through the login screen's "Create the owner account" form (the browser path), but a scripted /
// container deploy may want a credential ready at boot. The flag creates admin@admin.admin with a
// operator-supplied password ONLY on an EMPTY user table. Requiring the caller to retain the
// credential outside this process avoids an irrecoverable secret if startup output fails.

/** Stable identity for the optional bootstrap owner. Its password is supplied by the operator. */
const BOOTSTRAP_ADMIN_NAME = "admin";
export const BOOTSTRAP_ADMIN_EMAIL = "admin@admin.admin";

type BootstrapLog = (line: string) => void;

interface BootstrapAdminDependencies {
  AuthConfigError: typeof AuthFacade.AuthConfigError;
  countUsers: typeof AuthFacade.countUsers;
  isSqliteConstraintCollision: (sqlite: { code?: unknown; errcode?: unknown }) => boolean;
}

interface BootstrapAdminInput {
  auth: Auth | null;
  db: Db;
  log: BootstrapLog;
  mode: AccountMode;
}

function readBootstrapPassword(AuthConfigError: typeof AuthFacade.AuthConfigError): string {
  const password = process.env.CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD;
  if (!password) {
    throw new AuthConfigError(
      "--create-owner-admin-admin requires CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD so the initial credential remains recoverable if startup output fails.",
    );
  }
  if (passwordLengthFailure(password)) {
    throw new AuthConfigError(
      `CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD must be ${MIN_PASSWORD_LENGTH}..${MAX_PASSWORD_LENGTH} characters.`,
    );
  }
  return password;
}

function acquireBootstrapClaim({
  AuthConfigError,
  db,
  isSqliteConstraintCollision,
}: Pick<BootstrapAdminDependencies, "AuthConfigError" | "isSqliteConstraintCollision"> &
  Pick<BootstrapAdminInput, "db">): string {
  const claimToken = randomBytes(24).toString("base64url");
  try {
    db.prepare(`INSERT INTO capacitylens_bootstrap_claim (id, claimedAt, claimToken) VALUES (1, ?, ?)`).run(
      new Date().toISOString(),
      claimToken,
    );
  } catch (error) {
    if (!isBootstrapClaimCollision({ error, isSqliteConstraintCollision })) throw error;
    throw new AuthConfigError(
      "--create-owner-admin-admin could not acquire the first-owner claim because setup is already in progress; retry startup after the active setup completes or its five-minute crash lease expires.",
    );
  }
  return claimToken;
}

function isBootstrapClaimCollision({
  error,
  isSqliteConstraintCollision,
}: Pick<BootstrapAdminDependencies, "isSqliteConstraintCollision"> & { error: unknown }): boolean {
  if (!error || typeof error !== "object") return false;
  return (
    isSqliteConstraintCollision(error) ||
    ("message" in error &&
      typeof error.message === "string" &&
      /unique constraint failed.*capacitylens_bootstrap_claim/i.test(error.message))
  );
}

function logBootstrapCreated(log: BootstrapLog): void {
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
}

async function runBootstrapAdmin(
  dependencies: BootstrapAdminDependencies,
  input: BootstrapAdminInput,
): Promise<"created" | "skipped"> {
  const { AuthConfigError, countUsers } = dependencies;
  const { auth, db, log, mode } = input;
  if (mode !== "password" || !auth) {
    throw new AuthConfigError(
      `--create-owner-admin-admin (CAPACITYLENS_CREATE_ADMIN_ADMIN=1) creates an email+password credential, which is meaningless when SMALLSASS_ACCOUNT_MODE is '${mode}'. Set SMALLSASS_ACCOUNT_MODE=password, or drop the flag.`,
    );
  }
  if (countUsers(db) > 0) {
    log("capacitylens-server: --create-owner-admin-admin skipped: users already exist");
    return "skipped";
  }
  const password = readBootstrapPassword(AuthConfigError);
  const claimToken = acquireBootstrapClaim({ ...dependencies, db });
  try {
    if (countUsers(db) > 0) {
      log("capacitylens-server: --create-owner-admin-admin skipped: users already exist");
      return "skipped";
    }
    await auth.createCredentialUser({ email: BOOTSTRAP_ADMIN_EMAIL, name: BOOTSTRAP_ADMIN_NAME, password });
  } finally {
    db.prepare(`DELETE FROM capacitylens_bootstrap_claim WHERE id = 1 AND claimToken = ?`).run(claimToken);
  }
  logBootstrapCreated(log);
  return "created";
}

// Bind facade-owned policy without importing the facade at runtime.
export function createBootstrapAdminFactory(dependencies: BootstrapAdminDependencies) {
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
  async function createBootstrapAdmin(
    ...[db, mode, auth, log]: [db: Db, mode: AccountMode, auth: Auth | null, log?: BootstrapLog]
  ): Promise<"created" | "skipped"> {
    return runBootstrapAdmin(dependencies, { auth, db, log: log ?? console.log, mode });
  }

  return createBootstrapAdmin;
}

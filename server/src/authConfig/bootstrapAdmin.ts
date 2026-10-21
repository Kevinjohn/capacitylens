import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import { randomBytes } from "node:crypto";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import type { Db } from "../db";
import type { Auth, AccountMode } from "./authTypes";
import type * as AuthFacade from "../auth";

// First-run owner bootstrap (--create-owner-admin-admin / CAPACITYLENS_CREATE_ADMIN_ADMIN=1).
// The headless escape hatch for a first login: a fresh password-mode instance normally bootstraps
// through the login screen's "Create the owner account" form (the browser path), but a scripted /
// container deploy may want a credential ready at boot. The flag creates admin@admin.admin with a
// operator-supplied password only on an empty user table. Requiring the caller to retain the
// credential outside this process avoids an irrecoverable secret if startup output fails.

const BOOTSTRAP_ADMIN_NAME = "admin";
/** Stable email address for the optional operator-created bootstrap owner. */
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

type BootstrapAdminResult = { kind: "created" } | { kind: "skipped" };

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

function createBootstrapClaim({
  AuthConfigError,
  db,
  isSqliteConstraintCollision,
}: {
  AuthConfigError: typeof AuthFacade.AuthConfigError;
  db: Db;
  isSqliteConstraintCollision: BootstrapAdminDependencies["isSqliteConstraintCollision"];
}): string {
  const claimToken = randomBytes(24).toString("base64url");
  try {
    db.prepare(`INSERT INTO capacitylens_bootstrap_claim (id, claimedAt, claimToken) VALUES (1, ?, ?)`).run(
      new Date().toISOString(),
      claimToken,
    );
  } catch (error) {
    // A competing first-owner claim must refuse bootstrap visibly; unrelated database errors remain unchanged.
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

function buildBootstrapCreatedMessage(): string {
  const content = [
    "A bootstrap owner credential was just created:",
    `    email:    ${BOOTSTRAP_ADMIN_EMAIL}`,
    "Use the operator-supplied CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD, sign in, and change it via",
    "Team & access → Reset password. Then remove",
    "the --create-owner-admin-admin flag / CAPACITYLENS_CREATE_ADMIN_ADMIN env.",
  ];
  const width = Math.max(...content.map((line) => line.length));
  return [
    "",
    `  ╔${"═".repeat(width + 4)}╗`,
    ...content.map((line) => `  ║  ${line.padEnd(width)}  ║`),
    `  ╚${"═".repeat(width + 4)}╝`,
    "",
  ].join("\n");
}

async function createBootstrapAdminResult(
  dependencies: BootstrapAdminDependencies,
  input: BootstrapAdminInput,
): Promise<BootstrapAdminResult> {
  const { AuthConfigError, countUsers, isSqliteConstraintCollision } = dependencies;
  const { auth, db, log, mode } = input;
  if (!allowsPasswordSignIn(mode) || !auth) {
    throw new AuthConfigError(
      `--create-owner-admin-admin (CAPACITYLENS_CREATE_ADMIN_ADMIN=1) creates an email+password credential, which is meaningless when CAPACITYLENS_MODE is '${mode}'. Set CAPACITYLENS_MODE=password-only or password-and-sso, or drop the flag.`,
    );
  }
  if (countUsers(db) > 0) {
    log("capacitylens-server: --create-owner-admin-admin skipped: users already exist");
    return { kind: "skipped" };
  }
  const password = readBootstrapPassword(AuthConfigError);
  const claimToken = createBootstrapClaim({ AuthConfigError, db, isSqliteConstraintCollision });
  try {
    if (countUsers(db) > 0) {
      log("capacitylens-server: --create-owner-admin-admin skipped: users already exist");
      return { kind: "skipped" };
    }
    await auth.createCredentialUser({ email: BOOTSTRAP_ADMIN_EMAIL, name: BOOTSTRAP_ADMIN_NAME, password });
  } finally {
    db.prepare(`DELETE FROM capacitylens_bootstrap_claim WHERE id = 1 AND claimToken = ?`).run(claimToken);
  }
  log(buildBootstrapCreatedMessage());
  return { kind: "created" };
}

/** Binds bootstrap behavior to facade-owned policy without a runtime import cycle. */
export function createBootstrapAdminFactory(dependencies: BootstrapAdminDependencies) {
  /**
   * Create the bootstrap owner account when, and only
   * when, the Better Auth `user` table has zero rows. Called at boot from index.ts, after
   * runAuthMigrations and before buildApp, whenever the operator passed --create-owner-admin-admin
   * (or CAPACITYLENS_CREATE_ADMIN_ADMIN=1).
   *
   * Outcomes, deliberately tiered:
   * - **Empty user table → 'created'.** The account is created through {@link Auth.createCredentialUser},
   *   not the public sign-up route/auth.api.signUpEmail, and a loud framed warning naming the exact
   *   identity is printed without repeating the operator-managed password.
   * - **Users already exist → 'skipped'.** One log line, boot continues normally. The flag is
   *   idempotent by design so a deploy script can leave it set across restarts without erroring.
   * - **Auth off / sso → throws {@link AuthConfigError}.** The flag creates an email+password
   *   credential, so it is meaningless without password mode, refusing loudly (the entrypoint
   *   frames it via refuseToStart) beats silently ignoring an operator's explicit instruction.
   *
   * @param db    The open SQLite handle (for the zero-users check).
   * @param mode  The parsed auth mode, must be 'password'.
   * @param auth  The Better Auth instance, non-null exactly when mode ≠ 'off'.
   * @param log   Line sink for the warning/skip output (console.log in production; injectable for tests).
   * @returns 'created' when the account was made, 'skipped' when users already existed.
   * @throws AuthConfigError when mode is not 'password' (boot must refuse, not limp on).
   */
  async function createBootstrapAdmin(
    ...[db, mode, auth, log = console.log]: [Db, AccountMode, Auth | null, BootstrapLog?]
  ): Promise<"created" | "skipped"> {
    const result = await createBootstrapAdminResult(dependencies, { auth, db, log, mode });
    return result.kind;
  }

  return createBootstrapAdmin;
}

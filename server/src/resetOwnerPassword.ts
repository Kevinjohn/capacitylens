import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import { openDbConnection, planDatabaseMigrations, type Db } from "./db";
import {
  DEFAULT_ACCOUNT_APPLICATION,
  RESET_LINK_TTL_SECONDS,
  authFromEnv,
  findUserIdsByEmail,
  mintPasswordResetToken,
  planAuthSchemaMigrations,
  revokeResetTokensForUser,
} from "./auth";
import { assertAccountControlPlaneCurrent, listSoleOwnerAccountIds } from "./accounts/sqliteAccountAdminPort";
import { assertAuditOutboxCurrent, enqueueAudit } from "./auditOutbox";
import { resolveAccountEnvironment } from "./accountConfig";

export interface OwnerRecoveryResult {
  email: string;
  userId: string;
  accountIds: string[];
  ceremonyId: string;
  link: string;
  expiresAt: string;
  auditId: string;
}

export interface OwnerRecoveryInput {
  databasePath: string;
  email: string;
  confirmServerStopped: boolean;
  /** Injectable for tests; the script shell passes process.env. */
  env?: Record<string, string | undefined>;
}

/**
 * Operator recovery for the one credential state no in-product actor can repair: the sole active
 * Owner's lost password. `canAdministerIdentity` bars every non-Owner from administering an Owner,
 * and the single-active-Owner index guarantees there is no second Owner to help — so recovery is a
 * stopped-server CLI ceremony, not a product feature. The tool drives the ordinary Better Auth
 * reset ceremony (same token store, expiry, single-use consumption, password policy, session
 * revocation); it never writes a credential directly and never relaxes in-app policy.
 *
 * Family ruling and full guard rationale: to-my-siblings/_sole-owner-recovery-playbook-2026-08-05.md.
 */
export async function resetOwnerPassword(input: OwnerRecoveryInput): Promise<OwnerRecoveryResult> {
  if (!input.confirmServerStopped) {
    throw new Error(
      "Refusing without --confirm-server-stopped. Stop the CapacityLens server first; the exclusive " +
        "database lock enforces this, but the flag records operator intent.",
    );
  }
  if (input.databasePath === ":memory:" || !existsSync(input.databasePath)) {
    throw new Error("The recovery database must be an existing on-disk CapacityLens database.");
  }

  const email = normalizeAccountEmail(input.email);
  if (!isAccountEmail(email)) {
    throw new Error("The target email is not a valid account address.");
  }

  // Resolve the canonical family configuration exactly the way server startup does, so refusals
  // name canonical keys and the compatibility aliases keep working.
  const { env } = resolveAccountEnvironment({ ...(input.env ?? process.env) });
  if (env.CAPACITYLENS_AUTH !== "password") {
    throw new Error(
      "SMALLSASS_ACCOUNT_MODE must be password: sso installations have no local credential to reset " +
        "and off installations have no credential model.",
    );
  }
  if (!env.BETTER_AUTH_URL) {
    throw new Error("SMALLSASS_ACCOUNT_PUBLIC_URL must be set; the reset link cannot be built without it.");
  }

  // Not openDb(): a stale database must refuse below rather than silently migrate outside the
  // production pre-migration backup ceremony.
  const db = openDbConnection(input.databasePath);
  try {
    acquireExclusiveDatabaseLock(db);

    const migrationPlan = planDatabaseMigrations(db);
    if (migrationPlan.migrations.length > 0) {
      throw new Error(
        `Database schema v${migrationPlan.fromVersion} is not current (expected v${migrationPlan.toVersion}); ` +
          "start this release normally to complete its backed-up migration before recovery.",
      );
    }
    assertAccountControlPlaneCurrent(db);
    assertAuditOutboxCurrent(db);

    // The Auth instance rides the tool's exclusively-locked connection; a second connection would
    // deadlock against our own interlock. deferDatabaseSetup: this tool performs no schema or
    // provider-binding writes.
    const { auth } = authFromEnv(db, env, { deferDatabaseSetup: true });
    if (!auth) throw new Error("Better Auth did not initialize for password mode.");
    const authPlan = await planAuthSchemaMigrations(auth);
    if (authPlan.pending) {
      throw new Error(
        `Better Auth schema is not current (pending table change(s): ${authPlan.tables.join(", ")}); ` +
          "start this release normally before recovery.",
      );
    }

    const matches = findUserIdsByEmail(db, email, 2);
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? "No identity matches that address."
          : "More than one identity matches that address; recovery requires an unambiguous target.",
      );
    }
    const userId = matches[0]!;

    // Authority condition: only the state no in-product actor can recover. Anyone else has an
    // in-product reset path, and this tool must not become a general backdoor.
    const ownedAccountIds = listSoleOwnerAccountIds(db, userId);
    if (ownedAccountIds.length === 0) {
      throw new Error(
        "That identity is not the sole active Owner of any workspace; use the in-product " +
          "admin-issued reset instead.",
      );
    }

    const token = await mintPasswordResetToken(auth, email);
    if (token === null) {
      throw new Error("Better Auth matched no credential identity for that address.");
    }

    // Everything after the mint fails closed: a token we cannot audit or deliver must not survive.
    try {
      const applicationId = DEFAULT_ACCOUNT_APPLICATION.applicationId;
      const ceremonyId = createHash("sha256")
        .update(`${applicationId}-reset-ceremony\0`)
        .update(token)
        .digest("base64url");
      const link = `${new URL(env.BETTER_AUTH_URL).origin}/reset-password/${encodeURIComponent(token)}`;
      const expiresAt = new Date(Date.now() + RESET_LINK_TTL_SECONDS * 1000).toISOString();
      const event: AccountAuditEvent = {
        id: randomUUID(),
        occurredAt: new Date().toISOString() as AccountAuditEvent["occurredAt"],
        applicationId,
        workspaceId: null,
        // No in-product actor exists for this ceremony — that absence is the auditable fact.
        actorPrincipalId: null,
        targetPrincipalId: userId as AccountAuditEvent["targetPrincipalId"],
        commandId: null,
        action: "identity.owner_recovery_issued",
        outcome: "success",
        // The digest, never the token: the audit trail must not itself be a credential.
        changedFields: ["credential", `ceremony:${ceremonyId}`],
      };
      const auditId = enqueueAudit(db, event, event.id);
      return { email, userId, accountIds: ownedAccountIds, ceremonyId, link, expiresAt, auditId };
    } catch (cause) {
      revokeResetTokensForUser(db, userId);
      throw new Error("Recovery failed after minting; the reset ceremony has been revoked.", { cause });
    }
  } finally {
    db.close();
  }
}

/** The --confirm-server-stopped flag made real: take SQLite's exclusive lock and keep it for the
 * whole ceremony. A live server's open transactions make acquisition fail (busy_timeout 0 = no
 * silent waiting); once held, a starting server cannot write mid-ceremony either. */
export function acquireExclusiveDatabaseLock(db: Db): void {
  db.exec("PRAGMA busy_timeout = 0;");
  db.exec("PRAGMA locking_mode = EXCLUSIVE;");
  try {
    // BEGIN EXCLUSIVE forces lock acquisition now; the COMMIT keeps it because locking_mode is
    // EXCLUSIVE (locks persist until the connection closes), leaving autocommit free for the
    // ceremony's own writes.
    db.exec("BEGIN EXCLUSIVE");
    db.exec("COMMIT");
  } catch (cause) {
    throw new Error(
      "Another process holds this database — stop the CapacityLens server and retry. Recovery only " +
        "runs with exclusive database access.",
      { cause },
    );
  }
}

import { existsSync } from "node:fs";
import { normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { assertAuditOutboxCurrent } from "./auditOutbox";
import { assertFederatedIdentitySchemaCurrent } from "./auth";
import {
  assertAccountControlPlaneCurrent,
  assertAccountControlPlaneSchemaCurrent,
} from "./accounts/sqliteAccountAdminPort";
import { openDbConnection, planDatabaseMigrations } from "./db";
import type { Db } from "./db";
import { restrictIdentifiedDatabasePermissions } from "./db/filePermissions";
import { acquireExclusiveDatabaseLock } from "./resetOwnerPassword";
import { mixedModeCutoverContext } from "./cutoverContext";

export { type CutoverRepairOperation, type CutoverRepairInput, type CutoverRepairResult } from "./cutoverRepairTypes";
import type {
  CutoverRepairOperation,
  CutoverRepairInput,
  CutoverRepairResult,
  CutoverFacts,
  CutoverPrincipal,
} from "./cutoverRepairTypes";
import { eraseEmptyWorkspace } from "./cutoverRepair/eraseEmptyWorkspace";
import { assignWorkspaceOwner } from "./cutoverRepair/assignWorkspaceOwner";
import { removeProviderLink } from "./cutoverRepair/removeProviderLink";
import { deprovisionCredentialOrphan } from "./cutoverRepair/deprovisionCredentialOrphan";

const REPAIR_COMPATIBLE_MIGRATIONS = new Set([
  25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52,
]);

function assertRepairSchema(db: Db, operation: CutoverRepairOperation): void {
  const plan = planDatabaseMigrations(db);
  // v25 is the identity-link migration this tool may unblock. v26 adds only the reviewed,
  // default-off member sign-in confirmation shape; v27 adds only the optional resource-favourite
  // column; v28 adds only the required resource half-day JSON column with an empty default; and
  // v29 adds only the required resource engagement column with the Studio default; v30 adds
  // only the optional default-on engagement-grouping account preference; and v31 adds the
  // optional account working-day JSON selection with a deterministic legacy default; v32 adds
  // only the optional forward-only repeat-series identity on allocations; v33 widens
  // timeOff.resourceId to nullable; and v34 restores the personal time-off resource requirement,
  // deliberately dropping pre-existing company-wide rows without converting them because there
  // are no users requiring a data-compatibility window, while adding first-class closures; and
  // v35 adds only the optional project attribution on allocations; and v36 adds only optional
  // lifecycle timestamps to activities; and v37 adds only optional allocation task text plus its
  // default-off account visibility preference; v38 adds optional person availability boundaries;
  // and v39 adds only the optional Capacity Overview role threshold on accounts; v40 adds only the
  // optional account-wide date format; and v41 adds only the empty ownership-transfer workflow
  // table, which no repair reads and which can hold no rows before it exists; and v42 adds only an
  // optional person avatar URL column; and v43 adds an empty member/resource association table.
  // v44 adds only optional invitation/person proposals; v45 adds an empty company-dismissal
  // table; v46 adds an empty, short-lived Microsoft mailbox-proof table; v47 adds retained access
  // restrictions and v48 adds identity mailbox proofs. v49 adds empty joining-policy and short-lived
  // intent tables; repair neither reads nor creates those records. v50 rebuilds the Microsoft proof
  // table while copying its rows and preserving the columns used by repair; v51 adds only a nullable
  // browser binding and its index. Repair runs with the server stopped and does not depend on the new
  // joining-proof purpose or browser binding. v52 records the retired auth plugin shape without DDL.
  // Stopped-server repair skips cleanup for optional tables
  // when they predate the database, but treats a missing table at its declared schema version as
  // corruption.
  // These are safe to remain pending before this stopped-server repair. Keep this allowlist explicit
  // so a future migration requires review.
  if (plan.migrations.some(({ version }) => !REPAIR_COMPATIBLE_MIGRATIONS.has(version))) {
    throw new Error(
      `Database schema v${plan.fromVersion} has unrelated pending migrations; start the matching release before repair.`,
    );
  }
  if (plan.migrations.length === 0) assertFederatedIdentitySchemaCurrent(db);
  if (operation.kind === "assign-workspace-owner" || operation.kind === "erase-empty-workspace") {
    assertAccountControlPlaneSchemaCurrent(db);
  } else {
    assertAccountControlPlaneCurrent(db);
  }
  assertAuditOutboxCurrent(db);
}

function resolvePrincipal(facts: CutoverFacts, email: string): CutoverPrincipal {
  const principals = facts.principals.filter((principal) => normalizeAccountEmail(principal.email) === email);
  if (principals.length === 0) throw new Error("No identity matches that address.");
  if (principals.length > 1) {
    throw new Error("More than one identity matches that address; repair requires an unambiguous target.");
  }
  const principal = principals[0];
  if (!principal) throw new Error("No identity matches that address.");
  return principal;
}

/** Narrow, stopped-server repair for identities the all-workspace preflight names. It never accepts
 * a principal id from the operator: the normalized email, configured provider, and exact subject
 * must converge on one stored row before any deletion is possible. */
export async function repairSsoCutover(input: CutoverRepairInput): Promise<CutoverRepairResult> {
  if (!input.confirmServerStopped) throw new Error("Refusing without --confirm-server-stopped.");
  if (input.databasePath === ":memory:" || !existsSync(input.databasePath)) {
    throw new Error("The repair database must be an existing on-disk CapacityLens database.");
  }
  const db = openDbConnection(input.databasePath);
  try {
    acquireExclusiveDatabaseLock(db);
    assertRepairSchema(db, input.operation);
    // Planning is read-only; this repair writes, so harden the now-identified file first.
    restrictIdentifiedDatabasePermissions(db);
    const context = await mixedModeCutoverContext(db, { ...(input.env ?? process.env) });
    const facts = context.identity.inspectSsoCutover(context.provider.id);
    if (input.operation.kind === "erase-empty-workspace") {
      return eraseEmptyWorkspace({ db, administration: context.administration, operation: input.operation });
    }
    const email = normalizeAccountEmail(input.operation.email);
    const principal = resolvePrincipal(facts, email);
    if (input.operation.kind === "assign-workspace-owner") {
      return assignWorkspaceOwner({
        db,
        administration: context.administration,
        principal,
        email,
        operation: input.operation,
      });
    }
    if (input.operation.kind === "remove-provider-link") {
      return removeProviderLink({
        identity: context.identity,
        configuredProviderId: context.provider.id,
        principal,
        email,
        facts,
        operation: input.operation,
      });
    }
    return deprovisionCredentialOrphan({
      db,
      administration: context.administration,
      identity: context.identity,
      principal,
      email,
    });
  } finally {
    db.close();
  }
}

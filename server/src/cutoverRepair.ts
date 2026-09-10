import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import { assertAuditOutboxCurrent, enqueueAudit } from "./auditOutbox";
import { assertFederatedIdentitySchemaCurrent, DEFAULT_ACCOUNT_APPLICATION } from "./auth";
import {
  assertAccountControlPlaneCurrent,
  assertAccountControlPlaneSchemaCurrent,
} from "./accounts/sqliteAccountAdminPort";
import { openDbConnection, planDatabaseMigrations, type Db } from "./db";
import { acquireExclusiveDatabaseLock } from "./resetOwnerPassword";
import { tx } from "./txn";
import { eraseWorkspaceProductDataInTx } from "./erasure";
import { eraseWorkspaceCommandHistoryInTx } from "./accounts/state";
import { mixedModeCutoverContext } from "./cutoverContext";
import { buildCutoverAuditEvent } from "./federatedLinkLifecycle";

/** Exact stopped-server mutation selected by the cutover repair CLI. */
export type CutoverRepairOperation =
  | { kind: "remove-provider-link"; email: string; providerId: string; subject: string }
  | { kind: "deprovision-credential-orphan"; email: string }
  | { kind: "assign-workspace-owner"; workspaceId: string; email: string }
  | { kind: "erase-empty-workspace"; workspaceId: string };

/** Fully resolved repair request; destructive execution additionally requires the stopped flag. */
export interface CutoverRepairInput {
  databasePath: string;
  confirmServerStopped: boolean;
  operation: CutoverRepairOperation;
  env?: Record<string, string | undefined>;
}

/** Non-secret coordinates and durable audit id returned after one committed repair. */
export interface CutoverRepairResult {
  operation: CutoverRepairOperation["kind"];
  principalId: string | null;
  email: string | null;
  providerId: string | null;
  subject: string | null;
  auditId: string;
}

type CutoverContext = Awaited<ReturnType<typeof mixedModeCutoverContext>>;
type CutoverFacts = ReturnType<CutoverContext["identity"]["inspectSsoCutover"]>;
type CutoverPrincipal = CutoverFacts["principals"][number];

interface ResolvedRepair {
  db: Db;
  context: CutoverContext;
  principal: CutoverPrincipal;
  email: string;
}

const REPAIR_COMPATIBLE_MIGRATIONS = new Set([25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);

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
  // lifecycle timestamps to activities.
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

function eraseEmptyWorkspace(
  db: Db,
  context: CutoverContext,
  operation: Extract<CutoverRepairOperation, { kind: "erase-empty-workspace" }>,
): CutoverRepairResult {
  const workspace = context.administration
    .inspectSsoCutoverWorkspaces()
    .find((candidate) => candidate.workspaceId === operation.workspaceId);
  if (!workspace) throw new Error("No workspace matches that exact id.");
  if (workspace.members.length > 0) throw new Error("Only a workspace with zero active members can be erased.");
  const occurredAt = new Date().toISOString();
  const auditId = randomUUID();
  tx(
    db,
    () => {
      eraseWorkspaceProductDataInTx(db, workspace.workspaceId);
      context.administration.eraseWorkspaceAdministrationInTx(workspace.workspaceId);
      eraseWorkspaceCommandHistoryInTx(db, workspace.workspaceId);
      enqueueAudit(
        db,
        buildCutoverAuditEvent(auditId, occurredAt, {
          applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
          workspaceId: workspace.workspaceId,
          actorPrincipalId: null,
          targetPrincipalId: null,
          action: "workspace.erased",
          changedFields: ["workspace", "memberships"],
        }),
        auditId,
      );
    },
    "immediate",
  );
  return { operation: operation.kind, principalId: null, email: null, providerId: null, subject: null, auditId };
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

function assignWorkspaceOwner(
  repair: ResolvedRepair,
  operation: Extract<CutoverRepairOperation, { kind: "assign-workspace-owner" }>,
): CutoverRepairResult {
  const { db, context, principal, email } = repair;
  const workspace = context.administration
    .inspectSsoCutoverWorkspaces()
    .find((candidate) => candidate.workspaceId === operation.workspaceId);
  if (!workspace) throw new Error("No workspace matches that exact id.");
  if (workspace.members.some((member) => member.role === "owner")) {
    throw new Error("The workspace already has an active Owner.");
  }
  if (!workspace.members.some((member) => member.principalId === principal.id)) {
    throw new Error("The selected identity is not an active member of that workspace.");
  }
  const occurredAt = new Date().toISOString();
  const auditId = randomUUID();
  tx(
    db,
    () => {
      if (!context.administration.repairOwnerlessWorkspaceInTx(workspace.workspaceId, principal.id)) {
        throw new Error("The owner repair target changed before commit.");
      }
      enqueueAudit(
        db,
        buildCutoverAuditEvent(auditId, occurredAt, {
          applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
          workspaceId: workspace.workspaceId,
          actorPrincipalId: null,
          targetPrincipalId: principal.id,
          action: "member.role_changed",
          changedFields: ["role"],
        }),
        auditId,
      );
    },
    "immediate",
  );
  return { operation: operation.kind, principalId: principal.id, email, providerId: null, subject: null, auditId };
}

async function removeProviderLink(
  repair: ResolvedRepair,
  facts: CutoverFacts,
  operation: Extract<CutoverRepairOperation, { kind: "remove-provider-link" }>,
): Promise<CutoverRepairResult> {
  const { context, principal, email } = repair;
  const links = [
    ...facts.requiredProviderLinks.map((link) => ({ ...link, providerId: context.provider.id })),
    ...facts.alternativeProviderLinks,
  ].filter(
    (link) =>
      link.principalId === principal.id &&
      link.providerId === operation.providerId &&
      link.subject === operation.subject,
  );
  if (links.length !== 1) {
    throw new Error("The email, provider id, and exact subject do not resolve one provider link.");
  }
  const link = links[0];
  if (!link) throw new Error("The provider link disappeared before repair completed.");
  const auditId = randomUUID();
  const audit: AccountAuditEvent = buildCutoverAuditEvent(auditId, new Date().toISOString(), {
    applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
    workspaceId: null,
    actorPrincipalId: null,
    targetPrincipalId: principal.id,
    action: "identity.federated_link_removed",
    changedFields: ["federatedIdentity", "sessions"],
  });
  const changed = await context.identity.removeFederatedLinkForStoppedRepair({
    principalId: principal.id,
    providerId: operation.providerId,
    rowId: link.rowId,
    subject: link.subject,
    audit,
  });
  if (!changed) throw new Error("The provider link disappeared before repair completed.");
  return {
    operation: operation.kind,
    principalId: principal.id,
    email,
    providerId: operation.providerId,
    subject: operation.subject,
    auditId,
  };
}

function deprovisionCredentialOrphan(repair: ResolvedRepair): CutoverRepairResult {
  const { db, context, principal, email } = repair;
  const memberships = context.administration
    .inspectSsoCutoverWorkspaces()
    .flatMap((workspace) => workspace.members)
    .filter((member) => member.principalId === principal.id);
  const locallyDeprovisionable =
    principal.providerIds.length === 0 ||
    (principal.providerIds.length === 1 && principal.providerIds[0] === "credential");
  if (memberships.length > 0 || !locallyDeprovisionable) {
    throw new Error(
      "The target is not a providerless or credential-only principal with zero active workspace memberships.",
    );
  }
  const auditId = randomUUID();
  const audit: AccountAuditEvent = buildCutoverAuditEvent(auditId, new Date().toISOString(), {
    applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
    workspaceId: null,
    actorPrincipalId: null,
    targetPrincipalId: principal.id,
    action: "identity.local_deprovisioned",
    changedFields: ["localIdentity", "credential", "sessions"],
  });
  let masqueradeHandles: readonly string[] = [];
  tx(
    db,
    () => {
      masqueradeHandles = context.identity.deprovisionLocalPrincipalInTx(principal.id);
      enqueueAudit(db, audit, audit.id);
    },
    "immediate",
  );
  context.identity.commitMasqueradeSessionEnds(masqueradeHandles);
  return {
    operation: "deprovision-credential-orphan",
    principalId: principal.id,
    email,
    providerId: null,
    subject: null,
    auditId,
  };
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
    const context = await mixedModeCutoverContext(db, { ...(input.env ?? process.env) });
    const facts = context.identity.inspectSsoCutover(context.provider.id);
    if (input.operation.kind === "erase-empty-workspace") return eraseEmptyWorkspace(db, context, input.operation);
    const email = normalizeAccountEmail(input.operation.email);
    const principal = resolvePrincipal(facts, email);
    const repair = { db, context, principal, email };
    if (input.operation.kind === "assign-workspace-owner") {
      return assignWorkspaceOwner(repair, input.operation);
    }
    if (input.operation.kind === "remove-provider-link") {
      return removeProviderLink(repair, facts, input.operation);
    }
    return deprovisionCredentialOrphan(repair);
  } finally {
    db.close();
  }
}

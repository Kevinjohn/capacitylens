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
import { openDbConnection, planDatabaseMigrations } from "./db";
import { acquireExclusiveDatabaseLock } from "./resetOwnerPassword";
import { tx } from "./txn";
import { eraseWorkspaceProductDataInTx } from "./erasure";
import { eraseWorkspaceCommandHistoryInTx } from "./accounts/state";
import { mixedModeCutoverContext } from "./cutoverContext";
import { cutoverAuditEvent } from "./federatedLinkLifecycle";

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

/** Narrow, stopped-server repair for identities the all-workspace preflight names. It never accepts
 * a principal id from the operator: the normalized email, configured provider, and exact subject
 * must converge on one stored row before any deletion is possible. */
export async function repairSsoCutover(input: CutoverRepairInput): Promise<CutoverRepairResult> {
  if (!input.confirmServerStopped) throw new Error("Refusing without --confirm-server-stopped.");
  if (input.databasePath === ":memory:" || !existsSync(input.databasePath)) {
    throw new Error("The repair database must be an existing on-disk CapacityLens database.");
  }
  const email = "email" in input.operation ? normalizeAccountEmail(input.operation.email) : null;
  const db = openDbConnection(input.databasePath);
  try {
    acquireExclusiveDatabaseLock(db);
    const plan = planDatabaseMigrations(db);
    // v25 is the identity-link migration this tool may unblock. v26 adds only the reviewed,
    // default-off member sign-in confirmation shape; v27 adds only the optional resource-favourite
    // column; v28 adds only the required resource half-day JSON column with an empty default; and
    // v29 adds only the required resource engagement column with the Studio default; v30 adds
    // only the optional default-on engagement-grouping account preference; and v31 adds the
    // optional account working-day JSON selection with a deterministic legacy default; v32 adds
    // only the optional forward-only repeat-series identity on allocations; v33 widens
    // timeOff.resourceId to nullable; and v34 separates company closures and restores the
    // personal time-off resource requirement.
    // These are safe to remain pending before this stopped-server repair. Keep this allowlist explicit
    // so a future migration requires review.
    if (plan.migrations.some(({ version }) => ![25, 26, 27, 28, 29, 30, 31, 32, 33, 34].includes(version))) {
      throw new Error(
        `Database schema v${plan.fromVersion} has unrelated pending migrations; start the matching release before repair.`,
      );
    }
    if (plan.migrations.length === 0) assertFederatedIdentitySchemaCurrent(db);
    if (["assign-workspace-owner", "erase-empty-workspace"].includes(input.operation.kind)) {
      assertAccountControlPlaneSchemaCurrent(db);
    } else {
      assertAccountControlPlaneCurrent(db);
    }
    assertAuditOutboxCurrent(db);
    const context = await mixedModeCutoverContext(db, { ...(input.env ?? process.env) });
    const { identity, administration } = context;
    const facts = identity.inspectSsoCutover(context.provider.id);
    if (input.operation.kind === "erase-empty-workspace") {
      const operation = input.operation;
      const workspace = administration
        .inspectSsoCutoverWorkspaces()
        .find((candidate) => candidate.workspaceId === operation.workspaceId);
      if (!workspace) throw new Error("No workspace matches that exact id.");
      if (workspace.members.length > 0) throw new Error("Only a workspace with zero active members can be erased.");
      const occurredAt = new Date().toISOString() as AccountAuditEvent["occurredAt"];
      const auditId = randomUUID();
      tx(
        db,
        () => {
          eraseWorkspaceProductDataInTx(db, workspace.workspaceId);
          administration.eraseWorkspaceAdministrationInTx(workspace.workspaceId);
          eraseWorkspaceCommandHistoryInTx(db, workspace.workspaceId);
          enqueueAudit(
            db,
            cutoverAuditEvent(auditId, occurredAt, {
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
      return {
        operation: input.operation.kind,
        principalId: null,
        email: null,
        providerId: null,
        subject: null,
        auditId,
      };
    }
    const principals = facts.principals.filter((principal) => normalizeAccountEmail(principal.email) === email);
    if (principals.length !== 1) {
      throw new Error(
        principals.length === 0
          ? "No identity matches that address."
          : "More than one identity matches that address; repair requires an unambiguous target.",
      );
    }
    const principal = principals[0]!;
    const occurredAt = new Date().toISOString() as AccountAuditEvent["occurredAt"];
    const auditId = randomUUID();

    if (input.operation.kind === "assign-workspace-owner") {
      const operation = input.operation;
      const workspace = administration
        .inspectSsoCutoverWorkspaces()
        .find((candidate) => candidate.workspaceId === operation.workspaceId);
      if (!workspace) throw new Error("No workspace matches that exact id.");
      if (workspace.members.some((member) => member.role === "owner")) {
        throw new Error("The workspace already has an active Owner.");
      }
      if (!workspace.members.some((member) => member.principalId === principal.id)) {
        throw new Error("The selected identity is not an active member of that workspace.");
      }
      tx(
        db,
        () => {
          if (!administration.repairOwnerlessWorkspaceInTx(workspace.workspaceId, principal.id)) {
            throw new Error("The owner repair target changed before commit.");
          }
          enqueueAudit(
            db,
            cutoverAuditEvent(auditId, occurredAt, {
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
      return {
        operation: input.operation.kind,
        principalId: principal.id,
        email,
        providerId: null,
        subject: null,
        auditId,
      };
    }

    if (input.operation.kind === "remove-provider-link") {
      const operation = input.operation;
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
      const audit: AccountAuditEvent = cutoverAuditEvent(auditId, occurredAt, {
        applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
        workspaceId: null,
        actorPrincipalId: null,
        targetPrincipalId: principal.id,
        action: "identity.federated_link_removed",
        changedFields: ["federatedIdentity", "sessions"],
      });
      const changed = await identity.removeFederatedLinkForStoppedRepair({
        principalId: principal.id,
        providerId: operation.providerId,
        rowId: links[0]!.rowId,
        subject: links[0]!.subject,
        audit,
      });
      if (!changed) throw new Error("The provider link disappeared before repair completed.");
      return {
        operation: input.operation.kind,
        principalId: principal.id,
        email,
        providerId: operation.providerId,
        subject: operation.subject,
        auditId,
      };
    }

    const memberships = administration
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
    const audit: AccountAuditEvent = cutoverAuditEvent(auditId, occurredAt, {
      applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
      workspaceId: null,
      actorPrincipalId: null,
      targetPrincipalId: principal.id,
      action: "identity.local_deprovisioned",
      changedFields: ["localIdentity", "credential", "sessions"],
    });
    tx(
      db,
      () => {
        identity.deprovisionLocalPrincipalInTx(principal.id);
        enqueueAudit(db, audit, audit.id);
      },
      "immediate",
    );
    return {
      operation: input.operation.kind,
      principalId: principal.id,
      email,
      providerId: null,
      subject: null,
      auditId,
    };
  } finally {
    db.close();
  }
}

import { AccountContractError } from "@capacitylens/shared/account/errors";
import type {
  AccountAuditPort,
  AccountFlows,
  CommandOutcome,
  ReconciliationRepairKind,
  InviteSignupResult,
  MemberDirectoryEntry,
} from "@capacitylens/shared/account/ports";
import type { ActorContext, CommandIdentity, PasswordResetCeremony } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import { tx } from "../txn";
import {
  beginCommand,
  completeCommand,
  correlatePendingAccountCommand,
  eraseWorkspaceCommandHistoryInTx,
  getAccountCommandById,
  getAccountCommandByIdForReconciliation,
  markAccountCommandReplay,
  readCommand,
  resumeExistingCommand,
  secretDigest,
  terminateCommand,
  terminatePendingCommand,
} from "./commands";
import { KeyedOperationLock } from "./operationLock";
import type { AccountAdminPort, IdentityPort } from "@capacitylens/shared/account/ports";
import type { LocalIdentityPort } from "./betterAuthIdentityPort";
import type { LocalAccountAdminPort } from "./sqliteAccountAdminPort";
import { WriteOnceSecretReplay } from "./writeOnceSecretReplay";
import { accountAuditWriter, recordTerminalOutcome, type AccountAuditInput } from "./accountFlowRuntime";

type RepairCoordinate = "workspaceId" | "targetPrincipalId" | "provisionalPrincipalId" | "ceremonyId";

const WORKSPACE_ERASURE_SNAPSHOT_MAX_ATTEMPTS = 3;

const repairRequirements: Readonly<
  Record<
    ReconciliationRepairKind,
    {
      operation?: Parameters<AccountFlows["reconcileCommand"]>[0]["operation"];
      coordinates: readonly RepairCoordinate[];
    }
  >
> = {
  "invitation-claim-committed": {
    operation: "invite-password-signup",
    coordinates: ["workspaceId", "targetPrincipalId", "provisionalPrincipalId"],
  },
  "provisional-principal-compensation-failed": {
    operation: "invite-password-signup",
    coordinates: ["targetPrincipalId", "provisionalPrincipalId"],
  },
  "password-reset-issued": {
    operation: "password-reset",
    coordinates: ["targetPrincipalId", "ceremonyId"],
  },
  "password-reset-outcome-unknown": {
    operation: "password-reset",
    coordinates: ["targetPrincipalId"],
  },
  "password-reset-revocation-failed": {
    operation: "password-reset",
    coordinates: ["targetPrincipalId", "ceremonyId"],
  },
  "session-revocation-outcome-unknown": {
    operation: "session-revocation",
    coordinates: ["targetPrincipalId"],
  },
  "stale-pending": { coordinates: [] },
  "operator-review": { coordinates: [] },
};

function isReconciliationRepairKind(value: string): value is ReconciliationRepairKind {
  return Object.hasOwn(repairRequirements, value);
}

export class CorruptAccountCommandStateError extends Error {
  readonly code = "ACCOUNT_COMMAND_STATE_CORRUPT";
  readonly commandId: string;

  constructor(commandId: string) {
    super(`Account command ${commandId} has corrupt reconciliation metadata; preserve the row for operator repair.`);
    this.name = "CorruptAccountCommandStateError";
    this.commandId = commandId;
  }
}

function storedReconciliationRepair(
  row: NonNullable<ReturnType<typeof getAccountCommandByIdForReconciliation>>,
  operation: Parameters<AccountFlows["reconcileCommand"]>[0]["operation"],
): Record<string, unknown> & { kind: ReconciliationRepairKind } {
  // Released legacy rows may have no structured repair metadata. Preserve their explicit generic
  // operator-review fallback, but never equate present corrupt bytes with that legacy state.
  if (row.resultJson === null) return { kind: "operator-review" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.resultJson);
  } catch {
    throw new CorruptAccountCommandStateError(row.commandId);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CorruptAccountCommandStateError(row.commandId);
  }
  const stored = parsed as Record<string, unknown>;
  if (typeof stored.kind !== "string" || stored.kind.trim() === "") {
    throw new CorruptAccountCommandStateError(row.commandId);
  }
  if (!isReconciliationRepairKind(stored.kind)) {
    throw new CorruptAccountCommandStateError(row.commandId);
  }
  const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
  const coordinates: readonly RepairCoordinate[] = [
    "workspaceId",
    "targetPrincipalId",
    "provisionalPrincipalId",
    "ceremonyId",
  ];
  for (const coordinate of coordinates) {
    const value = stored[coordinate];
    if (value !== undefined && value !== null && !nonEmptyString(value)) {
      throw new CorruptAccountCommandStateError(row.commandId);
    }
  }
  const requirement = repairRequirements[stored.kind];
  if (
    requirement &&
    ((requirement.operation !== undefined && requirement.operation !== operation) ||
      requirement.coordinates.some((coordinate) => !nonEmptyString(stored[coordinate])))
  ) {
    throw new CorruptAccountCommandStateError(row.commandId);
  }
  return { ...stored, kind: stored.kind };
}

export interface LocalAccountFlows extends AccountFlows {
  provisionWorkspace<T>(input: {
    actor: ActorContext;
    workspaceId: string;
    joinedAt: string;
    command: CommandIdentity;
    multiWorkspace: boolean;
    bootstrapAuthorized: boolean;
    canonicalProductPayload: unknown;
    provisionProductData: () => T;
  }): Promise<{
    product: T;
    membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
    replayed: boolean;
  }>;
  replayWorkspaceProvisioning<T>(input: {
    actor: ActorContext;
    workspaceId: string;
    command: CommandIdentity;
    canonicalProductPayload: unknown;
  }): Promise<{
    product: T;
    membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
    replayed: true;
  } | null>;
  replayWorkspaceErasure(input: {
    actor: ActorContext;
    workspaceId: string;
    command: CommandIdentity;
  }): Promise<{ commandId: string; completedAt: string } | null>;
  eraseWorkspace(input: {
    actor: ActorContext;
    workspaceId: string;
    command: CommandIdentity;
    auditProductMutationInTx?: () => void;
  }): Promise<{ commandId: string; completedAt: string }>;
  provisionWorkspaceInExistingTransaction(input: {
    workspaceId: string;
    principalId: string;
    joinedAt: string;
    multiWorkspace: boolean;
    projectedWorkspaceCount: number;
  }): void;
  withWorkspaceErasureLocks<T>(
    workspaceIds: readonly string[],
    operation: () => Promise<T> | T,
    options?: { serializeWorkspaceProvisioning?: boolean },
  ): Promise<T>;
}

function denied(
  reason: string,
  action: "issue-password-reset" | "revoke-sessions",
  commandId?: string,
): AccountContractError {
  return new AccountContractError({
    code: reason === "target-not-member" ? "NOT_FOUND" : "FORBIDDEN",
    message:
      reason === "target-not-member"
        ? "The target is not a member of this installation."
        : action === "issue-password-reset"
          ? "This member belongs to another account where you lack password-reset authority."
          : "You lack session-revocation authority for this identity.",
    retryable: false,
    commandId,
  });
}

function authorityChanged(commandId: string): AccountContractError {
  return new AccountContractError({
    code: "AUTHORITY_CHANGED",
    message: "Identity-administration authority changed while the operation was in progress.",
    retryable: true,
    commandId,
  });
}

function isAuthorityDenial(error: unknown): boolean {
  return (
    error instanceof AccountContractError &&
    ["FORBIDDEN", "NOT_MEMBER", "SESSION_NOT_FRESH", "MFA_REQUIRED"].includes(error.failure.code)
  );
}

function replayCapacityExceeded(commandId: string, retryAfterMs: number): AccountContractError {
  return new AccountContractError({
    code: "RATE_LIMITED",
    message: "One-time link issuance is temporarily busy. Retry after the indicated interval.",
    retryable: true,
    retryAfterSeconds: Math.ceil(retryAfterMs / 1_000),
    commandId,
  });
}

export function actorContextFromSession(
  input: {
    id: string;
    principal: { id: string };
    freshUntil: string | null;
    assurance: "trusted-local" | "password" | "mfa" | "federated";
  },
  now = Date.now(),
): ActorContext {
  return {
    principalId: input.principal.id,
    sessionId: input.id,
    assurance: input.assurance,
    fresh: input.freshUntil !== null && Date.parse(input.freshUntil) > now,
    mfaSatisfied: input.assurance === "mfa" || input.assurance === "federated" || input.assurance === "trusted-local",
  };
}

/** Cross-port orchestration with explicit transaction and command-ledger ownership. Policy
 * decisions remain inside AccountAdminPort; durable ledger representation remains in commands.ts. */
export function localAccountFlows(input: {
  applicationId: string;
  db: Db;
  identity: LocalIdentityPort;
  administration: LocalAccountAdminPort;
  lock: KeyedOperationLock;
  eraseProductWorkspaceInTx(workspaceId: string): void;
  audit?: AccountAuditPort;
  /** Test seam; production uses the bounded default. */
  writeOnceReplayCapacity?: number;
}): LocalAccountFlows {
  const { applicationId, db, identity, administration, lock, eraseProductWorkspaceInTx } = input;
  const audit = accountAuditWriter(applicationId, input.audit);
  const persistTerminalOutcome = (write: () => boolean | void, event: AccountAuditInput): boolean | void =>
    tx(
      db,
      () => {
        const result = write();
        if (result === false) return false;
        audit(event);
        return result;
      },
      "immediate",
    );
  const resetReplay = new WriteOnceSecretReplay<PasswordResetCeremony>(input.writeOnceReplayCapacity ?? 128);
  // Every live coordinator execution and its reconciliation read share this key. The NUL prefix
  // sorts before all external principal/workspace keys, so invitation signup may safely discover
  // and acquire those keys later without violating KeyedOperationLock's global order.
  const commandExecutionKey = (command: CommandIdentity): string =>
    `\0account-command:${applicationId}:${command.commandId}`;

  return {
    async replayWorkspaceProvisioning<T>({
      actor,
      workspaceId,
      command,
      canonicalProductPayload,
    }: {
      actor: ActorContext;
      workspaceId: string;
      command: CommandIdentity;
      canonicalProductPayload: unknown;
    }) {
      return lock.withKeys([commandExecutionKey(command), actor.principalId], () => {
        const operation = `workspace-provisioning:actor:${actor.principalId}`;
        if (!readCommand(db, applicationId, operation, command)) return null;
        const begun = beginCommand<{
          product: unknown;
          membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
        }>(
          db,
          {
            applicationId,
            operation,
            actorPrincipalId: actor.principalId,
            targetPrincipalId: actor.principalId,
            workspaceId,
          },
          command,
          { workspaceId, product: canonicalProductPayload },
        );
        if (begun.kind !== "replay") {
          throw new AccountContractError({
            code: "COMMAND_IN_PROGRESS",
            message: "That workspace-provisioning command is still in progress.",
            retryable: true,
            commandId: command.commandId,
          });
        }
        return { ...begun.result, replayed: true };
      }) as Promise<{
        product: T;
        membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
        replayed: true;
      } | null>;
    },

    async replayWorkspaceErasure({ actor, workspaceId, command }) {
      return lock.withKeys([commandExecutionKey(command), actor.principalId], () => {
        const operation = "workspace-erasure";
        const existing = readCommand(db, applicationId, operation, command);
        // Only a committed success may bypass live workspace authorization. New, pending and
        // failed commands continue through the ordinary Owner/fresh-session checks below.
        if (!existing || existing.status !== "completed") return null;
        const replay = resumeExistingCommand<{
          commandId: string;
          completedAt: string;
        }>(
          db,
          {
            applicationId,
            operation,
            // A successful erasure deliberately anonymises its retained receipt. Accept that
            // redacted scope only after the exact completed command has been found above; a live
            // principal binding must still match the authenticated caller.
            actorPrincipalId: existing.actorPrincipalId === null ? null : actor.principalId,
            workspaceId,
          },
          command,
          { workspaceId },
        );
        return replay ? markAccountCommandReplay(replay.result) : null;
      });
    },

    async provisionWorkspace({
      actor,
      workspaceId,
      joinedAt,
      command,
      multiWorkspace,
      bootstrapAuthorized,
      canonicalProductPayload,
      provisionProductData,
    }) {
      return lock.withKeys(
        [
          commandExecutionKey(command),
          actor.principalId,
          `application:${applicationId}:workspace-provisioning`,
          `workspace:${workspaceId}`,
        ],
        async () => {
          const operation = `workspace-provisioning:actor:${actor.principalId}`;
          const scope = {
            applicationId,
            operation,
            actorPrincipalId: actor.principalId,
            targetPrincipalId: actor.principalId,
            workspaceId,
          };
          const begun = beginCommand<{
            product: unknown;
            membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
          }>(db, scope, command, {
            workspaceId,
            product: canonicalProductPayload,
          });
          if (begun.kind === "replay") {
            return {
              ...(begun.result as {
                product: ReturnType<typeof provisionProductData>;
                membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
              }),
              replayed: true,
            };
          }
          try {
            const result = tx(
              db,
              () => {
                const decision = administration.evaluateWorkspaceProvisioningAuthorityInTx({
                  actor,
                  multiWorkspace,
                  bootstrapAuthorized,
                });
                if (!decision.allowed) {
                  throw new AccountContractError({
                    code: "FORBIDDEN",
                    message:
                      decision.reason === "single-workspace-cap"
                        ? "This instance allows a single company. Set CAPACITYLENS_MULTI_ACCOUNT=1 to allow more."
                        : "Forbidden.",
                    retryable: false,
                    commandId: command.commandId,
                  });
                }
                const product = provisionProductData();
                const membership = administration.provisionOwnerMembershipInTx({
                  workspaceId,
                  principalId: actor.principalId,
                  joinedAt,
                });
                const result = { product, membership };
                completeCommand(db, scope, command, result);
                audit({
                  action: "workspace.provisioned",
                  outcome: "success",
                  workspaceId,
                  actorPrincipalId: actor.principalId,
                  targetPrincipalId: actor.principalId,
                  command,
                  changedFields: ["workspace", "membership"],
                });
                return result;
              },
              "immediate",
            );
            return { ...result, replayed: false };
          } catch (error) {
            recordTerminalOutcome(error, () =>
              tx(
                db,
                () => {
                  terminateCommand(
                    db,
                    scope,
                    command,
                    "compensated",
                    error instanceof AccountContractError ? error.failure.code : "CONFLICT",
                  );
                  const deniedOutcome = isAuthorityDenial(error);
                  audit({
                    action: deniedOutcome ? "workspace.provisioned" : "flow.compensated",
                    outcome: deniedOutcome ? "denied" : "compensated",
                    workspaceId,
                    actorPrincipalId: actor.principalId,
                    command,
                  });
                },
                "immediate",
              ),
            );
            throw error;
          }
        },
      );
    },

    async eraseWorkspace({ actor, workspaceId, command, auditProductMutationInTx }) {
      const eraseWithMembershipSnapshot = async (
        principalIds: readonly string[],
        attempt: number,
      ): Promise<{ commandId: string; completedAt: string }> => {
        const locked = new Set(principalIds);
        const result = await lock.withKeys(
          [commandExecutionKey(command), actor.principalId, `workspace:${workspaceId}`, ...principalIds],
          async (): Promise<
            | { kind: "retry"; principalIds: readonly string[] }
            | {
                kind: "done";
                value: { commandId: string; completedAt: string };
              }
          > => {
            // The membership snapshot was taken synchronously before lock acquisition. A mutation
            // that already held the workspace lock may have added a principal while we waited.
            // Re-snapshot under the workspace lock and retry with the full key set before deleting;
            // this keeps identity-admin operations serialized with every principal being erased.
            const currentPrincipalIds = administration.workspacePrincipalIds(workspaceId);
            if (currentPrincipalIds.some((principalId) => !locked.has(principalId))) {
              return { kind: "retry", principalIds: currentPrincipalIds };
            }
            // Do not embed the soon-to-be-erased actor id in the durable operation key. The row is
            // retained briefly for safe client replay after erasure, with principal/workspace
            // columns anonymized in the same transaction.
            const operation = "workspace-erasure";
            const scope = {
              applicationId,
              operation,
              actorPrincipalId: actor.principalId,
              workspaceId,
            };
            const begun = beginCommand<{
              commandId: string;
              completedAt: string;
            }>(db, scope, command, { workspaceId });
            if (begun.kind === "replay") {
              return {
                kind: "done",
                value: markAccountCommandReplay(begun.result),
              };
            }
            try {
              const erased = tx(
                db,
                () => {
                  administration.assertWorkspaceErasureAuthorityInTx(actor, workspaceId);
                  eraseProductWorkspaceInTx(workspaceId);
                  const orphaned = administration.eraseWorkspaceAdministrationInTx(workspaceId);
                  identity.deprovisionLocalPrincipalsInTx(orphaned, command.commandId);
                  auditProductMutationInTx?.();
                  const receipt = {
                    commandId: command.commandId,
                    completedAt: new Date().toISOString(),
                  };
                  eraseWorkspaceCommandHistoryInTx(db, workspaceId, command.commandId);
                  completeCommand(db, scope, command, receipt);
                  for (const principalId of orphaned) {
                    audit({
                      action: "identity.local_deprovisioned",
                      outcome: "success",
                      workspaceId,
                      actorPrincipalId: actor.principalId,
                      targetPrincipalId: principalId,
                      command,
                      changedFields: ["localPrincipal"],
                    });
                  }
                  audit({
                    action: "workspace.erased",
                    outcome: "success",
                    workspaceId,
                    actorPrincipalId: actor.principalId,
                    command,
                    changedFields: ["workspace", "memberships", "localPrincipals"],
                  });
                  return { receipt, orphaned };
                },
                "immediate",
              );
              return { kind: "done", value: erased.receipt };
            } catch (error) {
              recordTerminalOutcome(error, () =>
                tx(
                  db,
                  () => {
                    terminateCommand(
                      db,
                      scope,
                      command,
                      "compensated",
                      error instanceof AccountContractError ? error.failure.code : "CONFLICT",
                    );
                    audit({
                      action: "flow.compensated",
                      outcome: "compensated",
                      workspaceId,
                      actorPrincipalId: actor.principalId,
                      command,
                    });
                  },
                  "immediate",
                ),
              );
              throw error;
            }
          },
        );
        if (result.kind === "done") return result.value;
        if (attempt >= WORKSPACE_ERASURE_SNAPSHOT_MAX_ATTEMPTS) {
          throw new AccountContractError({
            code: "CONFLICT",
            message: "Company membership changed repeatedly during erasure. Retry the request.",
            retryable: true,
            commandId: command.commandId,
          });
        }
        return eraseWithMembershipSnapshot(result.principalIds, attempt + 1);
      };
      return eraseWithMembershipSnapshot(administration.workspacePrincipalIds(workspaceId), 1);
    },

    provisionWorkspaceInExistingTransaction({
      workspaceId,
      principalId,
      joinedAt,
      multiWorkspace,
      projectedWorkspaceCount,
    }): void {
      const decision = administration.evaluateWorkspaceProvisioningAuthorityInTx({
        actor: {
          principalId,
          sessionId: "trusted-local",
          assurance: "trusted-local",
          fresh: true,
          mfaSatisfied: true,
        },
        multiWorkspace,
        bootstrapAuthorized: false,
        projectedWorkspaceCount,
      });
      if (!decision.allowed) {
        throw new AccountContractError({
          code: "FORBIDDEN",
          message:
            decision.reason === "single-workspace-cap"
              ? "This instance allows a single company. Set CAPACITYLENS_MULTI_ACCOUNT=1 to allow more."
              : "Forbidden.",
          retryable: false,
        });
      }
      administration.provisionOwnerMembershipInTx({
        workspaceId,
        principalId,
        joinedAt,
      });
    },

    async withWorkspaceErasureLocks<T>(
      workspaceIds: readonly string[],
      operation: () => Promise<T> | T,
      options: { serializeWorkspaceProvisioning?: boolean } = {},
    ): Promise<T> {
      const uniqueWorkspaceIds = [...new Set(workspaceIds)];
      const runWithSnapshot = async (principalIds: readonly string[], attempt: number): Promise<T> => {
        const locked = new Set(principalIds);
        const result = await lock.withKeys(
          [
            ...(options.serializeWorkspaceProvisioning ? [`application:${applicationId}:workspace-provisioning`] : []),
            ...uniqueWorkspaceIds.map((workspaceId) => `workspace:${workspaceId}`),
            ...principalIds,
          ],
          async () => {
            const current = uniqueWorkspaceIds.flatMap((workspaceId) =>
              administration.workspacePrincipalIds(workspaceId),
            );
            if (current.some((principalId) => !locked.has(principalId))) {
              return { kind: "retry" as const, principalIds: current };
            }
            return { kind: "done" as const, value: await operation() };
          },
        );
        if (result.kind === "done") return result.value;
        if (attempt >= WORKSPACE_ERASURE_SNAPSHOT_MAX_ATTEMPTS) {
          throw new AccountContractError({
            code: "CONFLICT",
            message: "Company membership changed repeatedly during erasure. Retry the request.",
            retryable: true,
          });
        }
        return runWithSnapshot(result.principalIds, attempt + 1);
      };
      const initial = uniqueWorkspaceIds.flatMap((workspaceId) => administration.workspacePrincipalIds(workspaceId));
      return runWithSnapshot(initial, 1);
    },

    async resolveRequestAccess({ headers, workspaceId }) {
      const session = await identity.verifyApplicationSession({ headers });
      if (!session) return null;
      const membership = await administration.getMembership({
        principalId: session.principal.id,
        workspaceId,
      });
      return membership ? { session, membership } : null;
    },

    async listMemberDirectory({ actor, workspaceId }): Promise<readonly MemberDirectoryEntry[]> {
      const memberships = await administration.listMemberships({
        actor,
        workspaceId,
      });
      const principals = await identity.getPrincipalSummaries({
        principalIds: memberships.map((entry) => entry.principalId),
      });
      const byId = new Map(principals.map((principal) => [principal.id, principal]));
      return memberships.map((entry) => ({
        membership: entry,
        principal: byId.get(entry.principalId) ?? null,
      }));
    },

    async acceptInviteWithPasswordSignup({
      token,
      email,
      displayName,
      password,
      command,
    }): Promise<InviteSignupResult> {
      return lock.withKeys([commandExecutionKey(command)], async () => {
        const operation = "invite-password-signup";
        const scope = { applicationId, operation, actorPrincipalId: null };
        const canonicalPayload = {
          // Bind the full credential-bearing request without persisting either bearer, or a
          // standalone password verifier that a ledger reader could attack independently. Testing a
          // password candidate requires possession of the high-entropy invitation token as well.
          credentialBindingDigest: secretDigest("invite-signup-credentials", `${token}\0${password}`),
          normalizedEmail: email.trim().toLowerCase(),
          displayName,
        };
        const replay = resumeExistingCommand<InviteSignupResult>(db, scope, command, canonicalPayload);
        if (replay) return markAccountCommandReplay(replay.result);

        // The invitation is the only authority on this unauthenticated route. Validate it before
        // reserving a command so arbitrary invalid bearer values cannot amplify durable SQLite
        // writes. Completed retries were handled by the read-only lookup above because their
        // legitimate single-use invitation has already been consumed.
        const admission = await administration.preparePasswordInvitationClaim({
          token,
          normalizedEmail: email,
        });
        const begun = beginCommand<InviteSignupResult>(db, scope, command, canonicalPayload);
        if (begun.kind === "replay") return markAccountCommandReplay(begun.result);

        let provisional: Awaited<ReturnType<IdentityPort["createProvisionalCredentialPrincipal"]>> | null = null;
        const claimState: {
          committed: boolean;
          membership: InviteSignupResult["membership"] | null;
        } = {
          committed: false,
          membership: null,
        };
        try {
          correlatePendingAccountCommand(db, {
            applicationId,
            operation,
            idempotencyKey: command.idempotencyKey,
            workspaceId: admission.workspaceId,
          });
          provisional = await identity.createCorrelatedProvisionalCredentialPrincipal({
            email,
            displayName,
            password,
            emailVerified: admission.emailVerifiedByInvitation,
            command,
            // The embedded identity adapter invokes this after inserting the user and credential link
            // but before their shared SQLite transaction commits. A crash can therefore leave either
            // all three durable facts or none, never an uncorrelated provisional principal.
            correlatePrincipalInTransaction: (principalId) =>
              correlatePendingAccountCommand(db, {
                applicationId,
                operation,
                idempotencyKey: command.idempotencyKey,
                workspaceId: admission.workspaceId,
                targetPrincipalId: principalId,
              }),
          });
          return await lock.withKeys([provisional.principalId, `workspace:${admission.workspaceId}`], async () => {
            const membership = await administration.claimInvitationForPrincipal({
              token,
              principalId: provisional!.principalId,
              principalEmail: email,
              emailVerified: admission.emailVerifiedByInvitation,
              passwordMode: true,
              command: {
                commandId: `${command.commandId}:claim`,
                idempotencyKey: `${command.idempotencyKey}:claim`,
              },
            });
            claimState.committed = true;
            claimState.membership = membership;
            const result: InviteSignupResult = {
              principalId: provisional!.principalId,
              membership,
              compensated: false,
            };
            // Keep the principal/workspace keys through parent completion. Otherwise workspace
            // erasure could delete both command rows after the child claim commits but before this
            // durable parent outcome is recorded, leaving the browser with nothing to reconcile.
            completeCommand(db, scope, command, result);
            return result;
          });
        } catch (claimError) {
          if (claimState.committed) {
            recordTerminalOutcome(claimError, () =>
              persistTerminalOutcome(
                () =>
                  terminatePendingCommand(db, scope, command, "reconciliation_required", "DEPENDENCY_UNAVAILABLE", {
                    kind: "invitation-claim-committed",
                    workspaceId: claimState.membership?.workspaceId ?? null,
                    targetPrincipalId: provisional?.principalId ?? null,
                    provisionalPrincipalId: provisional?.principalId ?? null,
                    ceremonyId: null,
                  }),
                {
                  action: "flow.reconciliation_required",
                  outcome: "failed",
                  workspaceId: claimState.membership?.workspaceId ?? null,
                  targetPrincipalId: provisional?.principalId ?? null,
                  command,
                  changedFields: ["commandLedger"],
                },
              ),
            );
            throw new AccountContractError(
              {
                code: "DEPENDENCY_UNAVAILABLE",
                message: "The invitation was claimed, but completion must be reconciled before retrying.",
                retryable: true,
                commandId: command.commandId,
              },
              { cause: claimError },
            );
          }
          if (!provisional) {
            recordTerminalOutcome(claimError, () =>
              persistTerminalOutcome(
                () =>
                  terminateCommand(
                    db,
                    scope,
                    command,
                    "compensated",
                    claimError instanceof AccountContractError ? claimError.failure.code : "CONFLICT",
                  ),
                { action: "flow.compensated", outcome: "compensated", command },
              ),
            );
            throw claimError;
          }
          const provisionalPrincipalId = provisional.principalId;
          let compensationError: unknown = null;
          try {
            await identity.compensateProvisionalPrincipal({
              provisional,
              reason: "invitation-claim-failed",
              command,
            });
          } catch (error) {
            compensationError = error;
          }
          if (compensationError === null) {
            recordTerminalOutcome(claimError, () =>
              persistTerminalOutcome(
                () =>
                  terminateCommand(
                    db,
                    scope,
                    command,
                    "compensated",
                    claimError instanceof AccountContractError ? claimError.failure.code : "CONFLICT",
                  ),
                {
                  action: "flow.compensated",
                  outcome: "compensated",
                  targetPrincipalId: provisionalPrincipalId,
                  command,
                  changedFields: ["localPrincipal"],
                },
              ),
            );
            throw claimError;
          }
          const combinedFailure = new AggregateError([claimError, compensationError]);
          recordTerminalOutcome(combinedFailure, () =>
            persistTerminalOutcome(
              () =>
                terminateCommand(db, scope, command, "reconciliation_required", "COMPENSATION_FAILED", {
                  kind: "provisional-principal-compensation-failed",
                  workspaceId: null,
                  targetPrincipalId: provisionalPrincipalId,
                  provisionalPrincipalId,
                  ceremonyId: null,
                }),
              {
                action: "flow.reconciliation_required",
                outcome: "failed",
                targetPrincipalId: provisionalPrincipalId,
                command,
                changedFields: ["localPrincipal"],
              },
            ),
          );
          throw new AccountContractError(
            {
              code: "COMPENSATION_FAILED",
              message: "Invitation claim failed and the provisional local identity could not be removed.",
              retryable: true,
              commandId: command.commandId,
            },
            { cause: combinedFailure },
          );
        }
      });
    },

    async issuePasswordReset({ actor, targetPrincipalId, command }) {
      return lock.withKeys([commandExecutionKey(command), actor.principalId, targetPrincipalId], async () => {
        const operation = `password-reset:actor:${actor.principalId}`;
        const scope = {
          applicationId,
          operation,
          actorPrincipalId: actor.principalId,
          targetPrincipalId,
        };
        const begun = beginCommand<Omit<PasswordResetCeremony, "token">>(db, scope, command, {
          targetPrincipalId,
        });
        if (begun.kind === "replay") {
          // Replaying this command re-discloses a write-once bearer token, so idempotency must not
          // bypass authority changes that happened after its original issuance.
          const decision = await administration.evaluateIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: "issue-password-reset",
          });
          if (!decision.allowed) {
            throw denied(decision.reason, "issue-password-reset", begun.record.commandId);
          }
          const confirmed = await administration.confirmIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: "issue-password-reset",
            expectedRevision: decision.revision,
          });
          if (!confirmed) throw authorityChanged(begun.record.commandId);
          const replay = resetReplay.get(begun.record.commandId);
          if (replay) return markAccountCommandReplay(replay);
          throw new AccountContractError({
            code: "CONFLICT",
            message: "The reset command already completed; its write-once token is no longer available.",
            retryable: false,
            commandId: begun.record.commandId,
          });
        }
        let issuanceStarted = false;
        let ceremony: PasswordResetCeremony | null = null;
        let terminalOutcomeRecorded = false;
        try {
          const decision = await administration.evaluateIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: "issue-password-reset",
          });
          if (!decision.allowed) {
            persistTerminalOutcome(
              () =>
                terminateCommand(
                  db,
                  scope,
                  command,
                  "compensated",
                  decision.reason === "target-not-member" ? "NOT_FOUND" : "FORBIDDEN",
                ),
              {
                action: "identity.password_reset_issued",
                outcome: "denied",
                actorPrincipalId: actor.principalId,
                targetPrincipalId,
                command,
              },
            );
            terminalOutcomeRecorded = true;
            throw denied(decision.reason, "issue-password-reset", command.commandId);
          }
          const reservation = resetReplay.reserve(command.commandId);
          if (!reservation.accepted) {
            const capacityError = replayCapacityExceeded(command.commandId, reservation.retryAfterMs);
            persistTerminalOutcome(() => terminateCommand(db, scope, command, "compensated", "RATE_LIMITED"), {
              action: "identity.password_reset_issued",
              outcome: "failed",
              actorPrincipalId: actor.principalId,
              targetPrincipalId,
              command,
            });
            terminalOutcomeRecorded = true;
            throw capacityError;
          }
          issuanceStarted = true;
          ceremony = await identity.issuePasswordReset({
            targetPrincipalId,
            command,
          });
          const confirmed = await administration.confirmIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: "issue-password-reset",
            expectedRevision: decision.revision,
          });
          if (!confirmed) {
            const changed = authorityChanged(command.commandId);
            const ceremonyId = ceremony.ceremonyId;
            try {
              await identity.revokePasswordResetCeremony({
                targetPrincipalId,
                ceremonyId,
                command,
              });
            } catch (revokeError) {
              recordTerminalOutcome(revokeError, () =>
                persistTerminalOutcome(
                  () =>
                    terminateCommand(db, scope, command, "reconciliation_required", "COMPENSATION_FAILED", {
                      kind: "password-reset-revocation-failed",
                      workspaceId: null,
                      targetPrincipalId,
                      provisionalPrincipalId: null,
                      ceremonyId,
                    }),
                  {
                    action: "flow.reconciliation_required",
                    outcome: "failed",
                    actorPrincipalId: actor.principalId,
                    targetPrincipalId,
                    command,
                    changedFields: ["passwordResetCeremony"],
                  },
                ),
              );
              terminalOutcomeRecorded = true;
              throw new AccountContractError(
                {
                  code: "COMPENSATION_FAILED",
                  message: "Authority changed and the new reset ceremony could not be revoked.",
                  retryable: true,
                  commandId: command.commandId,
                },
                { cause: revokeError },
              );
            }
            recordTerminalOutcome(changed, () =>
              persistTerminalOutcome(() => terminateCommand(db, scope, command, "compensated", "AUTHORITY_CHANGED"), {
                action: "flow.compensated",
                outcome: "compensated",
                actorPrincipalId: actor.principalId,
                targetPrincipalId,
                command,
                changedFields: ["passwordResetCeremony"],
              }),
            );
            terminalOutcomeRecorded = true;
            throw changed;
          }
          persistTerminalOutcome(
            () =>
              completeCommand(db, scope, command, {
                ceremonyId: ceremony!.ceremonyId,
                expiresAt: ceremony!.expiresAt,
              }),
            {
              action: "identity.password_reset_issued",
              outcome: "success",
              actorPrincipalId: actor.principalId,
              targetPrincipalId,
              command,
              changedFields: ["credential"],
            },
          );
          resetReplay.storeReserved(command.commandId, ceremony);
          return ceremony;
        } catch (error) {
          // A completed response is not a reservation, so this only releases capacity when issuance
          // failed or was compensated before the write-once value could be returned.
          resetReplay.releaseReservation(command.commandId);
          const code = error instanceof AccountContractError ? error.failure.code : "DEPENDENCY_UNAVAILABLE";
          const knownWithoutCeremony =
            error instanceof AccountContractError &&
            (error.failure.code === "NOT_FOUND" ||
              error.failure.code === "VALIDATION_FAILED" ||
              error.failure.code === "UNSUPPORTED_CAPABILITY");
          const requiresReconciliation =
            issuanceStarted &&
            !(error instanceof AccountContractError && error.failure.code === "AUTHORITY_CHANGED") &&
            !knownWithoutCeremony;
          if (!terminalOutcomeRecorded) {
            recordTerminalOutcome(error, () =>
              persistTerminalOutcome(
                () =>
                  terminatePendingCommand(
                    db,
                    scope,
                    command,
                    requiresReconciliation ? "reconciliation_required" : "compensated",
                    requiresReconciliation ? "DEPENDENCY_UNAVAILABLE" : code,
                    requiresReconciliation
                      ? {
                          kind: ceremony ? "password-reset-issued" : "password-reset-outcome-unknown",
                          workspaceId: null,
                          targetPrincipalId,
                          provisionalPrincipalId: null,
                          ceremonyId: ceremony?.ceremonyId ?? null,
                        }
                      : undefined,
                  ),
                {
                  action: requiresReconciliation ? "flow.reconciliation_required" : "flow.compensated",
                  outcome: requiresReconciliation ? "failed" : "compensated",
                  actorPrincipalId: actor.principalId,
                  targetPrincipalId,
                  command,
                  changedFields: requiresReconciliation
                    ? ["passwordResetCeremony", "commandLedger"]
                    : ["commandLedger"],
                },
              ),
            );
          }
          throw error;
        }
      });
    },

    async revokeMemberSessions({ actor, targetPrincipalId, command }) {
      return lock.withKeys([commandExecutionKey(command), actor.principalId, targetPrincipalId], async () => {
        const operation = `session-revocation:actor:${actor.principalId}`;
        const scope = {
          applicationId,
          operation,
          actorPrincipalId: actor.principalId,
          targetPrincipalId,
        };
        const begun = beginCommand<Awaited<ReturnType<IdentityPort["revokePrincipalSessions"]>>>(db, scope, command, {
          targetPrincipalId,
        });
        if (begun.kind === "replay") return markAccountCommandReplay(begun.result);
        let revocationStarted = false;
        let terminalOutcomeRecorded = false;
        try {
          const decision = await administration.evaluateIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: "revoke-sessions",
          });
          if (!decision.allowed) {
            persistTerminalOutcome(
              () =>
                terminateCommand(
                  db,
                  scope,
                  command,
                  "compensated",
                  decision.reason === "target-not-member" ? "NOT_FOUND" : "FORBIDDEN",
                ),
              {
                action: "identity.sessions_revoked",
                outcome: "denied",
                actorPrincipalId: actor.principalId,
                targetPrincipalId,
                command,
              },
            );
            terminalOutcomeRecorded = true;
            throw denied(decision.reason, "revoke-sessions", command.commandId);
          }
          revocationStarted = true;
          const result = await identity.revokePrincipalSessions({
            targetPrincipalId,
            command,
          });
          persistTerminalOutcome(() => completeCommand(db, scope, command, result), {
            action: "identity.sessions_revoked",
            outcome: "success",
            actorPrincipalId: actor.principalId,
            targetPrincipalId,
            command,
            changedFields: ["sessions"],
          });
          return result;
        } catch (error) {
          const code = error instanceof AccountContractError ? error.failure.code : "DEPENDENCY_UNAVAILABLE";
          if (!terminalOutcomeRecorded) {
            recordTerminalOutcome(error, () =>
              persistTerminalOutcome(
                () =>
                  terminatePendingCommand(
                    db,
                    scope,
                    command,
                    revocationStarted ? "reconciliation_required" : "compensated",
                    revocationStarted ? "DEPENDENCY_UNAVAILABLE" : code,
                    revocationStarted
                      ? {
                          kind: "session-revocation-outcome-unknown",
                          workspaceId: null,
                          targetPrincipalId,
                          provisionalPrincipalId: null,
                          ceremonyId: null,
                        }
                      : undefined,
                  ),
                {
                  action: revocationStarted ? "flow.reconciliation_required" : "identity.sessions_revoked",
                  outcome: "failed",
                  actorPrincipalId: actor.principalId,
                  targetPrincipalId,
                  command,
                  changedFields: revocationStarted ? ["sessions", "commandLedger"] : ["commandLedger"],
                },
              ),
            );
          }
          throw error;
        }
      });
    },

    async reconcileCommand({ command, operation }): Promise<CommandOutcome | null> {
      const matchesRequest = (row: ReturnType<typeof getAccountCommandById>): boolean =>
        row !== null &&
        row.idempotencyKey === command.idempotencyKey &&
        (row.operation === operation || row.operation.startsWith(`${operation}:actor:`));
      // Validate the reconciliation bearer before waiting on a possibly long-running command.
      // Only the second read may age the row, and it runs under the exact key held by every live
      // executor. After a process restart the process-local lock is absent, which is proof that a
      // stale pending row has no surviving executor in this supported single-process topology.
      if (!matchesRequest(getAccountCommandById(db, applicationId, command.commandId))) return null;
      return lock.withKeys([commandExecutionKey(command)], () => {
        const row = getAccountCommandByIdForReconciliation(db, applicationId, command.commandId);
        if (!matchesRequest(row) || row === null) return null;
        const receipt = {
          commandId: row.commandId,
          completedAt: row.updatedAt,
        };
        if (row.status === "completed") return { status: "completed", receipt };
        if (row.status === "compensated") return { status: "compensated", receipt };
        if (row.status === "pending") {
          return {
            status: "pending",
            receipt: { commandId: row.commandId, observedAt: row.updatedAt },
          };
        }
        if (row.status === "reconciliation_required") {
          const stored = storedReconciliationRepair(row, operation);
          return {
            status: "reconciliation-required",
            receipt: { commandId: row.commandId, observedAt: row.updatedAt },
            failure: {
              code: row.failureCode ?? "DEPENDENCY_UNAVAILABLE",
              message: "This command requires operator reconciliation before it can be retried.",
              retryable: true,
              commandId: row.commandId,
            },
            repair: {
              kind: stored.kind,
              workspaceId: typeof stored.workspaceId === "string" ? stored.workspaceId : row.workspaceId,
              targetPrincipalId:
                typeof stored.targetPrincipalId === "string" ? stored.targetPrincipalId : row.targetPrincipalId,
              provisionalPrincipalId:
                typeof stored.provisionalPrincipalId === "string" ? stored.provisionalPrincipalId : null,
              ceremonyId: typeof stored.ceremonyId === "string" ? stored.ceremonyId : null,
            },
          };
        }
        return {
          status: "pending",
          receipt: { commandId: row.commandId, observedAt: row.updatedAt },
        };
      });
    },
  };
}

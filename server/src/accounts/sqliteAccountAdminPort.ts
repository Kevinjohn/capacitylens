import type { StandardAccountAuditAction } from "@capacitylens/shared/account/audit";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { AccountAuditPort } from "@capacitylens/shared/account/ports";
import type { CommandIdentity, CreatedInvitation } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import { tx, type SynchronousCallback } from "../txn";
import { createAccountAuditWriter, recordTerminalOutcome } from "./accountFlowRuntime";
import { createAuthority } from "./adminPort/authority";
import type { AdminPortContext, SsoCutoverAccountAdminPort } from "./adminPort/contracts";
import { createCutover } from "./adminPort/cutover";
import { createInvitationClaims } from "./adminPort/invitationClaims";
import { createInvitations } from "./adminPort/invitations";
import { createMembership } from "./adminPort/membership";
import { beginCommand, completeCommand, markAccountCommandReplay, terminateCommand } from "./commands";
import { KeyedOperationLock } from "./KeyedOperationLock";
import { WriteOnceSecretReplay } from "./WriteOnceSecretReplay";
export { ACCOUNT_POLICY_VERSION, MAX_INVITATION_TTL_MS } from "./adminPort/contracts";

export type { LocalAccountAdminPort, SsoCutoverAccountAdminPort, SsoCutoverWorkspaceFact } from "./adminPort/contracts";
export {
  assertAccountControlPlaneCurrent,
  assertAccountControlPlaneSchemaCurrent,
  listSoleOwnerAccountIds,
} from "./adminPort/cutover";
export { hasLivePreauthorizedInvitation } from "./adminPort/invitations";

const MAX_SECRET_REPLAYS = 256;

interface CreateSqliteAccountAdminPortInput {
  applicationId: string;
  db: Db;
  lock: KeyedOperationLock;
  trustedLocal?: boolean;
  requireMfa?: boolean;
  audit?: AccountAuditPort;
  /** Test seam; production uses the bounded default. */
  writeOnceReplayCapacity?: number;
}

interface MutationOptions<Execute extends () => unknown> {
  operation: string;
  actorPrincipalId: string | null;
  targetPrincipalId?: string | null;
  workspaceId?: string | null;
  command: CommandIdentity;
  payload: unknown;
  lockKeys: readonly string[];
  execute: SynchronousCallback<Execute>;
  persistResult?: (result: ReturnType<Execute>) => unknown;
  replayResult?: (stored: unknown, commandId: string) => ReturnType<Execute>;
  replayGuard?: () => void;
  afterCommit?: (result: ReturnType<Execute>) => void;
  afterRollback?: () => void;
  audit?: { action: StandardAccountAuditAction; changedFields: readonly string[] };
}

interface MutationDependencies {
  applicationId: string;
  db: Db;
  lock: KeyedOperationLock;
  audit: ReturnType<typeof createAccountAuditWriter>;
}

function buildCommandScope(dependencies: MutationDependencies, options: MutationOptions<() => unknown>) {
  return {
    applicationId: dependencies.applicationId,
    operation: options.actorPrincipalId ? `${options.operation}:actor:${options.actorPrincipalId}` : options.operation,
    actorPrincipalId: options.actorPrincipalId,
    targetPrincipalId: options.targetPrincipalId ?? null,
    workspaceId: options.workspaceId ?? null,
  };
}

function writeMutationAudit(
  dependencies: MutationDependencies,
  options: MutationOptions<() => unknown>,
  outcome: "success" | "denied" | "failed",
): void {
  if (!options.audit) return;
  dependencies.audit({
    action: options.audit.action,
    outcome,
    ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId }),
    actorPrincipalId: options.actorPrincipalId,
    ...(options.targetPrincipalId === undefined ? {} : { targetPrincipalId: options.targetPrincipalId }),
    command: options.command,
    ...(outcome === "success" ? { changedFields: options.audit.changedFields } : {}),
  });
}

function isDeniedMutation(error: unknown): boolean {
  if (!(error instanceof AccountContractError)) return false;
  return ["FORBIDDEN", "NOT_MEMBER", "SESSION_NOT_FRESH", "MFA_REQUIRED"].includes(error.failure.code);
}

interface RecordFailedMutationInput {
  dependencies: MutationDependencies;
  options: MutationOptions<() => unknown>;
  scope: ReturnType<typeof buildCommandScope>;
  error: unknown;
}

function recordFailedMutation({ dependencies, options, scope, error }: RecordFailedMutationInput): void {
  recordTerminalOutcome(
    error,
    () => {
      tx(
        dependencies.db,
        () => {
          terminateCommand({
            db: dependencies.db,
            scope,
            command: options.command,
            status: "compensated",
            failureCode: error instanceof AccountContractError ? error.failure.code : "CONFLICT",
          });
          writeMutationAudit(dependencies, options, isDeniedMutation(error) ? "denied" : "failed");
        },
        "immediate",
      );
    },
    "Account command failed and its compensation outcome could not be recorded.",
  );
}

function executeMutation<Execute extends () => unknown>(
  dependencies: MutationDependencies,
  options: MutationOptions<Execute>,
  scope: ReturnType<typeof buildCommandScope>,
): ReturnType<Execute> {
  const transaction = (() => {
    const result = options.execute() as ReturnType<Execute>;
    completeCommand({
      db: dependencies.db,
      scope,
      command: options.command,
      result: options.persistResult ? options.persistResult(result) : result,
    });
    writeMutationAudit(dependencies, options, "success");
    return result;
  }) as SynchronousCallback<() => ReturnType<Execute>>;
  return tx(dependencies.db, transaction, "immediate");
}

async function runLockedMutation<Execute extends () => unknown>(
  dependencies: MutationDependencies,
  options: MutationOptions<Execute>,
): Promise<ReturnType<Execute>> {
  const scope = buildCommandScope(dependencies, options);
  const begun = beginCommand<unknown>({
    db: dependencies.db,
    scope,
    command: options.command,
    canonicalPayload: options.payload,
  });
  if (begun.kind === "replay") {
    options.replayGuard?.();
    const result = options.replayResult
      ? options.replayResult(begun.result, begun.record.commandId)
      : (begun.result as ReturnType<Execute>);
    return markAccountCommandReplay(result);
  }
  try {
    const result = executeMutation(dependencies, options, scope);
    options.afterCommit?.(result);
    return result;
  } catch (error) {
    options.afterRollback?.();
    recordFailedMutation({ dependencies, options, scope, error });
    throw error;
  }
}

function createRunMutation(dependencies: MutationDependencies): AdminPortContext["runMutation"] {
  return async function runMutation<Execute extends () => unknown>(options: MutationOptions<Execute>) {
    return dependencies.lock.withKeys(options.lockKeys, () => runLockedMutation(dependencies, options));
  };
}

export function createSqliteAccountAdminPort(input: CreateSqliteAccountAdminPortInput): SsoCutoverAccountAdminPort {
  const { applicationId, db, lock, trustedLocal = false, requireMfa = false } = input;
  const audit = createAccountAuditWriter(applicationId, input.audit);
  const invitationSecretReplay = new WriteOnceSecretReplay<CreatedInvitation>(
    input.writeOnceReplayCapacity ?? MAX_SECRET_REPLAYS,
  );
  const runMutation = createRunMutation({ applicationId, db, lock, audit });
  const context = { applicationId, db, trustedLocal, requireMfa, invitationSecretReplay, runMutation };
  return {
    ...createAuthority(context),
    ...createCutover(context),
    ...createMembership(context),
    ...createInvitations(context),
    ...createInvitationClaims(context),
  };
}

import type { CommandIdentity, PasswordResetCeremony } from "@capacitylens/shared/account/types";
import type { Db } from "../../db";
import type { AccountAuditInput } from "../accountFlowRuntime";
import type { createLocalAccountFlows } from "../createLocalAccountFlows";
import type { CommandScope } from "../commands";
import type { KeyedOperationLock } from "../KeyedOperationLock";
import type { WriteOnceSecretReplay } from "../WriteOnceSecretReplay";

export interface DenyIdentityAdminCommandInput {
  scope: Pick<CommandScope, "applicationId" | "operation">;
  command: CommandIdentity;
  reason: string;
  actorPrincipalId: string;
  targetPrincipalId: string;
  auditAction: AccountAuditInput["action"];
  deniedAction: "issue-password-reset" | "revoke-sessions";
}

type CoordinatorInput = Parameters<typeof createLocalAccountFlows>[0];

/**
 * Everything `createLocalAccountFlows` composes for its flow factories. Each factory declares the
 * `Pick` it consumes; only the composition root holds the whole context.
 */
export interface LocalAccountFlowContext {
  applicationId: string;
  db: Db;
  // The adapter port types stay behind the coordinator, which the architecture test permits to name them.
  identity: CoordinatorInput["identity"];
  administration: CoordinatorInput["administration"];
  lock: KeyedOperationLock;
  eraseProductWorkspaceInTx(workspaceId: string): void;
  audit(event: AccountAuditInput): void;
  persistTerminalOutcome(write: () => boolean | void, event: AccountAuditInput): boolean | void;
  denyIdentityAdminCommand(input: DenyIdentityAdminCommandInput): never;
  resetReplay: WriteOnceSecretReplay<PasswordResetCeremony>;
  buildCommandExecutionKey(command: CommandIdentity): string;
}

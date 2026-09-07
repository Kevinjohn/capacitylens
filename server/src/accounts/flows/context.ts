import type { CommandIdentity, PasswordResetCeremony } from "@capacitylens/shared/account/types";
import type { AccountAuditInput, createAccountAuditWriter } from "../accountFlowRuntime";
import type { CommandScope } from "../commands";
import type { createLocalAccountFlows } from "../createLocalAccountFlows";
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

export type LocalAccountFlowContext = Omit<Parameters<typeof createLocalAccountFlows>[0], "audit"> & {
  audit: ReturnType<typeof createAccountAuditWriter>;
  persistTerminalOutcome(write: () => boolean | void, event: AccountAuditInput): boolean | void;
  denyIdentityAdminCommand(input: DenyIdentityAdminCommandInput): never;
  resetReplay: WriteOnceSecretReplay<PasswordResetCeremony>;
  buildCommandExecutionKey(command: CommandIdentity): string;
};

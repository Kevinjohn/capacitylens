import type { CommandIdentity, PasswordResetCeremony } from "@capacitylens/shared/account/types";
import type { AccountAuditInput, accountAuditWriter } from "../accountFlowRuntime";
import type { terminateCommand } from "../commands";
import type { localAccountFlows } from "../localAccountFlows";
import type { WriteOnceSecretReplay } from "../writeOnceSecretReplay";

export type LocalAccountFlowContext = Omit<Parameters<typeof localAccountFlows>[0], "audit"> & {
  audit: ReturnType<typeof accountAuditWriter>;
  persistTerminalOutcome(write: () => boolean | void, event: AccountAuditInput): boolean | void;
  denyIdentityAdminCommand(
    scope: Pick<Parameters<typeof terminateCommand>[1], "applicationId" | "operation">,
    command: CommandIdentity,
    reason: string,
    actorPrincipalId: string,
    targetPrincipalId: string,
    auditAction: AccountAuditInput["action"],
    deniedAction: "issue-password-reset" | "revoke-sessions",
  ): never;
  resetReplay: WriteOnceSecretReplay<PasswordResetCeremony>;
  commandExecutionKey(command: CommandIdentity): string;
};

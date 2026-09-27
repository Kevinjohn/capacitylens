import { parseApprovedDomains } from "@capacitylens/shared/account/approvedDomains";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import { isJoiningPolicy } from "@capacitylens/shared/account/types";
import { readJoiningPolicy, writeJoiningPolicy } from "../../controlTables";
import { assertAccountAuthority, assertAdministrativeAssurance } from "./authority";
import type { AdminPortContext } from "./contracts";
import { createAccountFailure } from "./failures";

type JoiningPolicyContext = Pick<AdminPortContext, "db" | "trustedLocal" | "requireMfa" | "runMutation">;

export function createJoiningPolicyAdministration(
  context: JoiningPolicyContext,
): Pick<AccountAdminPort, "readJoiningPolicy" | "setJoiningPolicy"> {
  const { db, trustedLocal, requireMfa } = context;
  return {
    async readJoiningPolicy({ actor, workspaceId }) {
      assertAdministrativeAssurance({ actor, requireMfa, trustedLocal, requireFresh: false });
      assertAccountAuthority({ db, actor, workspaceId, action: "manage-invitations", trustedLocal });
      return readJoiningPolicy(db, workspaceId);
    },
    async setJoiningPolicy({ actor, workspaceId, settings, command }) {
      if (!isJoiningPolicy(settings.policy)) {
        throw createAccountFailure("VALIDATION_FAILED", "Choose a valid company joining policy.", command.commandId);
      }
      const domains = parseApprovedDomains(settings.approvedDomains);
      if (domains === null || (settings.policy.includes("approved_domains") && domains.length === 0)) {
        throw createAccountFailure("VALIDATION_FAILED", "Add at least one valid approved domain.", command.commandId);
      }
      const canonical = { policy: settings.policy, approvedDomains: domains };
      const assertOwner = () => {
        assertAdministrativeAssurance({ actor, requireMfa, trustedLocal, requireFresh: false, commandId: command.commandId });
        const role = assertAccountAuthority({ db, actor, workspaceId, action: "manage-invitations", trustedLocal });
        if (role !== "owner") throw createAccountFailure("FORBIDDEN", "Only the Owner can change joining policy.");
      };
      assertOwner();
      return context.runMutation({
        operation: "set-joining-policy",
        actorPrincipalId: actor.principalId,
        workspaceId,
        command,
        payload: canonical,
        lockKeys: [actor.principalId, `workspace:${workspaceId}`],
        replayGuard: assertOwner,
        audit: { action: "joining_policy.updated", changedFields: ["policy", "approvedDomains"] },
        execute: () => {
          assertOwner();
          return writeJoiningPolicy(db, workspaceId, canonical);
        },
      });
    },
  };
}

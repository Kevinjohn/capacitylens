import type { AdminPortContext, SsoCutoverAccountAdminPort } from "./contracts";
import { createCutoverInspection } from "./cutoverInspection";
import { createWorkspaceAdministration } from "./workspaceAdministration";

export {
  assertAccountControlPlaneCurrent,
  assertAccountControlPlaneSchemaCurrent,
  listSoleOwnerAccountIds,
} from "./cutoverInspection";

/** Composes cutover inspection with workspace administration capabilities. */
export function createCutover(
  context: Pick<AdminPortContext, "db" | "trustedLocal">,
): Pick<
  SsoCutoverAccountAdminPort,
  | "inspectSsoCutoverWorkspaces"
  | "repairOwnerlessWorkspaceInTx"
  | "roleForPrincipalInWorkspace"
  | "workspacePrincipalIds"
  | "evaluateWorkspaceProvisioningAuthorityInTx"
  | "provisionOwnerMembershipInTx"
  | "assertWorkspaceErasureAuthorityInTx"
  | "eraseWorkspaceAdministrationInTx"
> {
  return { ...createCutoverInspection(context.db), ...createWorkspaceAdministration(context) };
}

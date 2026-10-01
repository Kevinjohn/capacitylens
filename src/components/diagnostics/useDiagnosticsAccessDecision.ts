import { resolveCapacityOverviewAccessDecision } from "@/auth/capacityOverviewAccess";
import { usePermissionStatus, useRole } from "@/auth/permissionContext";

/**
 * Whether the Diagnostics page is open to the current member: Owners and Admins only, and every
 * session without a membership role (auth off, demo). It is the Overview decision at its fixed
 * strictest level, so the route, the sidebar and the command palette cannot disagree.
 */
export function useDiagnosticsAccessDecision() {
  const role = useRole();
  const status = usePermissionStatus();
  return resolveCapacityOverviewAccessDecision({ role, status, access: "owner_admin" });
}

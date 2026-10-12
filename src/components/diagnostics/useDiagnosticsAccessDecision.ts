import { resolveCapacityOverviewAccessDecision } from "@/auth/capacityOverviewAccess";
import { usePermissionStatus, useRole } from "@/auth/permissionContext";

/** Shares the Diagnostics access decision across its route and navigation: Owners/Admins, plus contexts without membership policy. */
export function useDiagnosticsAccessDecision() {
  const role = useRole();
  const status = usePermissionStatus();
  return resolveCapacityOverviewAccessDecision({ role, status, access: "owner_admin" });
}

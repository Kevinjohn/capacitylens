import { canViewCapacityOverview, type Role } from "@capacitylens/shared/domain/access";
import type { CapacityOverviewAccess } from "@capacitylens/shared/types/entities";

type PermissionStatus = "not-applicable" | "pending" | "resolved" | "unavailable";
export type CapacityOverviewAccessDecision = "allowed" | "pending" | "denied";

export function resolveCapacityOverviewAccessDecision({
  role,
  status,
  access,
}: {
  role: Role | null;
  status: PermissionStatus;
  access: CapacityOverviewAccess;
}): CapacityOverviewAccessDecision {
  if (status === "not-applicable" && role === null) return "allowed";
  if (status === "pending") return "pending";
  if (status !== "resolved" || role === null) return "denied";
  return canViewCapacityOverview(role, access) ? "allowed" : "denied";
}

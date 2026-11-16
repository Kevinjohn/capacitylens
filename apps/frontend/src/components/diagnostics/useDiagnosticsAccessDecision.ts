import { resolveCapacityOverviewAccessDecision } from '@/auth/capacityOverviewAccess';
import type { CapacityOverviewAccessDecision } from '@/auth/capacityOverviewAccess';
import { usePermissionStatus, useRole } from '@/auth/permissionContext';

/** Resolves Diagnostics access: Owners/Admins, plus contexts without membership policy. */
export function resolveDiagnosticsAccessDecision(
  input: Omit<Parameters<typeof resolveCapacityOverviewAccessDecision>[0], 'access'>,
): CapacityOverviewAccessDecision {
  return resolveCapacityOverviewAccessDecision({ ...input, access: 'owner_admin' });
}

/** Shares the Diagnostics access decision across its route and navigation. */
export function useDiagnosticsAccessDecision() {
  const role = useRole();
  const status = usePermissionStatus();
  return resolveDiagnosticsAccessDecision({ role, status });
}

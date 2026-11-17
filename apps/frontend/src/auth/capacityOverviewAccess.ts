import { canViewCapacityOverview } from '@capacitylens/shared/domain/access';
import type { Role } from '@capacitylens/shared/domain/access';
import type { CapacityOverviewAccess } from '@capacitylens/shared/types/entities';
import type { AccessPermissionStatus } from '@/lib/accessCopy';

/** Access outcome for the capacity overview route guard. */
export type CapacityOverviewAccessDecision = 'allowed' | 'pending' | 'denied';

/** Resolves route access from the caller role and permission-check status. */
export function resolveCapacityOverviewAccessDecision({
  role,
  status,
  access,
}: {
  role: Role | null;
  status: AccessPermissionStatus;
  access: CapacityOverviewAccess;
}): CapacityOverviewAccessDecision {
  if (status === 'not-applicable' && role === null) return 'denied';
  if (status === 'pending') return 'pending';
  if (status !== 'resolved' || role === null) return 'denied';
  return canViewCapacityOverview(role, access) ? 'allowed' : 'denied';
}

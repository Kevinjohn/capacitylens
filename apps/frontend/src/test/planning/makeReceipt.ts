import type { PlanningMutationSuccess } from '@/api/planningContracts';

/** A committed planning receipt as the server sends it, for tests that script a reply. */
export function makeReceipt(
  mutationId: string,
  revision: number,
  overrides: Partial<PlanningMutationSuccess> = {},
): PlanningMutationSuccess {
  return {
    status: 'committed',
    mutationId,
    revision,
    restoration: { consumedGroupId: null, replacementGroupId: null },
    ...overrides,
  };
}

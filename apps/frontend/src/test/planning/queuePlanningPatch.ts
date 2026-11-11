import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';

export type PlanningPatch = Extract<
  PlanningMutationSuccess['projection'],
  { mode: 'patch' }
>['changed'];

/** Queue the exact patch a test needs without teaching the transport how planning rules work. */
export function queuePlanningPatch(
  changed: (execution: PlanningExecution) => PlanningPatch,
  restoration: { consumedGroupId?: string | null; replacementGroupId?: string | null } = {},
): void {
  const consumedGroupId = restoration.consumedGroupId ?? null;
  const replacementGroupId = restoration.replacementGroupId ?? null;
  if (consumedGroupId !== null && replacementGroupId !== null) {
    throw new Error('A planning restoration receipt cannot consume and replace a group together.');
  }
  getStubPlanningTransport().respondNext((execution) => ({
    status: 'committed',
    mutationId: execution.mutationId,
    revision: execution.baseRevision + 1,
    restoration:
      consumedGroupId !== null
        ? { consumedGroupId, replacementGroupId: null }
        : replacementGroupId !== null
          ? { consumedGroupId: null, replacementGroupId }
          : { consumedGroupId: null, replacementGroupId: null },
    projection: {
      mode: 'patch',
      history: 'retain',
      changed: changed(execution),
    },
  }));
}

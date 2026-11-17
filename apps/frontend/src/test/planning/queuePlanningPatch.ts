import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';
import type { PlanningPatch, StubPlanningTransport } from './stubPlanningTransport';

/** Queue a receipt and the rows it changes, without teaching the transport planning rules. */
export function queuePlanningPatch(
  changed: (execution: PlanningExecution) => PlanningPatch,
  receipt: {
    consumedGroupId?: string | null;
    replacementGroupId?: string | null;
  } & Pick<PlanningMutationSuccess, 'advisory' | 'repeatAdvisory'> = {},
  transport: StubPlanningTransport = getStubPlanningTransport(),
): void {
  const { consumedGroupId = null, replacementGroupId = null, ...advisory } = receipt;
  if (consumedGroupId !== null && replacementGroupId !== null) {
    throw new Error('A planning restoration receipt cannot consume and replace a group together.');
  }
  transport.respondNext(
    (execution) => ({
      status: 'committed',
      mutationId: execution.mutationId,
      revision: execution.baseRevision + 1,
      restoration:
        consumedGroupId !== null
          ? { consumedGroupId, replacementGroupId: null }
          : replacementGroupId !== null
            ? { consumedGroupId: null, replacementGroupId }
            : { consumedGroupId: null, replacementGroupId: null },
      ...advisory,
    }),
    undefined,
    changed,
  );
}

import { buildRepeatedTimeOffDrafts } from '@capacitylens/shared/lib/repeatingOccurrences'
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields'
import { createId } from '@capacitylens/shared/lib/id'
import type { Allocation, ID, TimeOff } from '@capacitylens/shared/types/entities'
import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts'
import { DEFAULT_COMPANY_ID } from '@/test/fixtures'
import { queuePlanningPatch } from './queuePlanningPatch'

/** Queue the server-returned occurrence dates for a frontend batch command test. */
export function queueAllocationGroupResponse(
  dates: readonly (readonly [startDate: string, endDate: string])[],
  seriesId: ID | null = null,
  repeatAdvisory?: PlanningMutationSuccess['repeatAdvisory']
): void {
  queuePlanningPatch(
    (execution) => {
      const intent = execution.intent
      if (intent.operation !== 'allocation.createGroup') {
        throw new Error(`Expected allocation.createGroup, received ${intent.operation}.`)
      }
      const { allocation } = intent
      // Like the server, the stub mints the later occurrences' ids.
      const ids = [allocation.id, ...dates.slice(1).map(() => createId())]
      const createdAt = new Date().toISOString()
      return {
        removed: [],
        upserts: dates.map(([startDate, endDate], index) => ({
          entity: 'allocations',
          row: {
            ...NULLABLE_FIELDS.allocations,
            ...allocation,
            id: ids[index],
            startDate,
            endDate,
            companyId: DEFAULT_COMPANY_ID,
            createdAt,
            updatedAt: createdAt,
            seriesId,
          } as Allocation,
        })),
      }
    },
    repeatAdvisory ? { repeatAdvisory } : {}
  )
}

/** Queue a deletion receipt for a test-owned set of rows. */
export function queueAllocationDeleteGroupResponse(
  ids: readonly ID[],
  restorationGroupId: ID
): void {
  queuePlanningPatch(
    () => ({
      upserts: [],
      removed: ids.map((id) => ({ entity: 'allocations', id })),
    }),
    { replacementGroupId: restorationGroupId }
  )
}

/** Queue the repeat as the canonical set of independent time-off rows the server would write. */
export function queueTimeOffRepeatResponse(): void {
  queuePlanningPatch((execution: PlanningExecution) => {
    const intent = execution.intent
    if (intent.operation !== 'timeOff.repeat') {
      throw new Error(`Expected timeOff.repeat, received ${intent.operation}.`)
    }
    const { timeOff, repeat, occurrenceIds } = intent
    const { drafts } = buildRepeatedTimeOffDrafts(timeOff, repeat.until, repeat.pattern)
    const ids = [timeOff.id, ...occurrenceIds]
    if (drafts.length !== ids.length) {
      throw new Error('The occurrence identities do not match the repeat.')
    }
    const createdAt = new Date().toISOString()
    return {
      removed: [],
      upserts: drafts.map((entry, index) => ({
        entity: 'timeOff',
        row: {
          ...NULLABLE_FIELDS.timeOff,
          ...entry,
          id: String(ids[index]),
          companyId: DEFAULT_COMPANY_ID,
          createdAt,
          updatedAt: createdAt,
        } as TimeOff,
      })),
    }
  })
}

import db from '@adonisjs/lucid/services/db'
import type { AppDataKey } from '@capacitylens/shared/types/entities'
import PlanningOperationException from '#exceptions/planning_operation_exception'
import { RowValidationService } from '#services/planning/row_validation_service'
import type { WrittenRow } from '#services/planning/writer'
import { planningMutationValidator } from '#validators/planning'
import type { PlanningIntent, PlanningMutationInput } from '#validators/planning/contracts'
import { executePlanningIntent, owner } from '#tests/helpers/data/planning_execution'
import type { readState } from '#tests/helpers/state_fixture'

const rowValidation = new RowValidationService()

/** A catalogue update intent naming `changes` on one row. */
export const catalogueUpdate = (entity: string, changes: Record<string, unknown>) =>
  ({
    operation: 'catalogue.update',
    entity: { entity, id: 'row-1', changes },
  }) as unknown as PlanningMutationInput['intent']

/** One written row of `entity` with the given before and after fields. */
export const writtenRows = (
  entity: AppDataKey,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): WrittenRow[] =>
  [
    {
      entity,
      id: 'row-1',
      before: before && { id: 'row-1', ...before },
      after: after && { id: 'row-1', ...after },
    },
  ] as unknown as WrittenRow[]

/** Validates a mutation body beside the route's company, as the action does. */
export function validateMutation(body: object) {
  return planningMutationValidator.validate({ ...body, params: { companyId: 'a-studio' } })
}

/** The operation a validated mutation names. */
export async function operationOf<T extends { intent: { operation: string } }>(
  validation: Promise<T>
) {
  const result = await validation
  return result.intent.operation
}

/** Runs one planning intent as the `a-studio` Owner in its own transaction. */
export async function executeInStudio(intent: PlanningIntent) {
  await db.transaction((trx) => executePlanningIntent(trx, 'a-studio', intent, owner))
}

/** The refusal of a planning intent the `a-studio` Owner may not run; fails when it runs. */
export async function refusedInStudio(intent: PlanningIntent) {
  try {
    await executeInStudio(intent)
  } catch (error) {
    if (error instanceof PlanningOperationException) return error
    throw error
  }
  throw new Error('Expected the planning intent to be refused.')
}

/** A new allocation copying `source`, with its own id and a one-day span. */
export const makeAllocation = (
  source: Awaited<ReturnType<typeof readState>>['allocations'][number],
  id: string,
  startDate: string
) => ({
  id,
  resourceId: source.resourceId,
  activityId: source.activityId,
  projectId: source.projectId,
  startDate,
  endDate: startDate,
  hoursPerDay: source.hoursPerDay,
  status: source.status,
  note: source.note,
  task: source.task,
  ignoreWorkingDays: source.ignoreWorkingDays,
})

/** `accepted`, or the first refusal's rule and sentence, for one merged row. */
export async function rowOutcome(table: AppDataKey, row: Record<string, unknown>) {
  try {
    await rowValidation.validateRow(table, row)
    return 'accepted'
  } catch (error) {
    const first = (error as { messages: Array<{ message: string; rule: string }> }).messages[0]!
    return `${first.rule}: ${first.message}`
  }
}

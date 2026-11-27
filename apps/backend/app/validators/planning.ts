import vine from '@vinejs/vine'
import { countDaysInclusive } from '@capacitylens/shared/lib/dateMath'
import { isValidISODate } from '@capacitylens/shared/lib/isoDates'
import type { AppDataKey } from '@capacitylens/shared/types/entities'
import { ENTITY_FIELDS, type FieldSpec } from '@capacitylens/shared/types/entityFields'
import { findFieldProblem, type RowRuleContext } from '@capacitylens/shared/types/entityFieldRules'
import { allocationIntent } from '#validators/planning/allocation'
import { catalogueIntent } from '#validators/planning/catalogue'
import { closureIntent } from '#validators/planning/closure'
import {
  calendarDate,
  meta,
  hasOperation,
  hasOperationPrefix,
  revision,
  uuid,
} from '#validators/planning/fields'
import { resourceIntent } from '#validators/planning/resource'
import { settingsIntent } from '#validators/planning/settings'
import { timeOffIntent } from '#validators/planning/time_off'
import { companyIdParam } from '#validators/request_rules'

/** The longest capacity range one planning read computes. */
const MAX_PLANNING_READ_DAYS = 366

const readRange = vine.createRule((value, _options, field) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  const { from, to } = value as { from?: unknown; to?: unknown }
  if ((from === undefined) !== (to === undefined)) {
    field.report('Send both from and to, or neither.', 'readRange', field)
    return
  }
  if (!isValidISODate(from) || !isValidISODate(to)) return
  if (from > to) {
    field.report('The to date must be on or after the from date.', 'readRange', field)
  } else if (countDaysInclusive(from, to) > MAX_PLANNING_READ_DAYS) {
    field.report(`The range may cover at most ${MAX_PLANNING_READ_DAYS} days.`, 'readRange', field)
  }
})

const rowField = vine.createRule<{ field: string; spec: FieldSpec; context: RowRuleContext }>(
  (value, { field, spec, context }, ctx) => {
    const problem = findFieldProblem(field, spec, value, context)
    if (problem) ctx.report(problem.message, problem.rule, ctx)
  },
  { name: 'entityField', implicit: true }
)

const planningIntent = vine.union([
  vine.union.if(
    (value) => hasOperation(value, 'planning.restoreGroup'),
    vine.object({ operation: vine.literal('planning.restoreGroup'), restorationGroupId: uuid() })
  ),
  vine.union.if((value) => hasOperationPrefix(value, 'allocation.'), allocationIntent),
  vine.union.if((value) => hasOperationPrefix(value, 'catalogue.'), catalogueIntent),
  vine.union.if((value) => hasOperationPrefix(value, 'resource.'), resourceIntent),
  vine.union.if((value) => hasOperationPrefix(value, 'timeOff.'), timeOffIntent),
  vine.union.if((value) => hasOperationPrefix(value, 'closure.'), closureIntent),
  vine.union.else(settingsIntent),
])

/** The planning read's query: the capacity window, both dates or neither, the reading page's
 * history, and the revision the reader already holds. The query carries strings, so `ifRevision` is
 * converted rather than strict. Other fields are ignored. */
export const planningReadValidator = vine.create(
  vine
    .object({
      from: calendarDate().optional(),
      to: calendarDate().optional(),
      historyId: uuid().optional(),
      ifRevision: vine.number().min(0).withoutDecimals().optional(),
      params: vine.object({ companyId: companyIdParam() }),
    })
    .use(readRange())
)

/** The planning archive recovery read names only its company, in the route. */
export const planningArchiveValidator = vine.create(
  vine.object({ params: vine.object({ companyId: companyIdParam() }) })
)

/**
 * Validate a planning intent. Company scope and authorization come from the authenticated server
 * context; IDs and supplied fields never confer permission. Allocation updates represent move,
 * resize and reassignment in one patch. Vine strips unknown/server-owned fields. This is input
 * validation only; the write transaction owns authorization and integrity.
 */
export const planningMutationValidator = vine.create(
  vine.object({
    ...meta(),
    intent: planningIntent,
    params: vine.object({ companyId: companyIdParam() }),
  })
)

/** One undo or redo: the server holds the intent, so the body names only the page's history. */
export const planningHistoryStepValidator = vine.create(
  vine.object({
    mutationId: uuid(),
    baseRevision: revision(),
    historyId: uuid(),
    params: vine.object({ companyId: companyIdParam() }),
  })
)

/**
 * Compiles the validator for one complete stored row of `table` under `context`. It checks each
 * field the table lists without coercing supplied scalar values and drops fields the table does
 * not list. The fields come from the shared `ENTITY_FIELDS` table, so this stays a builder rather
 * than one hand-written `vine.create` per table.
 */
export function buildRowValidator(table: AppDataKey, context: RowRuleContext) {
  const specs: Record<string, FieldSpec> = ENTITY_FIELDS[table]
  const properties = Object.fromEntries(
    Object.entries(specs).map(([field, spec]) => [
      field,
      vine.any().optional().use(rowField({ field, spec, context })),
    ])
  )
  return vine.create(vine.object(properties))
}

import { countDaysInclusive } from '@capacitylens/shared/lib/dateMath'
import { validateAllocationAssignment } from '@capacitylens/shared/lib/integrity'
import { isValidISODate } from '@capacitylens/shared/lib/isoDates'
import { generateRepeatingStartDates } from '@capacitylens/shared/lib/repeatingDates'
import { buildRepeatedAllocationDrafts } from '@capacitylens/shared/lib/repeatingOccurrences'
import { MAX_SPAN_DAYS } from '@capacitylens/shared/lib/schedulingDays'
import { MAX_HOURS_PER_DAY } from '@capacitylens/shared/types/entities'
import { resolveRepeatPattern } from '@/lib/repeatingAllocations'

import type { AllocationDialogSnapshot } from './AllocationDialogSnapshot'

type ExpansionInput = Pick<
  AllocationDialogSnapshot,
  | 'activityId'
  | 'create'
  | 'attributedProjectId'
  | 'daysOfWork'
  | 'daysOver'
  | 'effEndDate'
  | 'effHoursPerDay'
  | 'ignoreWorkingDays'
  | 'isBlocks'
  | 'isDays'
  | 'isExternal'
  | 'mode'
  | 'note'
  | 'task'
  | 'repeat'
  | 'repeatUntil'
  | 'repeatUntilMaximum'
  | 'repeatUntilMinimum'
  | 'resourceId'
  | 'selectedActivity'
  | 'selectedEffectiveProjectId'
  | 'selectedResource'
  | 'selectedEffectiveWeek'
  | 'spanFitsDateDomain'
  | 'startDate'
  | 'status'
  | 'validDaysOver'
>

function resolveExpansionSettings(input: ExpansionInput) {
  const { activityId, create, repeat, resourceId, selectedEffectiveWeek, selectedResource } = input
  if (!create || repeat === 'none' || !selectedResource || selectedEffectiveWeek === undefined) {
    return null
  }
  if (!resourceId || !activityId) return null
  return { activityId, repeat, resourceId, selectedEffectiveWeek, selectedResource }
}

function hasValidExpansionDates(input: ExpansionInput) {
  const {
    effEndDate: endDate,
    repeatUntil,
    repeatUntilMaximum,
    repeatUntilMinimum,
    spanFitsDateDomain,
    startDate,
    validDaysOver,
    isBlocks,
    isDays,
  } = input
  if (!isValidISODate(startDate) || !isValidISODate(endDate) || endDate < startDate) return false
  if (!isValidISODate(repeatUntil) || repeatUntil < repeatUntilMinimum) return false
  if (!repeatUntilMaximum || repeatUntil > repeatUntilMaximum) return false
  if (countDaysInclusive(startDate, endDate) > MAX_SPAN_DAYS) return false
  return !(isDays || isBlocks) || (validDaysOver && spanFitsDateDomain)
}

function hasValidExpansionLoad(input: ExpansionInput) {
  const { daysOfWork, effHoursPerDay: hoursPerDay, isBlocks, isDays, isExternal } = input
  if (isDays && !(daysOfWork > 0)) return false
  if (isExternal || isBlocks) return true
  return Number.isFinite(hoursPerDay) && hoursPerDay > 0 && hoursPerDay <= MAX_HOURS_PER_DAY
}

function buildExpansion(
  input: ExpansionInput,
  context: NonNullable<ReturnType<typeof resolveExpansionSettings>>
) {
  const {
    attributedProjectId,
    daysOver,
    effEndDate: endDate,
    effHoursPerDay: hoursPerDay,
    ignoreWorkingDays,
    isExternal,
    mode,
    note,
    task,
    repeatUntil,
    startDate,
    status,
  } = input
  const { activityId, repeat, resourceId, selectedEffectiveWeek, selectedResource } = context
  try {
    const { startDates } = generateRepeatingStartDates(
      startDate,
      repeatUntil,
      resolveRepeatPattern(repeat)
    )
    const drafts = buildRepeatedAllocationDrafts(
      {
        resourceId,
        activityId,
        startDate,
        endDate,
        hoursPerDay,
        status,
        ...(note ? { note } : {}),
        ...(task ? { task } : {}),
        ignoreWorkingDays: isExternal ? true : ignoreWorkingDays,
        ...(attributedProjectId ? { projectId: attributedProjectId } : {}),
      },
      startDates,
      {
        schedulingMode: mode,
        daysOver,
        resource: selectedResource,
        effectiveWeek: selectedEffectiveWeek,
      }
    )
    return { drafts, startDates }
  } catch (error) {
    // A near-boundary date can be valid input while an expanded occurrence cannot fit. The server
    // refuses that repeat on save; invariant/programming errors remain loud instead of disappearing.
    if (error instanceof RangeError) return null
    throw error
  }
}

/** Projects a repeated allocation for preview without persisting drafts. */
export function buildRepeatExpansion(input: ExpansionInput) {
  const { selectedActivity, selectedEffectiveProjectId } = input
  const context = resolveExpansionSettings(input)
  if (!context || !hasValidExpansionDates(input) || !hasValidExpansionLoad(input)) return null
  if (
    !selectedActivity ||
    !validateAllocationAssignment(context.selectedResource, selectedEffectiveProjectId).ok
  ) {
    return null
  }
  return buildExpansion(input, context)
}

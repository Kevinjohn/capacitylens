import { addDaysISO, countDaysInclusive } from './dateMath.js';
import { hasNoEffectiveWorkingDays } from './effectiveWorkingWeek.js';
import type { EffectiveWorkingWeek } from './effectiveWorkingWeek.js';
import { isValidISODate } from './isoDates.js';
import {
  generateRepeatingStartDates,
  RepeatingDateError,
  TIME_OFF_REPEAT_POLICY,
} from './repeatingDates.js';
import type { RepeatPattern } from './repeatingDates.js';
import { endDateForSpan, calculateMaxSpanDays, MAX_SPAN_DAYS } from './schedulingDays.js';
import { isExternalResource } from '../types/entities.js';
import type { ISODate, Resource, SchedulingMode } from '../types/entities.js';

// The dated occurrences a repeat produces from its first occurrence, shared by the form preview and
// the save.

/** The allocation fields a repeat projection reads; every other field is copied unchanged. */
interface RepeatableAllocation {
  resourceId: string;
  startDate: ISODate;
  endDate: ISODate;
  ignoreWorkingDays?: boolean | null;
}

/** Scheduling inputs that a persisted allocation draft does not carry. */
export interface RepeatProjectionContext {
  schedulingMode: SchedulingMode;
  daysOver: number;
  resource: Pick<Resource, 'id' | 'kind'>;
  effectiveWeek: EffectiveWorkingWeek;
}

/**
 * Project a validated allocation draft onto generated repeat starts.
 * The first result is the exact `baseDraft` object; later results change only the date range.
 *
 * @throws Error when the resolved resource does not match the draft.
 * @throws RangeError when a working-span mode receives an invalid `daysOver` value, has no effective
 * working days, or a projected range leaves the supported ISO-date domain. Record-creation callers
 * reject an empty effective week before projection so copy is routed to the assignee/form surface.
 */
export function buildRepeatedAllocationDrafts<T extends RepeatableAllocation>(
  baseDraft: T,
  startDates: readonly ISODate[],
  context: RepeatProjectionContext,
): T[] {
  assertRepeatProjection(baseDraft, startDates, context);
  const calendarSpan = countDaysInclusive(baseDraft.startDate, baseDraft.endDate);
  const usesCalendarSpan =
    isExternalResource(context.resource) || context.schedulingMode === 'hourly';
  const spanOptions = {
    ...(context.effectiveWeek.kind === 'days' ? { workingDays: context.effectiveWeek.days } : {}),
    ...(baseDraft.ignoreWorkingDays !== undefined
      ? { ignoreWorkingDays: baseDraft.ignoreWorkingDays }
      : {}),
  };
  assertProjectedSpans({ startDates, daysOver: context.daysOver, spanOptions, usesCalendarSpan });

  return startDates.map((generatedStart, index) => {
    if (index === 0) return baseDraft;
    const projectedEnd = usesCalendarSpan
      ? addDaysISO(generatedStart, calendarSpan - 1)
      : endDateForSpan(generatedStart, context.daysOver, spanOptions);
    return { ...baseDraft, startDate: generatedStart, endDate: projectedEnd };
  });
}

function assertRepeatProjection(
  baseDraft: RepeatableAllocation,
  startDates: readonly ISODate[],
  context: RepeatProjectionContext,
): void {
  if (context.resource.id !== baseDraft.resourceId) {
    throw new Error('The repeat projection resource does not match the allocation resource.');
  }
  if (startDates.length === 0 || startDates[0] !== baseDraft.startDate) {
    throw new Error('Repeat projection must begin with the validated allocation draft.');
  }
  const usesCalendarSpan =
    isExternalResource(context.resource) || context.schedulingMode === 'hourly';
  if (!usesCalendarSpan && !isValidWorkingSpan(context.daysOver)) {
    throw new RangeError(
      `Repeat projection daysOver must be a whole number from 1 to ${MAX_SPAN_DAYS}.`,
    );
  }

  const calendarSpan = countDaysInclusive(baseDraft.startDate, baseDraft.endDate);
  if (calendarSpan < 1) {
    throw new RangeError('Repeat projection requires a valid inclusive date range.');
  }
  if (
    !usesCalendarSpan &&
    hasNoEffectiveWorkingDays(context.effectiveWeek, baseDraft.ignoreWorkingDays ?? undefined)
  ) {
    throw new RangeError('Repeat projection requires at least one effective working day.');
  }
}

function isValidWorkingSpan(daysOver: number): boolean {
  return Number.isSafeInteger(daysOver) && daysOver >= 1 && daysOver <= MAX_SPAN_DAYS;
}

interface ValidateProjectedSpansInput {
  startDates: readonly ISODate[];
  daysOver: number;
  spanOptions: Parameters<typeof calculateMaxSpanDays>[1];
  usesCalendarSpan: boolean;
}

function assertProjectedSpans({
  startDates,
  daysOver,
  spanOptions,
  usesCalendarSpan,
}: ValidateProjectedSpansInput): void {
  if (usesCalendarSpan) return;
  for (const generatedStart of startDates) {
    if (daysOver > calculateMaxSpanDays(generatedStart, spanOptions)) {
      throw new RangeError('A repeated working span extends beyond the supported date range.');
    }
  }
}

/** Generate the exact independent drafts shared by the form preview and its one atomic save. */
export function buildRepeatedTimeOffDrafts<T extends { startDate: ISODate; endDate: ISODate }>(
  baseDraft: T,
  repeatUntil: ISODate,
  pattern: RepeatPattern,
): { repeatUntil: ISODate; drafts: T[] } {
  if (!isValidISODate(baseDraft.startDate) || !isValidISODate(baseDraft.endDate)) {
    throw new RepeatingDateError('invalid-date', 'Time off requires valid ISO dates.');
  }
  const duration = countDaysInclusive(baseDraft.startDate, baseDraft.endDate);
  if (!Number.isSafeInteger(duration) || duration < 1) {
    throw new RepeatingDateError(
      'invalid-date',
      'Repeat projection requires a valid inclusive date range.',
    );
  }
  const generated = generateRepeatingStartDates(
    baseDraft.startDate,
    repeatUntil,
    pattern,
    TIME_OFF_REPEAT_POLICY,
  );
  const drafts = generated.startDates.map((startDate, index) => {
    if (index === 0) return baseDraft;
    try {
      return { ...baseDraft, startDate, endDate: addDaysISO(startDate, duration - 1) };
    } catch (error) {
      // Translate date overflow into a field-domain failure while allowing unrelated programming errors to propagate.
      if (error instanceof RangeError) {
        throw new RepeatingDateError(
          'invalid-date',
          'Repeated time off extends beyond the supported ISO date range.',
        );
      }
      throw error;
    }
  });
  return { repeatUntil: generated.repeatUntil, drafts };
}

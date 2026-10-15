import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { generateRepeatingStartDates, RepeatingDateError } from "@capacitylens/shared/lib/repeatingDates";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import { MAX_HOURS_PER_DAY } from "@capacitylens/shared/types/entities";
import type { Allocation, ISODate } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { formatShortDate } from "@/lib/dateDisplay";
import { resolveRepeatPattern } from "@/lib/repeatingAllocations";
import type { RepeatSelection } from "@/lib/repeatingAllocations";

// The pure draft boundary returns the first field problem or derived end date, leaving the modal to display the result and commit through the store.

/** The first rule a draft breaks: the field to focus (null = form-level) and what to say. */
export interface AllocationDraftProblem {
  field: string | null;
  message: string;
}

/** Values required to validate an allocation draft. */
export interface AllocationDraftValidationInput {
  resourceId: string;
  activityId: string;
  startDate: ISODate;
  endDate: ISODate;
  /** The modes that collect a literal Start/End pair rather than deriving the end from a span. */
  usesTypedDateRange: boolean;
  typedDateSpanTooLong: boolean;
  isBlocks: boolean;
  isDays: boolean;
  isExternal: boolean;
  validDaysOver: boolean;
  spanFitsDateDomain: boolean;
  spanLimitedByDateDomain: boolean;
  maximumDaysOver: number;
  daysOfWork: number;
  hoursPerDay: number;
  /** The load that would actually be persisted, after the mode's own derivation. */
  effHoursPerDay: number;
  /** Repeats are a create-time option only; `null` for an edit or a one-off. */
  repeat: {
    selection: Exclude<RepeatSelection, "none">;
    until: string;
    today: ISODate;
    maximum: ISODate | undefined;
  } | null;
}

type CountFieldInput = Pick<
  AllocationDraftValidationInput,
  "startDate" | "validDaysOver" | "spanFitsDateDomain" | "spanLimitedByDateDomain" | "maximumDaysOver"
>;
type Fail = (field: AllocationDraftProblem["field"], message: AllocationDraftProblem["message"]) => void;

// Distinguish the date-domain boundary from the product span cap so near-year-9999 input receives truthful guidance.
function validateCountField(
  { startDate, validDaysOver, spanFitsDateDomain, spanLimitedByDateDomain, maximumDaysOver }: CountFieldInput,
  fail: Fail,
): boolean {
  if (!startDate) {
    fail("dates", m.form_allocation_err_start_required());
    return false;
  }
  if (!validDaysOver) {
    fail("daysOver", m.form_allocation_err_days_over_range({ max: MAX_SPAN_DAYS }));
    return false;
  }
  if (!spanFitsDateDomain) {
    fail(
      "daysOver",
      spanLimitedByDateDomain
        ? m.form_allocation_err_days_over_date_domain()
        : m.form_allocation_err_days_over_range({ max: maximumDaysOver }),
    );
    return false;
  }
  return true;
}

function validateSelections(input: AllocationDraftValidationInput, fail: Fail): boolean {
  if (!input.resourceId) {
    fail("resource", m.form_allocation_err_choose_resource());
    return false;
  }
  if (!input.activityId) {
    fail("activity", m.form_allocation_err_choose_activity());
    return false;
  }
  return true;
}

function validateTypedDateRange(input: AllocationDraftValidationInput, fail: Fail): boolean {
  if (!input.usesTypedDateRange) return true;
  if (!input.startDate || !input.endDate) {
    fail("dates", m.form_allocation_err_dates_required());
    return false;
  }
  if (input.endDate < input.startDate) {
    fail("dates", m.form_allocation_err_end_before_start());
    return false;
  }
  if (input.typedDateSpanTooLong) {
    fail("dates", m.form_allocation_err_date_span_range({ max: MAX_SPAN_DAYS.toLocaleString("en-GB") }));
    return false;
  }
  return true;
}

function validateModeFields(input: AllocationDraftValidationInput, fail: Fail): boolean {
  if (input.isBlocks || input.isDays) {
    if (!validateCountField(input, fail)) return false;
    if (input.isDays && !(input.daysOfWork > 0)) {
      fail("daysOfWork", m.form_allocation_err_days_of_work_gt_zero());
      return false;
    }
    return true;
  }
  if (!input.isExternal && !(input.hoursPerDay > 0)) {
    fail("hours", m.form_allocation_err_hours_gt_zero());
    return false;
  }
  return true;
}

function validateRepeat(input: AllocationDraftValidationInput, fail: Fail): boolean {
  const { repeat, startDate } = input;
  if (!repeat) return true;
  if (!repeat.until || !isValidISODate(repeat.until)) {
    fail("repeatUntil", m.form_allocation_err_repeat_until_required());
    return false;
  }
  if (repeat.until < repeat.today) {
    fail("repeatUntil", m.form_allocation_err_repeat_until_past());
    return false;
  }
  if (repeat.until < startDate) {
    fail("repeatUntil", m.form_allocation_err_repeat_until_before_start());
    return false;
  }
  if (!repeat.maximum) {
    fail("repeatUntil", m.form_allocation_err_repeat_date_domain());
    return false;
  }
  if (repeat.until > repeat.maximum) {
    fail("repeatUntil", m.form_allocation_err_repeat_until_after_max({ max: formatShortDate(repeat.maximum) }));
    return false;
  }
  try {
    generateRepeatingStartDates(startDate, repeat.until, resolveRepeatPattern(repeat.selection));
    return true;
  } catch (error) {
    // Repeat date errors belong to the repeat field; other failures reach the form-wide error.
    if (error instanceof RepeatingDateError) {
      const message =
        error.code === "no-repeat"
          ? m.form_allocation_err_repeat_until_no_occurrence()
          : m.form_allocation_err_repeat_date_domain();
      fail("repeatUntil", message);
      return false;
    }
    fail(null, error instanceof Error ? resolveErrorMessage(error) : m.form_allocation_err_save_failed());
    return false;
  }
}

function validateEffectiveHours(input: AllocationDraftValidationInput, fail: Fail): boolean {
  const { effHoursPerDay: hoursPerDay, isBlocks, isDays, isExternal } = input;
  if (isExternal || isBlocks) return true;
  if (Number.isFinite(hoursPerDay) && hoursPerDay > 0 && hoursPerDay <= MAX_HOURS_PER_DAY) return true;
  if (isDays) {
    fail("daysOfWork", m.form_allocation_err_days_over_max({ max: MAX_HOURS_PER_DAY }));
  } else {
    fail("hours", m.form_allocation_err_hours_over_max({ max: MAX_HOURS_PER_DAY }));
  }
  return false;
}

/** Every rule the visible allocation draft must satisfy before it may be written, in the order the
 * user should hear about them. Reports the first problem and returns whether the draft is persistable.
 * Save and Duplicate both run this so Duplicate cannot persist a shape Save would reject. */
export function validateAllocationDraft(input: AllocationDraftValidationInput, fail: Fail): boolean {
  if (!validateSelections(input, fail)) return false;
  // External and hourly allocations both use the raw Start/End inputs. Validate this once so
  // neither mode can persist a range the advisory deliberately refuses to enumerate.
  if (!validateTypedDateRange(input, fail)) return false;

  if (!validateModeFields(input, fail)) return false;
  if (!validateRepeat(input, fail)) return false;
  // Reject non-finite or over-limit derived load before persistence clamps it, so saving cannot silently reduce the entered work volume.
  return validateEffectiveHours(input, fail);
}

/** Values required to validate an allocation end date. */
export interface EndDateInput {
  /** The allocation being edited, or `undefined` when creating. */
  editing: Allocation | undefined;
  isBlocks: boolean;
  isDays: boolean;
  resourceId: string;
  startDate: ISODate;
  ignoreWeekends: boolean;
  daysOver: number;
  /** The span the form seeded from the stored allocation when it opened. */
  initialDaysOver: number;
  /** The end the current form state derives (`buildEffectiveAllocationValues`). */
  effectiveEndDate: ISODate;
}

/** The end date to persist. A span-mode edit that changed nothing the span depends on keeps the
 * stored end verbatim: re-deriving it would silently renormalise a historical row (one saved under
 * a different working week, or before a span rule changed) on an unrelated edit such as a note. */
export function resolveEndDate({
  editing,
  isBlocks,
  isDays,
  resourceId,
  startDate,
  ignoreWeekends,
  daysOver,
  initialDaysOver,
  effectiveEndDate,
}: EndDateInput): ISODate {
  const preserveStoredEnd =
    editing !== undefined &&
    (isDays || isBlocks) &&
    resourceId === editing.resourceId &&
    startDate === editing.startDate &&
    ignoreWeekends === (editing.ignoreWeekends ?? false) &&
    daysOver === initialDaysOver;
  return preserveStoredEnd ? editing.endDate : effectiveEndDate;
}

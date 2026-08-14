import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { generateRepeatingStartDates, RepeatingDateError } from "@capacitylens/shared/lib/repeatingDates";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import { MAX_HOURS_PER_DAY } from "@capacitylens/shared/types/entities";
import type { Allocation, ISODate } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { errorMessage } from "../../lib/errorMessage";
import { formatShortDate } from "../../lib/dateDisplay";
import { repeatPatternForSelection, type RepeatSelection } from "../../lib/repeatingAllocations";

// The allocation form's decision layer, lifted out of AllocationModal so the rules can be read (and
// tested) without a render. Nothing here touches React or the store: the modal supplies the already-
// derived view of its own state, and gets back either the FIRST problem to report or the end date to
// persist. Message wording still lives here because a rule and the sentence that explains it are the
// same decision — the modal only routes the result into `fail`.

/** The first rule a draft breaks: the field to focus (null = form-level) and what to say. */
export interface AllocationDraftProblem {
  field: string | null;
  message: string;
}

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

/** The Start + "Days over" pair the two span modes share. The date-domain message is distinct from
 *  the plain range one: near year 9999 the cap is the calendar itself, not MAX_SPAN_DAYS, and
 *  telling the user "max 36,500" there would be a lie. */
function validateCountField({
  startDate,
  validDaysOver,
  spanFitsDateDomain,
  spanLimitedByDateDomain,
  maximumDaysOver,
}: AllocationDraftValidationInput): AllocationDraftProblem | null {
  if (!startDate) return { field: "dates", message: m.form_allocation_err_start_required() };
  if (!validDaysOver) {
    return { field: "daysOver", message: m.form_allocation_err_days_over_range({ max: MAX_SPAN_DAYS }) };
  }
  if (!spanFitsDateDomain) {
    return {
      field: "daysOver",
      message: spanLimitedByDateDomain
        ? m.form_allocation_err_days_over_date_domain()
        : m.form_allocation_err_days_over_range({ max: maximumDaysOver }),
    };
  }
  return null;
}

/** Every rule the visible allocation draft must satisfy before it may be written, in the order the
 *  user should hear about them. Returns the FIRST problem, or `null` when the draft is persistable.
 *  Save and Duplicate both run this so Duplicate cannot persist a shape Save would reject. */
export function validateAllocationDraft(input: AllocationDraftValidationInput): AllocationDraftProblem | null {
  const { startDate, endDate, isBlocks, isDays, isExternal, effHoursPerDay } = input;
  if (!input.resourceId) return { field: "resource", message: m.form_allocation_err_choose_resource() };
  if (!input.activityId) return { field: "activity", message: m.form_allocation_err_choose_activity() };
  if (input.usesTypedDateRange) {
    // External and hourly allocations both use the raw Start/End inputs. Validate this once so
    // neither mode can persist a range the advisory deliberately refuses to enumerate.
    if (!startDate || !endDate) return { field: "dates", message: m.form_allocation_err_dates_required() };
    if (endDate < startDate) return { field: "dates", message: m.form_allocation_err_end_before_start() };
    if (input.typedDateSpanTooLong) {
      return {
        field: "dates",
        message: m.form_allocation_err_date_span_range({ max: MAX_SPAN_DAYS.toLocaleString("en-GB") }),
      };
    }
  }
  if (isBlocks || isDays) {
    // Blocks and days derive their end date from the SAME (start, days-over) pair, so they reject
    // it identically. Days then adds its own work-volume field on top.
    const countProblem = validateCountField(input);
    if (countProblem) return countProblem;
    if (isDays && !(input.daysOfWork > 0)) {
      return { field: "daysOfWork", message: m.form_allocation_err_days_of_work_gt_zero() };
    }
  } else if (!isExternal) {
    if (!(input.hoursPerDay > 0)) return { field: "hours", message: m.form_allocation_err_hours_gt_zero() };
  }
  const { repeat } = input;
  if (repeat) {
    if (!repeat.until || !isValidISODate(repeat.until)) {
      return { field: "repeatUntil", message: m.form_allocation_err_repeat_until_required() };
    }
    if (repeat.until < repeat.today) {
      return { field: "repeatUntil", message: m.form_allocation_err_repeat_until_past() };
    }
    if (repeat.until < startDate) {
      return { field: "repeatUntil", message: m.form_allocation_err_repeat_until_before_start() };
    }
    if (!repeat.maximum) return { field: "repeatUntil", message: m.form_allocation_err_repeat_date_domain() };
    if (repeat.until > repeat.maximum) {
      return {
        field: "repeatUntil",
        message: m.form_allocation_err_repeat_until_after_max({ max: formatShortDate(repeat.maximum) }),
      };
    }
    try {
      generateRepeatingStartDates(startDate, repeat.until, repeatPatternForSelection(repeat.selection));
    } catch (error) {
      if (error instanceof RepeatingDateError) {
        return {
          field: "repeatUntil",
          message:
            error.code === "no-repeat"
              ? m.form_allocation_err_repeat_until_no_occurrence()
              : m.form_allocation_err_repeat_date_domain(),
        };
      }
      return {
        field: null,
        message: error instanceof Error ? errorMessage(error) : m.form_allocation_err_save_failed(),
      };
    }
  }
  // Single anti-silent-clamp guard for every load-carrying mode (days + hourly; external is a
  // 0-load span and blocks derive a safe block load, so both are excluded). The store clamps an
  // allocation's load into [0, MAX_HOURS_PER_DAY] AND collapses a non-finite value to 0 — so a
  // derived load that's NaN (a part-typed "Days over" → hoursPerDayFor returns NaN) or above the
  // cap (an Enter-submit before the field's on-blur clamp) would SILENTLY save the wrong volume.
  // Require a finite load in (0, MAX_HOURS_PER_DAY] instead, so the preview ("…h/day") is exactly
  // what saves, failing to the field the user can act on in each mode.
  if (
    !isExternal &&
    !isBlocks &&
    !(Number.isFinite(effHoursPerDay) && effHoursPerDay > 0 && effHoursPerDay <= MAX_HOURS_PER_DAY)
  ) {
    return isDays
      ? { field: "daysOfWork", message: m.form_allocation_err_days_over_max({ max: MAX_HOURS_PER_DAY }) }
      : { field: "hours", message: m.form_allocation_err_hours_over_max({ max: MAX_HOURS_PER_DAY }) };
  }
  return null;
}

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
  /** The end the current form state derives (`effectiveAllocationValues`). */
  effectiveEndDate: ISODate;
}

/** The end date to persist. A span-mode edit that changed NOTHING the span depends on keeps the
 *  STORED end verbatim: re-deriving it would silently renormalise a historical row (one saved under
 *  a different working week, or before a span rule changed) on an unrelated edit such as a note. */
export function deriveEndDate({
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

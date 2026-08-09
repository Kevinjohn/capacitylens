import { addDaysISO, daysInclusive } from "@capacitylens/shared/lib/dateMath";
import { endDateForSpan, maxSpanDaysForStart, MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import type { RepeatPattern } from "@capacitylens/shared/lib/repeatingDates";
import type { Allocation, ISODate, Resource, SchedulingMode, TimeOff } from "@capacitylens/shared/types/entities";
import type { Draft } from "../store/useStore";
import { capacityAdvisory, type CapacityAllocationInput } from "./capacity";

/** Transient choice shown only while creating an allocation. */
export type RepeatSelection =
  "none" | "weekly" | "every-two-weeks" | "every-three-weeks" | "every-four-weeks" | "monthly";

/** Scheduling inputs that a persisted allocation draft does not carry. */
export interface RepeatProjectionContext {
  schedulingMode: SchedulingMode;
  daysOver: number;
  resource: Pick<Resource, "id" | "kind" | "workingDays">;
}

/** Number of generated allocations with each non-blocking advisory category. */
export interface RepeatingAllocationAdvisory {
  overCapacityAllocations: number;
  timeOffAllocations: number;
}

const REPEAT_PATTERNS: Record<Exclude<RepeatSelection, "none">, RepeatPattern> = {
  weekly: { kind: "weeks", interval: 1 },
  "every-two-weeks": { kind: "weeks", interval: 2 },
  "every-three-weeks": { kind: "weeks", interval: 3 },
  "every-four-weeks": { kind: "weeks", interval: 4 },
  monthly: { kind: "monthly-date" },
};

/** Map a repeating form choice to the shared date-generation pattern. */
export function repeatPatternForSelection(selection: Exclude<RepeatSelection, "none">): RepeatPattern {
  return REPEAT_PATTERNS[selection];
}

/**
 * Project a validated allocation draft onto generated repeat starts.
 * The first result is the exact `baseDraft` object; later results change only the date range.
 *
 * @throws Error when the resolved resource does not match the draft.
 * @throws RangeError when a working-span mode receives an invalid `daysOver` value or a projected range
 *   leaves the supported ISO-date domain.
 */
export function projectAllocationDates(
  baseDraft: Draft<Allocation>,
  startDates: readonly ISODate[],
  context: RepeatProjectionContext,
): Draft<Allocation>[] {
  if (context.resource.id !== baseDraft.resourceId) {
    throw new Error("The repeat projection resource does not match the allocation resource.");
  }
  if (startDates.length === 0 || startDates[0] !== baseDraft.startDate) {
    throw new Error("Repeat projection must begin with the validated allocation draft.");
  }
  const external = context.resource.kind === "external";
  if (
    !external &&
    context.schedulingMode !== "hourly" &&
    (!Number.isSafeInteger(context.daysOver) || context.daysOver < 1 || context.daysOver > MAX_SPAN_DAYS)
  ) {
    throw new RangeError(`Repeat projection daysOver must be a whole number from 1 to ${MAX_SPAN_DAYS}.`);
  }

  const calendarSpan = daysInclusive(baseDraft.startDate, baseDraft.endDate);
  if (calendarSpan < 1) throw new RangeError("Repeat projection requires a valid inclusive date range.");
  const usesCalendarSpan = external || context.schedulingMode === "hourly";
  const spanOptions = {
    workingDays: context.resource.workingDays,
    ignoreWeekends: baseDraft.ignoreWeekends,
  };
  if (!usesCalendarSpan) {
    for (const generatedStart of startDates) {
      if (context.daysOver > maxSpanDaysForStart(generatedStart, spanOptions)) {
        throw new RangeError("A repeated working span extends beyond the supported date range.");
      }
    }
  }

  return startDates.map((generatedStart, index) => {
    if (index === 0) return baseDraft;
    const projectedEnd = usesCalendarSpan
      ? addDaysISO(generatedStart, calendarSpan - 1)
      : endDateForSpan(generatedStart, context.daysOver, spanOptions);
    return { ...baseDraft, startDate: generatedStart, endDate: projectedEnd };
  });
}

/**
 * Count generated allocations that conflict with existing/generated load or time off.
 * Earlier drafts are added to the comparison set before later drafts are checked, so internal batch
 * overlaps are visible without inventing entity ids or persisting anything.
 */
export function repeatingAllocationAdvisory(
  resource: Resource,
  existingLoad: readonly CapacityAllocationInput[],
  timeOff: TimeOff[],
  proposedDrafts: readonly Draft<Allocation>[],
): RepeatingAllocationAdvisory {
  if (resource.kind === "external") return { overCapacityAllocations: 0, timeOffAllocations: 0 };
  const comparisonLoad: CapacityAllocationInput[] = [...existingLoad];
  let overCapacityAllocations = 0;
  let timeOffAllocations = 0;
  for (const draft of proposedDrafts) {
    const result = capacityAdvisory(
      resource,
      comparisonLoad,
      timeOff,
      draft.startDate,
      draft.endDate,
      draft.hoursPerDay,
      draft.ignoreWeekends,
    );
    if (result.overDays > 0) overCapacityAllocations += 1;
    if (result.timeOffDays > 0) timeOffAllocations += 1;
    comparisonLoad.push(draft);
  }
  return { overCapacityAllocations, timeOffAllocations };
}

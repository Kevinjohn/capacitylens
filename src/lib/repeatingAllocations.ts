import { addDaysISO, daysInclusive, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { startsOnNonEffectiveWeekday, type EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { endDateForSpan, maxSpanDaysForStart, MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import type { RepeatPattern } from "@capacitylens/shared/lib/repeatingDates";
import { isCapacityTracked, isExternalResource } from "@capacitylens/shared/types/entities";
import type { Allocation, ISODate, Resource, SchedulingMode, TimeOff } from "@capacitylens/shared/types/entities";
import type { Draft } from "../store/useStore";
import {
  addCapacityLoad,
  bucketCapacityLoad,
  capacityAdvisory,
  capacityAdvisoryFromLoad,
  type CapacityAllocationInput,
} from "./capacity";

/** Transient choice shown only while creating an allocation. */
export type RepeatSelection =
  | "none"
  | "weekly"
  | "every-two-weeks"
  | "every-three-weeks"
  | "every-four-weeks"
  | "monthly";

/** Scheduling inputs that a persisted allocation draft does not carry. */
export interface RepeatProjectionContext {
  schedulingMode: SchedulingMode;
  daysOver: number;
  resource: Pick<Resource, "id" | "kind">;
  effectiveWeek: EffectiveWorkingWeek;
}

/** Number of generated allocations with each non-blocking advisory category. */
export interface RepeatingAllocationAdvisory {
  overCapacityAllocations: number;
  timeOffAllocations: number;
  nonEffectiveStartAllocations: number;
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
 * @throws RangeError when a working-span mode receives an invalid `daysOver` value, has no effective
 *   working days, or a projected range leaves the supported ISO-date domain. Record-creation callers
 *   reject an empty effective week before projection so copy is routed to the assignee/form surface.
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
  const external = isExternalResource(context.resource);
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
  if (!usesCalendarSpan && !baseDraft.ignoreWeekends && context.effectiveWeek.kind === "none") {
    throw new RangeError("Repeat projection requires at least one effective working day.");
  }
  const spanOptions = {
    workingDays: context.effectiveWeek.kind === "days" ? context.effectiveWeek.days : undefined,
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
  effectiveWeek: EffectiveWorkingWeek,
): RepeatingAllocationAdvisory {
  if (!isCapacityTracked(resource)) {
    return { overCapacityAllocations: 0, timeOffAllocations: 0, nonEffectiveStartAllocations: 0 };
  }
  // Bucket the existing load by day ONCE for the whole batch and add each checked draft to that
  // SAME map, instead of handing capacityAdvisory a comparison list that grows by one allocation
  // per draft — which re-bucketed everything already seen, making a k-occurrence repeat O(k²) in
  // day-string work. Hours still land existing-load-first, then draft 0, 1, …, so every per-day sum
  // is bit-identical to the per-draft rebuild (float addition is not associative).
  const batchWindow = sharedLoadWindow(proposedDrafts);
  const shared = batchWindow
    ? {
        window: batchWindow,
        load: bucketCapacityLoad(resource, existingLoad, batchWindow.start, batchWindow.end, effectiveWeek),
      }
    : null;
  // Only reachable from an absurd (~100-year) span, where the batch is wider than one
  // materialisable window: keep the original per-draft rebuild rather than trade a slow answer for
  // a thrown range error.
  const rebuiltLoad: CapacityAllocationInput[] = shared ? [] : [...existingLoad];
  let overCapacityAllocations = 0;
  let timeOffAllocations = 0;
  let nonEffectiveStartAllocations = 0;
  for (const draft of proposedDrafts) {
    const result = shared
      ? capacityAdvisoryFromLoad(resource, draft, shared.load, timeOff, effectiveWeek)
      : capacityAdvisory(resource, draft, rebuiltLoad, timeOff, effectiveWeek);
    if (result.overDays > 0) overCapacityAllocations += 1;
    if (result.timeOffDays > 0) timeOffAllocations += 1;
    if (startsOnNonEffectiveWeekday(effectiveWeek, draft.ignoreWeekends, weekdayOf(draft.startDate))) {
      nonEffectiveStartAllocations += 1;
    }
    if (shared) addCapacityLoad(shared.load, resource, draft, shared.window.start, shared.window.end, effectiveWeek);
    else rebuiltLoad.push(draft);
  }
  return { overCapacityAllocations, timeOffAllocations, nonEffectiveStartAllocations };
}

/** The one window every draft in the batch falls inside, or `null` when it is too wide to
 *  materialise (the ceiling `capacityAdvisory` already refuses a single window at). */
function sharedLoadWindow(drafts: readonly Draft<Allocation>[]): { start: ISODate; end: ISODate } | null {
  const first = drafts[0];
  if (!first) return null;
  // Zero-padded ISO dates compare lexicographically, so plain min/max is chronological.
  let start = first.startDate;
  let end = first.endDate;
  for (const draft of drafts) {
    if (draft.startDate < start) start = draft.startDate;
    if (draft.endDate > end) end = draft.endDate;
  }
  const span = daysInclusive(start, end);
  return span >= 1 && span <= MAX_SPAN_DAYS ? { start, end } : null;
}

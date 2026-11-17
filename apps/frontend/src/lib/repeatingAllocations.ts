import { daysInclusive, weekdayOf } from '@capacitylens/shared/lib/dateMath';
import { startsOnNonEffectiveWeekday } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import type { EffectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import { MAX_SPAN_DAYS } from '@capacitylens/shared/lib/schedulingDays';
import type { RepeatPattern } from '@capacitylens/shared/lib/repeatingDates';
import { isCapacityTracked } from '@capacitylens/shared/types/entities';
import type {
  Allocation,
  Closure,
  ISODate,
  Resource,
  TimeOff,
} from '@capacitylens/shared/types/entities';
import type { Draft } from '@/lib/entityDrafts';
import {
  addCapacityLoad,
  bucketCapacityLoad,
  buildCapacityAdvisory,
  buildCapacityAdvisoryFromLoad,
} from './capacity';
import type { CapacityAllocationInput } from './capacity';

interface BuildRepeatingAllocationAdvisoryInput {
  resource: Resource;
  existingLoad: readonly CapacityAllocationInput[];
  timeOff: TimeOff[];
  proposedDrafts: readonly Draft<Allocation>[];
  effectiveWeek: EffectiveWorkingWeek;
  closures: Closure[];
}

/** Transient choice shown only while creating an allocation. */
export type RepeatSelection =
  'none' | 'weekly' | 'every-two-weeks' | 'every-three-weeks' | 'every-four-weeks' | 'monthly';

/** Number of generated allocations with each non-blocking advisory category. */
export interface RepeatingAllocationAdvisory {
  overCapacityAllocations: number;
  timeOffAllocations: number;
  nonEffectiveStartAllocations: number;
}

const REPEAT_PATTERNS: Record<Exclude<RepeatSelection, 'none'>, RepeatPattern> = {
  weekly: { kind: 'weeks', interval: 1 },
  'every-two-weeks': { kind: 'weeks', interval: 2 },
  'every-three-weeks': { kind: 'weeks', interval: 3 },
  'every-four-weeks': { kind: 'weeks', interval: 4 },
  monthly: { kind: 'monthly-date' },
};

/** Map a repeating form choice to the shared date-generation pattern. */
export function resolveRepeatPattern(selection: Exclude<RepeatSelection, 'none'>): RepeatPattern {
  return REPEAT_PATTERNS[selection];
}

/**
 * Count generated allocations that conflict with existing/generated load or time off.
 * Earlier drafts are added to the comparison set before later drafts are checked, so internal batch
 * overlaps are visible without inventing entity ids or persisting anything.
 */
export function buildRepeatingAllocationAdvisory({
  resource,
  existingLoad,
  timeOff,
  proposedDrafts,
  effectiveWeek,
  closures,
}: BuildRepeatingAllocationAdvisoryInput): RepeatingAllocationAdvisory {
  if (!isCapacityTracked(resource)) {
    return { overCapacityAllocations: 0, timeOffAllocations: 0, nonEffectiveStartAllocations: 0 };
  }
  // Share one load bucket across repeated drafts to keep day work linear in generated
  // occurrences. Add existing rows and drafts in stable order because floating-point
  // addition is not associative.
  const shared = createSharedLoad({
    resource,
    existingLoad,
    proposedDrafts,
    effectiveWeek,
    timeOff,
    closures,
  });
  // Only reachable from an absurd (~100-year) span, where the batch is wider than one
  // materialisable window: keep the original per-draft rebuild rather than trade a slow answer for
  // a thrown range error.
  const rebuiltLoad: CapacityAllocationInput[] = shared ? [] : [...existingLoad];
  let overCapacityAllocations = 0;
  let timeOffAllocations = 0;
  let nonEffectiveStartAllocations = 0;
  for (const draft of proposedDrafts) {
    const result = shared
      ? buildCapacityAdvisoryFromLoad({
          resource: resource,
          proposal: draft,
          loadByDay: shared.load,
          timeOff: timeOff,
          effectiveWeek: effectiveWeek,
          closures: closures,
        })
      : buildCapacityAdvisory({
          resource: resource,
          proposal: draft,
          otherAllocations: rebuiltLoad,
          timeOff: timeOff,
          effectiveWeek: effectiveWeek,
          closures: closures,
        });
    if (result.overDays > 0) overCapacityAllocations += 1;
    if (result.timeOffDays > 0) timeOffAllocations += 1;
    if (
      startsOnNonEffectiveWeekday(
        effectiveWeek,
        draft.ignoreWorkingDays ?? undefined,
        weekdayOf(draft.startDate),
      )
    ) {
      nonEffectiveStartAllocations += 1;
    }
    if (shared) {
      addCapacityLoad({
        byDay: shared.load,
        resource: resource,
        allocation: draft,
        start: shared.window.start,
        end: shared.window.end,
        effectiveWeek: effectiveWeek,
      });
    } else rebuiltLoad.push(draft);
  }
  return { overCapacityAllocations, timeOffAllocations, nonEffectiveStartAllocations };
}

function createSharedLoad({
  resource,
  existingLoad,
  proposedDrafts,
  effectiveWeek,
}: BuildRepeatingAllocationAdvisoryInput) {
  const window = resolveSharedLoadWindow(proposedDrafts);
  if (!window) return null;
  return {
    window,
    load: bucketCapacityLoad({
      resource,
      allocations: existingLoad,
      start: window.start,
      end: window.end,
      effectiveWeek,
    }),
  };
}

function resolveSharedLoadWindow(
  drafts: readonly Draft<Allocation>[],
): { start: ISODate; end: ISODate } | null {
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

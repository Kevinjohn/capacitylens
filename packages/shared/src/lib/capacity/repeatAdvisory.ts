import { daysInclusive, weekdayOf } from '../dateMath.js';
import { isStartOnNonEffectiveWeekday } from '../effectiveWorkingWeek.js';
import type { EffectiveWorkingWeek } from '../effectiveWorkingWeek.js';
import { MAX_SPAN_DAYS } from '../schedulingDays.js';
import { isCapacityTracked } from '../../types/entities.js';
import type { Closure, ISODate, Resource, TimeOff } from '../../types/entities.js';
import {
  addCapacityLoad,
  bucketCapacityLoad,
  buildCapacityAdvisory,
  buildCapacityAdvisoryFromLoad,
} from '../capacity.js';
import type { CapacityAllocationInput } from '../capacity.js';

interface BuildRepeatingAllocationAdvisoryInput {
  resource: Resource;
  existingLoad: readonly CapacityAllocationInput[];
  timeOff: TimeOff[];
  proposedDrafts: readonly CapacityAllocationInput[];
  effectiveWeek: EffectiveWorkingWeek;
  closures: Closure[];
}

/** Number of generated allocations with each non-blocking advisory category. */
export interface RepeatingAllocationAdvisory {
  overCapacityAllocations: number;
  timeOffAllocations: number;
  nonEffectiveStartAllocations: number;
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
          resource,
          proposal: draft,
          loadByDay: shared.load,
          timeOff,
          effectiveWeek,
          closures,
        })
      : buildCapacityAdvisory({
          resource,
          proposal: draft,
          otherAllocations: rebuiltLoad,
          timeOff,
          effectiveWeek,
          closures,
        });
    if (result.overDays > 0) overCapacityAllocations += 1;
    if (result.timeOffDays > 0) timeOffAllocations += 1;
    if (
      isStartOnNonEffectiveWeekday(
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
        resource,
        allocation: draft,
        start: shared.window.start,
        end: shared.window.end,
        effectiveWeek,
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
  drafts: readonly CapacityAllocationInput[],
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

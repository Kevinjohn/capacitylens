import { daysInclusive, eachDayISO, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import { effectiveWeekIncludes, type EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import type { Allocation, Closure, ISODate, Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { allocationLoadsOnDay, exceedsCapacity } from "../capacity";
import { isWorkingDay, isUnavailable, scheduledHoursForWeekday } from "./availability";

export interface CapacityAdvisory {
  overDays: number; // days the proposed allocation works where existing + proposed hours exceed availability
  timeOffDays: number; // days in the window the resource is on time off
  /** Repeat-only: generated occurrences whose start weekday is outside the effective week. */
  nonEffectiveStartAllocations?: number;
}

/** Allocation fields read by the capacity advisory, accepting persisted rows or transient drafts. */
export type CapacityAllocationInput = Pick<
  Allocation,
  "resourceId" | "startDate" | "endDate" | "hoursPerDay" | "ignoreWeekends"
>;

/** Existing load in hours, keyed by the ISO day it lands on, for ONE resource. Building this ONCE
 *  is what makes an advisory O(window + load) instead of O(windowDays × allocations) — and lets a
 *  batch of advisories over the same resource (a repeat projection) share a single bucket instead
 *  of rebuilding a growing one per generated allocation. */
export type CapacityLoadByDay = Map<ISODate, number>;

/** Add `allocation`'s hours to `byDay` on every day of [start, end] that it actually works.
 *  Allocations belonging to another resource are ignored, mirroring `allocatedHoursOnDay`:
 *  correctness must not depend on every caller remembering to pre-filter, or an unfiltered list
 *  would count other people's hours against this resource and advise "over capacity" for days that
 *  are perfectly fine. */
export function addCapacityLoad(
  byDay: CapacityLoadByDay,
  resource: Resource,
  allocation: CapacityAllocationInput,
  start: ISODate,
  end: ISODate,
  effectiveWeek: EffectiveWorkingWeek,
): void {
  if (allocation.resourceId !== resource.id) return;
  // Zero-padded ISO dates compare lexicographically, so these min/max clamps are correct.
  const from = allocation.startDate > start ? allocation.startDate : start;
  const to = allocation.endDate < end ? allocation.endDate : end;
  for (const d of eachDayISO(from, to)) {
    // Count each existing allocation only on the days IT works, matching the over-marker's load.
    if (!allocationLoadsOnDay(effectiveWeek, allocation.ignoreWeekends, isWorkingDay(effectiveWeek, d))) continue;
    byDay.set(d, (byDay.get(d) ?? 0) + allocation.hoursPerDay);
  }
}

/** Bucket a whole existing load onto [start, end]. Hours land in `allocations` order, so a bucket
 *  built here sums identically to one grown allocation-by-allocation (float addition is not
 *  associative — the order is load-bearing for bit-identical advisories). */
export function bucketCapacityLoad(
  resource: Resource,
  allocations: readonly CapacityAllocationInput[],
  start: ISODate,
  end: ISODate,
  effectiveWeek: EffectiveWorkingWeek,
): CapacityLoadByDay {
  const byDay: CapacityLoadByDay = new Map();
  for (const a of allocations) addCapacityLoad(byDay, resource, a, start, end, effectiveWeek);
  return byDay;
}

/** The days a proposal covers, or `null` when its window is empty or beyond the product span limit.
 *  Proposed input may not have reached the durable write boundary yet, so this refusal is O(1) and
 *  happens before eachDayISO allocates one string per date. */
function advisoryDays(proposal: CapacityAllocationInput): ISODate[] | null {
  const span = daysInclusive(proposal.startDate, proposal.endDate);
  if (span < 1 || span > MAX_SPAN_DAYS) return null;
  return eachDayISO(proposal.startDate, proposal.endDate);
}

function tallyAdvisory(
  resource: Resource,
  proposal: CapacityAllocationInput,
  days: ISODate[],
  loadByDay: CapacityLoadByDay,
  timeOff: TimeOff[],
  effectiveWeek: EffectiveWorkingWeek,
  closures: Closure[],
): CapacityAdvisory {
  let overDays = 0;
  let timeOffDays = 0;
  for (const day of days) {
    // Derive the weekday + time-off ONCE per day and reuse for both tallies — availableHoursOnDay
    // would otherwise re-run isWorkingDay (and isOnTimeOff) a second time on this hot path.
    const weekday = weekdayOf(day);
    const working = effectiveWeekIncludes(effectiveWeek, weekday);
    const onTimeOff = working && isUnavailable(resource, day, timeOff, closures);
    // Time off is its own category (counted, surfaced separately) and never folded into overDays —
    // a holiday only costs capacity on a day the resource would have worked, and it reads as "on
    // time off", not "over". `continue` so it can't also be tallied as over below.
    if (onTimeOff) {
      timeOffDays++;
      continue;
    }
    // The proposal does no work on a day it doesn't cover (a weekend-aware bar over Sat/Sun) — skip.
    if (!allocationLoadsOnDay(effectiveWeek, proposal.ignoreWeekends, working)) continue;
    // Mirrors availableHoursOnDay: a non-working weekday the proposal opts into (ignoreWeekends) has
    // 0 capacity, so any proposed hours there read as over — exactly like the per-day over-marker.
    const available = working ? scheduledHoursForWeekday(resource, weekday, effectiveWeek) : 0;
    if (exceedsCapacity((loadByDay.get(day) ?? 0) + proposal.hoursPerDay, available)) overDays++;
  }
  return { overDays, timeOffDays };
}

/** Non-blocking advisory for a PROPOSED allocation (its own dates, `hoursPerDay` and
 *  `ignoreWeekends`): how many days it would push the resource over capacity, and how many fall on
 *  time off. The proposal is taken whole so a draft or persisted row passes straight through — only
 *  its `resourceId` is unread, because the advisory always scopes to `resource`.
 *  `otherAllocations` is the existing load to count against (caller excludes the allocation being
 *  edited); it need NOT be pre-filtered by resource (see `addCapacityLoad`).
 *  Shared by the modal and the drag-commit path so the rule
 *  lives in one place. Mirrors the per-day over-marker (`allocatedHoursOnDay`): it counts a day only
 *  when the proposed allocation actually WORKS it (so a weekend-aware bar merely spanning Sat/Sun
 *  isn't "over"), and an `ignoreWeekends` weekend — 0 capacity — reads as over exactly like the red
 *  cell does. Time off stays its OWN category, never folded into overDays (a holiday a working
 *  allocation covers is surfaced as "on time off for N days", not "over"), which is the one place the
 *  advisory deliberately diverges from the marker. */
export function capacityAdvisory(
  resource: Resource,
  proposal: CapacityAllocationInput,
  otherAllocations: readonly CapacityAllocationInput[],
  timeOff: TimeOff[],
  effectiveWeek: EffectiveWorkingWeek,
  closures: Closure[],
): CapacityAdvisory {
  const days = advisoryDays(proposal);
  if (!days) return { overDays: 0, timeOffDays: 0 };
  const loadByDay = bucketCapacityLoad(resource, otherAllocations, proposal.startDate, proposal.endDate, effectiveWeek);
  return tallyAdvisory(resource, proposal, days, loadByDay, timeOff, effectiveWeek, closures);
}

/** `capacityAdvisory` against a load bucket the caller already holds — for a BATCH of proposals on
 *  one resource, where rebuilding the bucket per proposal is the dominant cost. The bucket must
 *  cover at least the proposal's window (see `bucketCapacityLoad`). */
export function capacityAdvisoryFromLoad(
  resource: Resource,
  proposal: CapacityAllocationInput,
  loadByDay: CapacityLoadByDay,
  timeOff: TimeOff[],
  effectiveWeek: EffectiveWorkingWeek,
  closures: Closure[],
): CapacityAdvisory {
  const days = advisoryDays(proposal);
  return days
    ? tallyAdvisory(resource, proposal, days, loadByDay, timeOff, effectiveWeek, closures)
    : { overDays: 0, timeOffDays: 0 };
}

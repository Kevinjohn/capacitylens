import {
  allocationWorksOnDay,
  daysInclusive,
  eachDayISO,
  isWithin,
  weekdayOf,
} from "@capacitylens/shared/lib/dateMath";
import { blockHoursPerDay, MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import { effectiveWeekIncludes, type EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { m } from "@/i18n";
import { FULL_DAY_HOURS, HALF_DAY_HOURS } from "@capacitylens/shared/types/entities";
import type { Allocation, ID, ISODate, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";

// Arithmetic-only tolerance: one nanohour is 3.6 microseconds, far below any scheduling input,
// while comfortably absorbing the few-ULP drift from summing days-mode fractional allocations.
const CAPACITY_COMPARISON_EPSILON_HOURS = 1e-9;

function exceedsCapacity(allocated: number, available: number): boolean {
  return allocated - available > CAPACITY_COMPARISON_EPSILON_HOURS;
}

/** The hours/day a blocks-mode allocation contributes to capacity. Read from the ONE knob
 *  (`blockHoursPerDay`, schedulingDays.ts) rather than hardcoding its current 0, so making blocks
 *  carry load is a change to that fraction alone. A resource's own working day may be shorter than
 *  the standard one, but this projection has no account context — `FULL_DAY_HOURS` is the same
 *  reference day the fraction is documented against. */
const BLOCK_PROJECTED_HOURS_PER_DAY = blockHoursPerDay(FULL_DAY_HOURS);

/** Blocks carry placement but no hourly load. Reuse this projection across every capacity surface. */
export function capacityAllocationsForMode(allocations: Allocation[], blocksMode: boolean): Allocation[] {
  return blocksMode
    ? allocations.map((allocation) => ({ ...allocation, hoursPerDay: BLOCK_PROJECTED_HOURS_PER_DAY }))
    : allocations;
}

// Capacity reflects the effective company/personal working pattern: a resource has 0 available
// hours on a non-working weekday or time-off day, 4 hours on a half day, and 8 hours on a full day.
// A day is over-allocated when allocated hours exceed available hours. A normal
// (weekend-aware) allocation does NO work on the effective week's non-working weekdays —
// a bar that merely SPANS Sat/Sun is not over there — so the only zero-capacity
// days that read as over are (a) a TIME-OFF day a working allocation covers (a real
// conflict) and (b) a weekend an allocation opts into via `ignoreWeekends`.
//
// PRECONDITION: every `hoursPerDay` reaching this module is a finite, non-negative number —
// guaranteed at every write boundary by integrity.ts (clampHoursPerDay) on store add/update,
// import remap, and server validate. A NaN/undefined
// slipping through is WORSE than a crash here: `NaN > x` is always false, so an over-allocated day
// would read as "never over" — a silently WRONG answer in a multi-tenant scheduler, not a visible
// failure. We therefore do NOT throw on this per-day × per-allocation hot path (that would swallow
// or crash in the wrong place); in DEV we WARN so corruption surfaces as a fault to investigate.
function devAssertFinite(n: number): void {
  if (import.meta.env.DEV && !Number.isFinite(n)) {
    console.warn(
      `capacity: allocated hours sum is not a finite number (${String(n)}). Upstream validation ` +
        `(integrity.ts) should have prevented this — over/utilisation results for this resource will be wrong.`,
    );
  }
}

// Every public helper below takes an `ISODate` and derives its weekday; each `…ForWeekday` twin
// takes one already derived. `weekdayOf` is a parseISO, and `dayCapacity` — the scheduler's hottest
// path, ~27k resource-days per model rebuild — needs the SAME weekday four times over. It derives
// it ONCE and threads it through the twins; the public signatures stay date-only.
/** Whether an allocation loads this date. Keep `none` explicit: an empty weekday array has
 * calendar-day semantics in allocationWorksOnDay, which is the opposite of the capacity contract. */
function allocationLoadsOnDay(
  effectiveWeek: EffectiveWorkingWeek,
  ignoreWorkingDays: boolean | undefined,
  dayIsWorking: boolean,
): boolean {
  if (ignoreWorkingDays) return true;
  if (effectiveWeek.kind === "none") return false;
  return allocationWorksOnDay(effectiveWeek.days, false, dayIsWorking);
}

export function isWorkingDay(effectiveWeek: EffectiveWorkingWeek, date: ISODate): boolean {
  return effectiveWeekIncludes(effectiveWeek, weekdayOf(date));
}

/** A saved half-day working pattern on this weekday — 4h of capacity instead of 8h. The scheduler's
 *  partial-capacity tint asks the same question, so both read this one definition. */
export function isHalfDay(resource: Resource, weekday: Weekday): boolean {
  return resource.halfDays.includes(weekday);
}

function scheduledHoursForWeekday(resource: Resource, weekday: Weekday, effectiveWeek: EffectiveWorkingWeek): number {
  if (!effectiveWeekIncludes(effectiveWeek, weekday)) return 0;
  return isHalfDay(resource, weekday) ? HALF_DAY_HOURS : FULL_DAY_HOURS;
}

/** Fixed capacity before time off: 8h full day, 4h half day, or 0 when not working. */
export function scheduledHoursOnDay(resource: Resource, date: ISODate, effectiveWeek: EffectiveWorkingWeek): number {
  return scheduledHoursForWeekday(resource, weekdayOf(date), effectiveWeek);
}

export function isOnTimeOff(resourceId: ID, date: ISODate, timeOff: TimeOff[]): boolean {
  return timeOff.some((t) => t.resourceId === resourceId && isWithin(date, t.startDate, t.endDate));
}

function availableHoursForWeekday(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  weekday: Weekday,
  effectiveWeek: EffectiveWorkingWeek,
): number {
  if (!effectiveWeekIncludes(effectiveWeek, weekday)) return 0;
  if (isOnTimeOff(resource.id, date, timeOff)) return 0;
  return scheduledHoursForWeekday(resource, weekday, effectiveWeek);
}

/** Available working hours for `resource` on `date`: 0 on a non-working weekday or time off,
 *  fixed 4h on a half day, otherwise fixed 8h. */
export function availableHoursOnDay(
  resource: Resource,
  date: ISODate,
  timeOff: TimeOff[],
  effectiveWeek: EffectiveWorkingWeek,
): number {
  return availableHoursForWeekday(resource, date, timeOff, weekdayOf(date), effectiveWeek);
}

/** Sum of allocated hours for `resource` on `date` across every overlapping allocation.
 *  A weekend-aware allocation (the default for a partial working week) does NO work on the
 *  effective week's non-working weekdays, so a bar that merely SPANS Sat/Sun contributes 0 there —
 *  matching how the same `isWeekendAware` rule governs the bar's duration and drag. An allocation
 *  that ignores the working calendars (`ignoreWeekends`) places its hours on every calendar day in
 *  `[startDate, endDate]`. A normal allocation with no effective week loads no days. Time-off days
 *  that remain effective weekdays still load, preserving the real over-capacity conflict.
 *  @remarks Assumes each `hoursPerDay` is finite (see the top-of-file precondition) — a NaN would
 *    poison the sum and make every over/utilisation comparison read as "never over". */
export function allocatedHoursOnDay(
  resource: Resource,
  date: ISODate,
  allocations: Allocation[],
  effectiveWeek: EffectiveWorkingWeek,
): number {
  return allocatedHoursForWeekday(resource, date, allocations, weekdayOf(date), effectiveWeek);
}

function allocatedHoursForWeekday(
  resource: Resource,
  date: ISODate,
  allocations: Allocation[],
  weekday: Weekday,
  effectiveWeek: EffectiveWorkingWeek,
): number {
  // Derive the working-weekday flag ONCE per day: it's invariant across the loop, only the
  // allocation's `ignoreWeekends` varies (and isWeekendAware is parse-free), so this keeps the
  // render-time over-marker hot path off a per-allocation parseISO.
  const dayIsWorking = effectiveWeekIncludes(effectiveWeek, weekday);
  let sum = 0;
  for (const a of allocations) {
    if (a.resourceId !== resource.id || !isWithin(date, a.startDate, a.endDate)) continue;
    // `none` must stay explicit: passing [] to allocationWorksOnDay would mean calendar-day load.
    // Ignore working days bypasses both calendars; a normal allocation with no effective days
    // loads nothing anywhere.
    if (!allocationLoadsOnDay(effectiveWeek, a.ignoreWeekends, dayIsWorking)) continue;
    sum += a.hoursPerDay;
  }
  devAssertFinite(sum);
  return sum;
}

export interface DayCapacity {
  date: ISODate;
  allocated: number;
  available: number;
  over: boolean;
}

/** Allocated vs. available hours for one resource-day, with the `over` flag (allocated > available).
 *  @remarks Assumes finite, non-negative hours (see the top-of-file precondition). */
export function dayCapacity(
  resource: Resource,
  date: ISODate,
  allocations: Allocation[],
  timeOff: TimeOff[],
  effectiveWeek: EffectiveWorkingWeek,
): DayCapacity {
  // ONE parseISO for the whole resource-day: the availability and load halves each need the
  // weekday (twice over, for the working-week and half-day tests), and this runs per resource ×
  // per visible day on every model rebuild.
  const weekday = weekdayOf(date);
  const available = availableHoursForWeekday(resource, date, timeOff, weekday, effectiveWeek);
  const allocated = allocatedHoursForWeekday(resource, date, allocations, weekday, effectiveWeek);
  return {
    date,
    allocated,
    available,
    over: exceedsCapacity(allocated, available),
  };
}

/** Whole-window capacity, one entry per calendar day, derived straight from the inputs.
 *  The render path does NOT come through here: buildSchedulerModel walks the SAME window for every
 *  resource, so it builds the day array once, buckets each resource's allocations and time off by
 *  covered date (`bucketByCoveredDate`), and memoises `dayCapacity` per date. This stays the
 *  straight-line definition those optimisations are checked against. */
export function capacityForWindow(
  resource: Resource,
  allocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
  effectiveWeek: EffectiveWorkingWeek,
): DayCapacity[] {
  return eachDayISO(start, end).map((d) => dayCapacity(resource, d, allocations, timeOff, effectiveWeek));
}

/** Reduce already-computed resource-day capacity into the visible-window utilisation ratio. */
export function utilizationFromCapacity(days: Iterable<DayCapacity>): number {
  let allocated = 0;
  let available = 0;
  for (const day of days) {
    if (day.available === 0) continue; // not a working day — neither side counts
    allocated += day.allocated;
    available += day.available;
  }
  return available === 0 ? 0 : allocated / available;
}

/** Allocated / available over the window, counted over working days only.
 *  Returns 0 when there is no availability. Non-working days (weekends / time off)
 *  are skipped entirely — counting their allocated hours against zero availability
 *  would push a normal allocation that merely spans a weekend past 100%.
 *  Like `capacityForWindow`, this is the straight-line definition; the render path reaches the same
 *  number through `utilizationFromCapacity` over its memoised per-date capacity. */
export function utilization(
  resource: Resource,
  allocations: Allocation[],
  timeOff: TimeOff[],
  start: ISODate,
  end: ISODate,
  effectiveWeek: EffectiveWorkingWeek,
): number {
  return utilizationFromCapacity(capacityForWindow(resource, allocations, timeOff, start, end, effectiveWeek));
}

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
): CapacityAdvisory {
  let overDays = 0;
  let timeOffDays = 0;
  for (const day of days) {
    // Derive the weekday + time-off ONCE per day and reuse for both tallies — availableHoursOnDay
    // would otherwise re-run isWorkingDay (and isOnTimeOff) a second time on this hot path.
    const weekday = weekdayOf(day);
    const working = effectiveWeekIncludes(effectiveWeek, weekday);
    const onTimeOff = working && isOnTimeOff(resource.id, day, timeOff);
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
): CapacityAdvisory {
  const days = advisoryDays(proposal);
  if (!days) return { overDays: 0, timeOffDays: 0 };
  const loadByDay = bucketCapacityLoad(resource, otherAllocations, proposal.startDate, proposal.endDate, effectiveWeek);
  return tallyAdvisory(resource, proposal, days, loadByDay, timeOff, effectiveWeek);
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
): CapacityAdvisory {
  const days = advisoryDays(proposal);
  return days
    ? tallyAdvisory(resource, proposal, days, loadByDay, timeOff, effectiveWeek)
    : { overDays: 0, timeOffDays: 0 };
}

/** The surface an advisory is written for. Over/time-off counts exist on every surface; only the
 *  wording differs (a toast appends to a committed-move sentence, the form states it standalone).
 *  The `repeat` variant counts whole ALLOCATIONS and can add the non-effective-start count. */
export type CapacityAdvisoryVariant = "toast" | "form" | "repeat";

/** Pick the one/other form for a count. `one` and `other` are UNCALLED message references, invoked
 *  here at lookup time so Paraglide resolves the active locale on each render rather than freezing
 *  it at import — never call `m.*()` while building the table below. */
const plural =
  (one: (inputs: { count: number }) => string, other: (inputs: { count: number }) => string) =>
  (count: number): string =>
    count === 1 ? one({ count }) : other({ count });

const ADVISORY_COPY: Record<
  CapacityAdvisoryVariant,
  {
    over: (count: number) => string;
    timeOff: (count: number) => string;
    nonEffectiveStart?: (count: number) => string;
    join: () => string;
    wrap: (bits: string) => string;
  }
> = {
  toast: {
    over: plural(m.scheduler_advisory_over_one, m.scheduler_advisory_over_other),
    timeOff: plural(m.scheduler_advisory_timeoff_one, m.scheduler_advisory_timeoff_other),
    join: m.scheduler_advisory_join,
    wrap: (bits) => m.scheduler_advisory_prefix({ bits }),
  },
  form: {
    over: plural(m.form_allocation_advisory_over_capacity_one, m.form_allocation_advisory_over_capacity_other),
    timeOff: plural(m.form_allocation_advisory_timeoff_one, m.form_allocation_advisory_timeoff_other),
    join: m.form_allocation_advisory_join,
    wrap: (advisory) => m.form_allocation_advisory({ advisory }),
  },
  repeat: {
    over: plural(
      m.form_allocation_repeat_advisory_over_capacity_one,
      m.form_allocation_repeat_advisory_over_capacity_other,
    ),
    timeOff: plural(m.form_allocation_repeat_advisory_timeoff_one, m.form_allocation_repeat_advisory_timeoff_other),
    nonEffectiveStart: plural(
      m.form_allocation_repeat_advisory_non_effective_start_one,
      m.form_allocation_repeat_advisory_non_effective_start_other,
    ),
    join: m.form_allocation_repeat_advisory_join,
    wrap: (advisory) => m.form_allocation_repeat_advisory({ advisory }),
  },
};

/** The human sentence for an advisory result, or "" when it has nothing to say. Every surface
 *  builds it the same way — over-capacity bit, then time-off bit, then the repeat-only non-effective
 *  start bit, joined and wrapped — so ORDER and the "silent when all counts are zero" rule live here.
 *  For the `repeat` variant the counts are allocations, not days (see the copy table). */
export function formatCapacityAdvisory(result: CapacityAdvisory, variant: CapacityAdvisoryVariant): string {
  const copy = ADVISORY_COPY[variant];
  const bits: string[] = [];
  if (result.overDays) bits.push(copy.over(result.overDays));
  if (result.timeOffDays) bits.push(copy.timeOff(result.timeOffDays));
  if (result.nonEffectiveStartAllocations && copy.nonEffectiveStart) {
    bits.push(copy.nonEffectiveStart(result.nonEffectiveStartAllocations));
  }
  return bits.length ? copy.wrap(bits.join(copy.join())) : "";
}

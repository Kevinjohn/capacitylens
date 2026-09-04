import { m } from "@/i18n";
import type { CapacityAdvisory } from "./advisory";

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

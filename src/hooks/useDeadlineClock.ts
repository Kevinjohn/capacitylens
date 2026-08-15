import { useEffect, useState } from "react";

// A re-render alarm for lists whose rows change meaning when a DEADLINE passes — an invite that
// becomes "expired", a tombstone that becomes purgeable. Those rows are derived from `Date.now()`,
// and React has no reason to re-render when wall-clock time moves, so without an alarm the row keeps
// claiming "expires in 2 minutes" until something unrelated re-renders the section. Two Settings
// sections had grown the same timer machine; this is that machine, once.
//
// Deliberately NOT a ticking clock: one timeout armed for the one deadline that matters next, so an
// idle Settings tab does no periodic work at all.

/** `setTimeout`'s 32-bit signed delay ceiling. A larger delay OVERFLOWS in the browser and fires
 *  IMMEDIATELY (and then repeatedly, once per re-armed render) instead of far in the future, so a
 *  distant deadline must be clamped rather than passed through. A clamped wake is not the deadline:
 *  the timer re-arms itself for the remainder (see below) rather than reporting a boundary that has
 *  not been crossed. */
const MAX_TIMEOUT_DELAY = 2_147_483_647;

/**
 * A clock (ms since epoch) that advances once, just after the next deadline passes.
 *
 * Initially `Date.now()` at mount. `pickNext` is asked, on every render, which deadline matters next
 * GIVEN THE CLOCK THE HOOK IS ABOUT TO RETURN; while it answers non-null the hook arms a single
 * timeout for that instant, and when the timeout fires the clock is re-read and the component
 * re-renders. Any `now`-derived state (expired / purgeable / "in 3 days") is therefore recomputed
 * exactly when it changes and not before. Answer `null` when nothing is pending — no timer is armed.
 *
 * Passing the clock IN is what makes the chain self-sustaining. The caller's picker is nearly always
 * a `reduce` over rows that filters out deadlines already in the past, and the only clock that
 * filter may be compared against is this one: filtering against a fresh `Date.now()` would drop a
 * deadline the clock has not reached yet (the row would never be told it expired), and filtering
 * against a clock the caller holds separately makes each hook's state the other's input — the
 * circularity both call sites had grown independently.
 *
 * `pickNext` does NOT need to be stable, and inline arrows are the expected call shape: the effect
 * depends on the picked INSTANT, not on the function, so a new closure every render arms nothing new.
 * It must be pure — it runs during render, possibly more than once.
 *
 * A deadline further out than {@link MAX_TIMEOUT_DELAY} wakes the timer early; that wake re-arms for
 * the remainder INSIDE the effect rather than advancing the clock, because a clock advanced before
 * the deadline would be a re-render with nothing to show — and, since the picked instant would be
 * unchanged, the effect would not re-run to arm the next leg.
 *
 * This hook does NOT re-arm on `visibilitychange`/`pageshow`: a backgrounded tab may have its timers
 * throttled, so a deadline can be observed late after a long sleep. That is the behaviour both call
 * sites ship today and changing it is a product decision, not a refactor.
 *
 * @param pickNext - given the current clock, the next deadline as ms since epoch, or `null` if none.
 * @returns the current clock value; re-read (causing a re-render) just after that deadline passes.
 */
export function useDeadlineClock(pickNext: (clock: number) => number | null): number {
  const [clock, setClock] = useState(Date.now);
  const nextAt = pickNext(clock);

  useEffect(() => {
    if (nextAt === null) return;
    let timer = 0;
    const arm = () => {
      // `+ 1` nudges the wake-up strictly PAST the boundary: firing at exactly `nextAt` can leave a
      // `deadline > now` comparison still true (and, for a deadline reached in the same tick, arm a
      // zero-delay timer that re-renders without any state change).
      timer = window.setTimeout(
        () => {
          if (Date.now() <= nextAt) {
            arm(); // clamped (or an early-firing timer): the deadline is still ahead, wait out the rest
            return;
          }
          setClock(Date.now());
        },
        Math.min(nextAt - Date.now() + 1, MAX_TIMEOUT_DELAY),
      );
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [nextAt]);

  return clock;
}

import { useEffect, useState } from "react";

// Clamp distant deadlines because browser timeout delays above the signed 32-bit
// ceiling overflow into immediate callbacks. A clamped wake must re-arm without
// claiming the deadline has passed.
const MAX_TIMEOUT_DELAY = 2_147_483_647;

interface DeadlineClockInput {
  pickNextDeadline: (clock: number) => number | null;
  readNow: () => number;
}

/**
 * A clock (ms since epoch) that advances once, just after the next deadline passes.
 *
 * Initially `readNow()` at mount. `pickNextDeadline` is asked, on every render, which deadline matters next
 * given the clock the hook is about to return; while it answers non-null the hook arms a single
 * timeout for that instant, and when the timeout fires the clock is re-read and the component
 * re-renders. Any `now`-derived state is recomputed when the deadline passes, subject to browser
 * timer throttling. Answer `null` when nothing is pending to leave no timer armed.
 *
 * The picker compares deadlines with this clock. Using a fresh wall-clock reading could exclude a
 * deadline before this state reaches it, leaving the component without the render that marks it due.
 *
 * `pickNextDeadline` does not need to be stable, and inline arrows are the expected call shape: the effect
 * depends on the picked instant, not on the function, so a new closure every render arms nothing new.
 * It must be pure. It runs during render, possibly more than once.
 *
 * A clamped wake checks the deadline and re-arms inside the callback when time remains. Advancing
 * the clock early would leave `nextAt` unchanged, so the effect would not run again to arm the next interval.
 *
 * Background tabs may throttle timers, so a deadline can be observed late after the tab resumes.
 *
 * @param input.pickNextDeadline - given the current clock, the next deadline as ms since epoch, or `null` if none.
 * @param input.readNow - reads the current time as ms since epoch.
 * @returns the current clock value; re-read (causing a re-render) just after that deadline passes.
 */
export function useDeadlineClock({ pickNextDeadline, readNow }: DeadlineClockInput): number {
  const [clock, setClock] = useState(readNow);
  const nextAt = pickNextDeadline(clock);

  useEffect(() => {
    if (nextAt === null) return;
    let timer = 0;
    const arm = () => {
      // Wake strictly after the boundary because expiration consumers and the re-arm guard require
      // the clock to be greater than nextAt.
      timer = window.setTimeout(
        () => {
          if (readNow() <= nextAt) {
            arm();
            return;
          }
          setClock(readNow());
        },
        Math.min(nextAt - readNow() + 1, MAX_TIMEOUT_DELAY),
      );
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [nextAt, readNow]);

  return clock;
}

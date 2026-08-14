import { useEffect, useState } from "react";
import { todayISO } from "@capacitylens/shared/lib/dateMath";
import type { ISODate } from "@capacitylens/shared/types/entities";

const BOUNDARY_SEARCH_MS = 36 * 60 * 60 * 1000;

/** Milliseconds until the configured calendar zone first reports a different date. The binary
 * search naturally handles 23/25-hour daylight-saving days and non-hour timezone offsets.
 * Every probe goes through the SAME zone resolver the rendered date does (`todayISO`, which
 * caches one formatter per zone), so the timer can never land on a boundary the displayed date
 * disagrees with — and a bad stored zone degrades to todayISO's LOCAL date, making this measure
 * the next LOCAL midnight instead of crashing or arming a runaway timer. */
export function millisecondsUntilNextCalendarDate(timeZone: string, now = Date.now()): number {
  const dateAt = (instant: number): ISODate => todayISO(timeZone, instant);
  const currentDate = dateAt(now);
  let lower = now;
  let upper = now + BOUNDARY_SEARCH_MS;
  while (upper - lower > 1) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (dateAt(middle) === currentDate) lower = middle;
    else upper = middle;
  }
  return Math.max(1, upper - now);
}

/** Reactive account-local date for long-lived scheduler views. Browser background throttling can
 * delay timers, so visibility and bfcache restoration both force an immediate recomputation. */
export function useCalendarToday(timeZone: string): ISODate {
  const [, setRevision] = useState(0);

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setRevision((revision) => revision + 1);
        schedule();
      }, millisecondsUntilNextCalendarDate(timeZone));
    };
    const refresh = () => {
      setRevision((revision) => revision + 1);
      schedule();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    schedule();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("pageshow", refresh);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("pageshow", refresh);
    };
  }, [timeZone]);

  // Re-evaluate on every forced or incidental render. This also updates synchronously when the
  // active account changes zones, before the replacement effect arms its next boundary timer.
  return todayISO(timeZone);
}

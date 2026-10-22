import { useEffect, useState } from "react";
import { todayISO } from "@capacitylens/shared/lib/today";
import type { ISODate } from "@capacitylens/shared/types/entities";

const BOUNDARY_SEARCH_MS = 36 * 60 * 60 * 1000;

/** Computes the next date boundary through the same timezone resolver used for display, so daylight-saving changes and fallback zones cannot desynchronize the timer. */
export function resolveMillisecondsUntilNextCalendarDate(timeZone: string, now = Date.now()): number {
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
      }, resolveMillisecondsUntilNextCalendarDate(timeZone));
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

  return todayISO(timeZone);
}

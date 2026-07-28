import { useEffect, useState } from "react";
import { todayISO } from "@capacitylens/shared/lib/dateMath";
import type { ISODate } from "@capacitylens/shared/types/entities";

const BOUNDARY_SEARCH_MS = 36 * 60 * 60 * 1000;

function dateFormatter(timeZone: string): (instant: number) => ISODate {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (instant) => {
    const parts = formatter.formatToParts(new Date(instant));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}` as ISODate;
  };
}

/** Milliseconds until the configured calendar zone first reports a different date. The binary
 * search naturally handles 23/25-hour daylight-saving days and non-hour timezone offsets. */
export function millisecondsUntilNextCalendarDate(timeZone: string, now = Date.now()): number {
  let dateAt: (instant: number) => ISODate;
  try {
    dateAt = dateFormatter(timeZone);
  } catch {
    // todayISO owns the invalid-zone warning and local fallback. Mirror only its scheduling
    // fallback here so one bad stored zone does not crash or arm a runaway timer.
    const nextLocalMidnight = new Date(now);
    nextLocalMidnight.setHours(24, 0, 0, 0);
    return Math.max(1, nextLocalMidnight.getTime() - now);
  }

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

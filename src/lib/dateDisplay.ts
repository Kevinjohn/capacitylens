import { format } from "date-fns";
import { daysInclusive, parseDate } from "@capacitylens/shared/lib/dateMath";
import type { ISODate } from "@capacitylens/shared/types/entities";
import { activeDateLocale, m } from "@/i18n";

// Human-readable date presentation for at-a-glance lists (e.g. the Time-off list), where a
// reader wants "which days, how long" — not a machine date. Pure display formatting only; the
// scheduler's geometry still works in integer day-indices (shared/lib/dateMath), never these
// strings. `date` arguments are validated `ISODate`s by the time they reach a render — an invalid
// one makes date-fns `format` throw a RangeError, which we deliberately let surface as the
// upstream-validation bug it is (see dateMath's module precondition) rather than wrap-and-swallow.

/**
 * A terse, scannable date: "Wed 10th Jun".
 *
 * Abbreviated weekday + ordinal day + abbreviated month, deliberately **no year** — these read
 * inside a list where the year is unambiguous from context. Short enough that a row reads at a
 * glance ("who · when · how long") instead of as a sentence; the full span isn't shown here (the
 * day count carries "how long"), so this formats a single anchor date — typically the start.
 */
export function formatShortDate(date: ISODate): string {
  return format(parseDate(date), "EEE do MMM", { locale: activeDateLocale() });
}

/**
 * The tersest readable date: "10 Jun".
 *
 * Day + abbreviated month, no weekday and no year — for surfaces where the date is a SECONDARY
 * detail squeezed beside other content (an allocation bar's accessible name and its hover card,
 * which both also carry the label, hours and status). {@link formatShortDate} is the scannable
 * list form; this is the one that has to stay short, so it deliberately drops the weekday and the
 * ordinal suffix rather than reusing that longer shape.
 */
export function formatDayMonth(date: ISODate): string {
  return format(parseDate(date), "d MMM", { locale: activeDateLocale() });
}

/**
 * The inclusive day count as a label: "1 day" / "5 days".
 *
 * Clamped at 0 so a reversed/empty range degrades to "0 days" rather than a negative count — the
 * write boundary (`validateDateRange`) already rejects reversed ranges, so this is purely
 * belt-and-braces for the display path.
 */
export function formatDayCount(start: ISODate, end: ISODate): string {
  const inclusiveDays = daysInclusive(start, end);
  if (!Number.isFinite(inclusiveDays)) throw new RangeError("Invalid time-off date range");
  const n = Math.max(0, inclusiveDays);
  return n === 1 ? m.list_timeoff_days_one({ count: n }) : m.list_timeoff_days_other({ count: n });
}

// ─── Instants ────────────────────────────────────────────────────────────────
// The two above render calendar DAYS (an `ISODate`, no clock, no zone). The two below render an
// INSTANT — a full ISO timestamp from the server (an invite's expiry, a session's creation) — on the
// VIEWER'S OWN wall clock. That conversion is the whole point: the alternative these replaced was a
// `.slice(0, 10)` of the raw UTC string, which misreads by up to a day either side of midnight for
// anyone outside UTC.
//
// WHY `Intl` (toLocale*) here rather than date-fns + `activeDateLocale()` like the day formatters:
// `activeDateLocale()` returns a date-fns `Locale` OBJECT, which is not a BCP-47 tag and cannot be
// handed to `Intl`. Resolving one would mean introducing a second locale mapping, and the mapping
// available today ('en' → enGB) does NOT agree with the browser default these call sites already
// ship (en-GB day/month vs. an en-US reader's month/day). Behaviour preservation wins this round:
// the locale argument is deliberately omitted, so output is byte-identical to the call sites being
// replaced. When a real second locale lands, both of these gain the tag together with the call
// sites' visual regression check — not before.
//
// An unparseable timestamp yields the platform's "Invalid Date" string rather than throwing, again
// matching the replaced call sites exactly; these render server-supplied values, so a bad one must
// degrade a single row, not blank the section.

/**
 * An instant as local date AND TIME: "14/07/2026, 13:00:00" (browser-default locale).
 *
 * The hour is LOAD-BEARING, not decoration. These are short-lived security artefacts — a
 * password-reset link that lives 24h, a session with an expiry — where a date-only string both
 * misleads by up to a day in a non-UTC zone and hides the hour the thing dies. Use this whenever the
 * reader may need to act before the deadline today.
 *
 * @param iso - an ISO 8601 instant from the server.
 * @returns the instant on the viewer's wall clock, date + time.
 */
export function formatInstant(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * An instant as a local date only: "14/07/2026" (browser-default locale).
 *
 * The counterpart to {@link formatInstant} for deadlines measured in DAYS, not hours — an invite's
 * validity spans several days, so a compact list row stays date-only rather than spending width on a
 * time nobody plans around. Still resolved on the viewer's local calendar (that is the part slicing
 * the UTC string got wrong); only the hour is dropped.
 *
 * @param iso - an ISO 8601 instant from the server.
 * @returns the instant's date on the viewer's local calendar, no time.
 */
export function formatInstantDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

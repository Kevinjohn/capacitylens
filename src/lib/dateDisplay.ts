import { format } from "date-fns";
import { daysInclusive, parseDate } from "@capacitylens/shared/lib/dateMath";
import type { ISODate } from "@capacitylens/shared/types/entities";
import { readActiveDateLocale, m } from "@/i18n";
import { readActiveDateStyle, type DateStyle } from "./dateStyle";

// Human-readable date presentation for at-a-glance lists (e.g. the Time-off list), where a
// reader wants "which days, how long" — not a machine date. Pure display formatting only; the
// scheduler's geometry still works in integer day-indices (shared/lib/dateMath), never these
// strings. `date` arguments are validated `ISODate`s by the time they reach a render — an invalid
// one makes date-fns `format` throw a RangeError, which we deliberately let surface as the
// upstream-validation bug it is (see dateMath's module precondition) rather than wrap-and-swallow.
//
// DATE STYLE: this module is the only place that builds a month- or year-bearing (style-sensitive)
// date-fns pattern; call sites never see a pattern, only these helpers. The active style — read
// fresh on every call via `readActiveDateStyle()` (src/lib/dateStyle.ts), never cached — resolves
// to a `DateStyleDescriptor` below: `monthFirst` sets day/month order, `ordinal` sets whether the
// day number carries a date-fns `do` suffix. The weekday form (`formatShortDate`/
// `formatShortDateRange`) is the one exception: it always carries the ordinal regardless of style,
// because a terse list row without it reads ambiguously ("Fri 5 Jun" vs "Fri 5th Jun"); the style
// only reorders it. Two more calls stay off the descriptor entirely because they carry no month:
// `DateHeader.tsx`'s day number ("d") and weekday abbreviation ("EEE").
//
// COLLAPSE RULE for ranges: a same-day range renders as one full single date. A same-month range
// shows the month once, at the position the style would normally put it (trailing for a day-first
// style, leading for a month-first style). A same-year range shows the year once, at the very end.
// A range crossing a year boundary collapses nothing: every endpoint carries day, month and year —
// in `formatShortDateRange` and `formatDayMonthRange` too, the two that otherwise never print a
// year, because without it a range from one September to the next reads as a single day. The range
// separator is always ` – ` (U+2013 EN DASH), never a hyphen.
//
// COLLAPSE IN ACCESSIBLE NAMES: a name that labels a control sitting beside a visible date range
// uses the same collapsed string that range shows, so a voice-control user can speak what is on
// screen (see `CompanyClosureSection.tsx`). A name that is the only place a date appears states
// both endpoints in full instead, because there is no visible text for it to agree with and the
// two dates are separately meaningful — `AllocationBar.tsx`'s bar names, read while the bar is
// being dragged or resized, are the case this rule exists for.
//
// LOCALE: all of the above take the date-fns locale from `readActiveDateLocale()`
// (`src/i18n/index.ts:34`, `en → enGB`). Style is independent of locale today (no `en`/`enGB`
// literal lives outside `src/i18n`); a locale-driven style default is future work, with its
// insertion point marked in `dateStyle.ts`.

interface DateStyleDescriptor {
  /** Day-then-month ("9 Sep") when false, month-then-day ("Sep 9") when true. */
  monthFirst: boolean;
  /** Whether the day number carries a `do`-token ordinal suffix ("9th" vs "9"). */
  ordinal: boolean;
}

const DATE_STYLE_DESCRIPTORS: Record<DateStyle, DateStyleDescriptor> = {
  "day-month": { monthFirst: false, ordinal: false },
  "day-ordinal-month": { monthFirst: false, ordinal: true },
  "month-day": { monthFirst: true, ordinal: false },
  "month-day-ordinal": { monthFirst: true, ordinal: true },
};

function resolveDescriptor(): DateStyleDescriptor {
  return DATE_STYLE_DESCRIPTORS[readActiveDateStyle()];
}

/** The date-fns day token: `do` (ordinal, "9th") or `d` (plain, "9"). */
/**
 * What a rendered date spells out, before the active style decides the order. `ordinal` is separate
 * from `weekday` because the two weekday forms disagree: the terse list form keeps its ordinal in
 * every style, while the full one drops it (it already carries weekday, month and year).
 */
interface DateParts {
  weekday: boolean;
  ordinal: boolean;
  year: boolean;
}

/** The date-fns pattern for one endpoint. `month: false` drops the month a range shows elsewhere. */
function buildPattern(descriptor: DateStyleDescriptor, parts: DateParts, month = true): string {
  const weekday = parts.weekday ? "EEE " : "";
  const day = parts.ordinal ? "do" : "d";
  if (!month) return `${weekday}${day}`;
  const core = descriptor.monthFirst ? `${weekday}MMM ${day}` : `${weekday}${day} MMM`;
  if (!parts.year) return core;
  // A month-first style needs the comma an English reader expects before a trailing year.
  return descriptor.monthFirst ? `${core}, yyyy` : `${core} yyyy`;
}

function formatSingle(date: ISODate, parts: DateParts): string {
  const descriptor = resolveDescriptor();
  return format(parseDate(date), buildPattern(descriptor, parts), { locale: readActiveDateLocale() });
}

/**
 * The module's collapse rule, once, for all three range helpers — they differ only in which parts
 * an endpoint spells out. A same-day range degrades to the single-date form; a range crossing a
 * year prints every part at both ends; inside a year the month appears once when both ends share
 * it, and the year (when the helper carries one) always trails the range rather than each endpoint.
 */
function formatRange(startDate: ISODate, endDate: ISODate, parts: DateParts): string {
  if (startDate === endDate) return formatSingle(startDate, parts);
  const descriptor = resolveDescriptor();
  const locale = readActiveDateLocale();
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const render = (date: Date, pattern: string) => format(date, pattern, { locale });

  if (start.getFullYear() !== end.getFullYear()) {
    const full = buildPattern(descriptor, { ...parts, year: true });
    return `${render(start, full)} – ${render(end, full)}`;
  }

  // Inside one year the year is stated once, after the whole range — so the leading endpoint never
  // carries it. The month collapses the same way: it reads once, at the end the style would have
  // put it (leading for a month-first style, trailing otherwise).
  const sameMonth = start.getMonth() === end.getMonth();
  const leading = { ...parts, year: false };
  const startPattern = buildPattern(descriptor, leading, !(sameMonth && !descriptor.monthFirst));
  const endCarriesMonth = !(sameMonth && descriptor.monthFirst);
  const endPattern = buildPattern(descriptor, endCarriesMonth ? parts : leading, endCarriesMonth);
  const rendered = `${render(start, startPattern)} – ${render(end, endPattern)}`;

  // A collapsed month-first end ("Sep 9 – 14") has no month left to hang the year on, so the year
  // joins the range itself rather than an endpoint.
  if (parts.year && !endCarriesMonth) return `${rendered}, ${render(end, "yyyy")}`;
  return rendered;
}

/**
 * A terse, scannable date: "Wed 10th Jun" (or "Wed Jun 10th" under a month-first style).
 *
 * Abbreviated weekday + ordinal day + abbreviated month, deliberately **no year** — these read
 * inside a list where the year is unambiguous from context. Short enough that a row reads at a
 * glance ("who · when · how long") instead of as a sentence. The ordinal always shows here
 * regardless of style; only day/month order follows the style.
 */
const SHORT_PARTS: DateParts = { weekday: true, ordinal: true, year: false };

export function formatShortDate(date: ISODate): string {
  return formatSingle(date, SHORT_PARTS);
}

/**
 * A short weekday-anchored range: "Fri 5th – Mon 8th Jun", collapsing a repeated month per the
 * module's collapse rule. Crossing months shows the month at both endpoints ("Fri 5th Jun – Mon
 * 8th Jul"); crossing a year shows the year too. A same-day range degrades to
 * {@link formatShortDate}.
 */
export function formatShortDateRange(startDate: ISODate, endDate: ISODate): string {
  return formatRange(startDate, endDate, SHORT_PARTS);
}

/**
 * The tersest readable date: "10 Jun" (or "Jun 10" / "10th Jun" / "Jun 10th" under other styles).
 *
 * Day + abbreviated month, no weekday and no year — for surfaces where the date is a SECONDARY
 * detail squeezed beside other content (an allocation bar's accessible name and its hover card,
 * which both also carry the label, hours and status). {@link formatShortDate} is the scannable
 * list form; this is the one that has to stay short, so it deliberately drops the weekday rather
 * than reusing that longer shape. Day/month order and ordinal both follow the active style.
 */
function dayMonthParts(): DateParts {
  return { weekday: false, ordinal: resolveDescriptor().ordinal, year: false };
}

export function formatDayMonth(date: ISODate): string {
  return formatSingle(date, dayMonthParts());
}

/**
 * The day+month range counterpart to {@link formatDayMonth}: "9 – 14 Sep" for a same-month range,
 * "9 Sep – 14 Oct" crossing months, and both years spelled out when the range crosses one. A
 * same-day range degrades to {@link formatDayMonth}.
 */
export function formatDayMonthRange(startDate: ISODate, endDate: ISODate): string {
  return formatRange(startDate, endDate, dayMonthParts());
}

/** A standalone calendar date with an explicit year for schedule details: "9 Sep 2026". */
function scheduleParts(): DateParts {
  return { weekday: false, ordinal: resolveDescriptor().ordinal, year: true };
}

export function formatScheduleDate(date: ISODate): string {
  return formatSingle(date, scheduleParts());
}

/**
 * An unambiguous schedule range. A same-month range collapses the month to a single mention; a
 * same-year range carries the year once, while a range crossing a year boundary carries a full
 * date at both endpoints. A one-day range is rendered as one full date.
 */
export function formatScheduleDateRange(startDate: ISODate, endDate: ISODate): string {
  return formatRange(startDate, endDate, scheduleParts());
}

/** A month and year with no day, no style: "Sep 2026". Used for calendar-header-style context. */
export function formatMonthYear(date: ISODate): string {
  return format(parseDate(date), "MMM yyyy", { locale: readActiveDateLocale() });
}

/**
 * A full weekday-anchored schedule date: "Wed 9 Sep 2026" (or "Wed Sep 9, 2026" under a
 * month-first style). Day/month order follows the active style; unlike {@link formatShortDate}
 * this never carries an ordinal — it already spells out weekday, month and year, so the ordinal
 * suffix is redundant precision rather than the disambiguation it provides in the terser form.
 */
export function formatWeekdayScheduleDate(date: ISODate): string {
  return formatSingle(date, { weekday: true, ordinal: false, year: true });
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
  const dayCount = Math.max(0, inclusiveDays);
  return dayCount === 1 ? m.list_timeoff_days_one({ count: dayCount }) : m.list_timeoff_days_other({ count: dayCount });
}

// ─── Instants ────────────────────────────────────────────────────────────────
// The two above render calendar DAYS (an `ISODate`, no clock, no zone). The two below render an
// INSTANT — a full ISO timestamp from the server (an invite's expiry, a session's creation) — on the
// VIEWER'S OWN wall clock. That conversion is the whole point: the alternative these replaced was a
// `.slice(0, 10)` of the raw UTC string, which misreads by up to a day either side of midnight for
// anyone outside UTC.
//
// WHY `Intl` (toLocale*) here rather than date-fns + `readActiveDateLocale()` like the day formatters:
// `readActiveDateLocale()` returns a date-fns `Locale` OBJECT, which is not a BCP-47 tag and cannot be
// handed to `Intl`. Resolving one would mean introducing a second locale mapping, and the mapping
// available today ('en' → enGB) does NOT agree with the browser default these call sites already
// ship (en-GB day/month vs. an en-US reader's month/day). Behaviour preservation wins this round:
// the locale argument is deliberately omitted, so output is byte-identical to the call sites being
// replaced. When a real second locale lands, both of these gain the tag together with the call
// sites' visual regression check — not before. The date-style preference doesn't apply here either:
// these are machine timestamps rendered via `Intl`, not the day/month-yyyy calendar dates above.
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

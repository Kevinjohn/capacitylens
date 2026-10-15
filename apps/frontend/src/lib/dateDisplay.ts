import { format } from "date-fns";
import { daysInclusive, parseDate } from "@capacitylens/shared/lib/dateMath";
import { readActiveDateLocale, m } from "@/i18n";
import { DATE_STYLES, DEFAULT_DATE_STYLE } from "@capacitylens/shared/types/entities";
import type { DateStyle, ISODate } from "@capacitylens/shared/types/entities";

// Pure presentation formatting keeps human date strings separate from scheduler geometry.
// Valid ISO dates are a caller precondition, so formatting errors propagate as validation faults.
// Company date style is mirrored for render-time formatting; locale comes from the i18n seam.
// Preserve year context across year boundaries and keep accessible endpoints complete when
// there is no visible range to establish context.

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

// Mirror date style before notifying subscribers so synchronous formatters agree
// with the account snapshot. Consumers still need the style in memo dependencies
// because changing the mirror alone cannot trigger a render.
let activeDateStyle: DateStyle = DEFAULT_DATE_STYLE;

/** Sets the validated date style used by synchronous formatters. */
export function setActiveDateStyle(style: DateStyle): void {
  // Treat unknown styles as the default so legacy or hand-edited rows cannot break
  // date rendering. Import sanitisation removes unsupported styles.
  activeDateStyle = DATE_STYLES.includes(style) ? style : DEFAULT_DATE_STYLE;
}

/** Reads the active date style used by synchronous formatters. */
export function readActiveDateStyle(): DateStyle {
  return activeDateStyle;
}

function resolveDescriptor(): DateStyleDescriptor {
  return DATE_STYLE_DESCRIPTORS[activeDateStyle];
}

// Keep ordinal choice separate from weekday display because terse and full date forms use different conventions.
interface DateParts {
  weekday: boolean;
  ordinal: boolean;
  month: boolean;
  year: boolean;
}

function buildPattern(descriptor: DateStyleDescriptor, parts: DateParts): string {
  const weekday = parts.weekday ? "EEE " : "";
  const day = parts.ordinal ? "do" : "d";
  if (!parts.month) return `${weekday}${day}`;
  const core = descriptor.monthFirst ? `${weekday}MMM ${day}` : `${weekday}${day} MMM`;
  if (!parts.year) return core;
  // A month-first style needs the comma an English reader expects before a trailing year.
  return descriptor.monthFirst ? `${core}, yyyy` : `${core} yyyy`;
}

// Resolve date style once per format so the endpoints cannot disagree if the mirror changes.
type PartsFor = (descriptor: DateStyleDescriptor) => DateParts;

interface RangeOptions {
  /** Used only by the ordered week-column header, where adjacent cells establish calendar context. */
  collapseYearBoundary?: boolean;
}

interface RangeInput {
  startDate: ISODate;
  endDate: ISODate;
  partsFor: PartsFor;
  options?: RangeOptions;
}

function formatSingle(date: ISODate, partsFor: PartsFor): string {
  const descriptor = resolveDescriptor();
  return format(parseDate(date), buildPattern(descriptor, partsFor(descriptor)), {
    locale: readActiveDateLocale(),
  });
}

// Collapse repeated month and year context within a range, but preserve both years
// across a year boundary so the duration remains unambiguous.
function formatRange({ startDate, endDate, partsFor, options = {} }: RangeInput): string {
  if (startDate === endDate) return formatSingle(startDate, partsFor);
  const descriptor = resolveDescriptor();
  const parts = partsFor(descriptor);
  const locale = readActiveDateLocale();
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const render = (date: Date, pattern: string) => format(date, pattern, { locale });

  if (start.getFullYear() !== end.getFullYear() && !options.collapseYearBoundary) {
    const full = buildPattern(descriptor, { ...parts, year: true });
    return `${render(start, full)} – ${render(end, full)}`;
  }

  // Inside one year the year is stated once, after the whole range, so the leading endpoint never
  // carries it. The month collapses the same way: it reads once, at the end the style would have
  // put it (leading for a month-first style, trailing otherwise).
  const sameMonth = start.getMonth() === end.getMonth();
  const leading = { ...parts, year: false };
  const startPattern = buildPattern(descriptor, { ...leading, month: !(sameMonth && !descriptor.monthFirst) });
  const endCarriesMonth = !(sameMonth && descriptor.monthFirst);
  const endPattern = buildPattern(descriptor, { ...(endCarriesMonth ? parts : leading), month: endCarriesMonth });
  const rendered = `${render(start, startPattern)} – ${render(end, endPattern)}`;

  // A collapsed month-first end ("Sep 9 – 14") has no month left to hang the year on, so the year
  // joins the range itself rather than an endpoint.
  if (parts.year && !endCarriesMonth) return `${rendered}, ${render(end, "yyyy")}`;
  return rendered;
}

const shortParts = (): DateParts => ({ weekday: true, ordinal: true, month: true, year: false });

/**
 * A terse, scannable date: "Wed 10th Jun" (or "Wed Jun 10th" under a month-first style).
 *
 * Abbreviated weekday + ordinal day + abbreviated month, deliberately **no year**. These read
 * inside a list where the year is unambiguous from context. Short enough that a row reads at a
 * glance ("who · when · how long") instead of as a sentence. The ordinal always shows here
 * regardless of style; only day/month order follows the style.
 */
export function formatShortDate(date: ISODate): string {
  return formatSingle(date, shortParts);
}

/**
 * A short weekday-anchored range: "Fri 5th – Mon 8th Jun", collapsing a repeated month per the
 * module's collapse rule. Crossing months shows the month at both endpoints ("Fri 5th Jun – Mon
 * 8th Jul"); crossing a year shows the year too. A same-day range degrades to
 * {@link formatShortDate}.
 */
export function formatShortDateRange(startDate: ISODate, endDate: ISODate): string {
  return formatRange({ startDate, endDate, partsFor: shortParts });
}

const dayMonthParts = (descriptor: DateStyleDescriptor): DateParts => ({
  weekday: false,
  ordinal: descriptor.ordinal,
  month: true,
  year: false,
});

/** Formats day and abbreviated month without weekday or year. Active style controls
 * their order and whether the day has an ordinal. Standalone range endpoints should
 * use formatDayMonthEndpoint to retain cross-year context.
 */
export function formatDayMonth(date: ISODate): string {
  return formatSingle(date, dayMonthParts);
}

/**
 * The day+month range counterpart to {@link formatDayMonth}: "9 – 14 Sep" for a same-month range,
 * "9 Sep – 14 Oct" crossing months, and both years spelled out when the range crosses one. A
 * same-day range degrades to {@link formatDayMonth}.
 */
export function formatDayMonthRange(startDate: ISODate, endDate: ISODate): string {
  return formatRange({ startDate, endDate, partsFor: dayMonthParts });
}

/**
 * A week-column header in an ordered run of consecutive weeks: the same range as
 * {@link formatDayMonthRange}, minus the year across a year boundary. The neighbouring columns
 * establish the ordered calendar context, and the cell is too narrow to spend two lines on it. Do
 * not use this anywhere a range stands alone. That is what the year exists for.
 */
export function formatWeekColumnRange(startDate: ISODate, endDate: ISODate): string {
  return formatRange({
    startDate,
    endDate,
    partsFor: dayMonthParts,
    options: { collapseYearBoundary: true },
  });
}

/**
 * One endpoint of a range, stated in full rather than collapsed against the other: the
 * accessible-name case (collapse in accessible names above) where a screen reader meets the two
 * dates as separate words, and the "series through …" line, whose counterpart is the bar's own end.
 *
 * `counterpart` is the date this one is implicitly read against. When the two fall in different
 * years the year is spelled out, without it "28 Dec to 8 Jan" reads as a range running backwards
 * through the year rather than the twelve days it is. Inside one year the output is exactly
 * {@link formatDayMonth}.
 */
export function formatDayMonthEndpoint(date: ISODate, counterpart: ISODate): string {
  return formatSingle(date, (descriptor) => ({ ...dayMonthParts(descriptor), year: crossesYear(date, counterpart) }));
}

/** The {@link formatShortDate} counterpart to {@link formatDayMonthEndpoint}: weekday, and the year only across one. */
export function formatShortDateEndpoint(date: ISODate, counterpart: ISODate): string {
  return formatSingle(date, () => ({ ...shortParts(), year: crossesYear(date, counterpart) }));
}

function crossesYear(date: ISODate, counterpart: ISODate): boolean {
  const counterpartYear = parseDate(counterpart).getFullYear();
  // `date` itself reaches date-fns `format`, which surfaces an invalid one as a RangeError. The
  // counterpart never does, so an unvalidated one would silently decide "different year" through a
  // NaN comparison and print a year nobody asked for, the same upstream bug, made invisible.
  if (!Number.isFinite(counterpartYear)) throw new RangeError(`Invalid counterpart date: ${counterpart}`);
  return parseDate(date).getFullYear() !== counterpartYear;
}

const scheduleParts = (descriptor: DateStyleDescriptor): DateParts => ({
  weekday: false,
  ordinal: descriptor.ordinal,
  month: true,
  year: true,
});

/** A standalone calendar date with an explicit year for schedule details: "9 Sep 2026". */
export function formatScheduleDate(date: ISODate): string {
  return formatSingle(date, scheduleParts);
}

/**
 * An unambiguous schedule range. A same-month range collapses the month to a single mention; a
 * same-year range carries the year once, while a range crossing a year boundary carries a full
 * date at both endpoints. A one-day range is rendered as one full date.
 */
export function formatScheduleDateRange(startDate: ISODate, endDate: ISODate): string {
  return formatRange({ startDate, endDate, partsFor: scheduleParts });
}

/** A month and year with no day, no style: "Sep 2026". Used for calendar-header-style context. */
export function formatMonthYear(date: ISODate): string {
  return format(parseDate(date), "MMM yyyy", { locale: readActiveDateLocale() });
}

/**
 * A full weekday-anchored schedule date: "Wed 9 Sep 2026" (or "Wed Sep 9, 2026" under a
 * month-first style). Day/month order follows the active style; unlike {@link formatShortDate}
 * this never carries an ordinal. It already spells out weekday, month and year, so the ordinal
 * suffix is redundant precision rather than the disambiguation it provides in the terser form.
 */
export function formatWeekdayScheduleDate(date: ISODate): string {
  return formatSingle(date, () => ({ weekday: true, ordinal: false, month: true, year: true }));
}

/** Formats the inclusive date count, clamped at zero for an empty or reversed range. */
export function formatDayCount(start: ISODate, end: ISODate): string {
  const inclusiveDays = daysInclusive(start, end);
  if (!Number.isFinite(inclusiveDays)) throw new RangeError("Invalid time-off date range");
  const dayCount = Math.max(0, inclusiveDays);
  return dayCount === 1 ? m.list_timeoff_days_one({ count: dayCount }) : m.list_timeoff_days_other({ count: dayCount });
}

// Render server instants on the viewer’s wall clock with the browser’s locale.
// Company calendar date style does not apply to these timestamps. An invalid
// timestamp degrades one row to the platform fallback rather than throwing.

/**
 * An instant as local date and time: "14/07/2026, 13:00:00" (browser-default locale).
 *
 * The hour is load-bearing, not decoration. These are short-lived security artefacts (a
 * password-reset link that lives 24h, a session with an expiry) where a date-only string both
 * misleads by up to a day in a non-UTC zone and hides the hour the thing dies. Use this whenever the
 * reader may need to act before the deadline today.
 *
 * @param instant - an ISO 8601 instant or numeric epoch milliseconds.
 * @returns the instant on the viewer's wall clock, date + time.
 */
export function formatInstant(instant: string | number): string {
  return new Date(instant).toLocaleString();
}

/** Formats a server instant as a date on the viewer’s local calendar using the browser locale. */
export function formatInstantDate(instant: string): string {
  return new Date(instant).toLocaleDateString();
}

import { format } from "date-fns";
import { daysInclusive, parseDate } from "@capacitylens/shared/lib/dateMath";
import { readActiveDateLocale, m } from "@/i18n";
import { DATE_STYLES, DEFAULT_DATE_STYLE, type DateStyle, type ISODate } from "@capacitylens/shared/types/entities";

// Human-readable date presentation for at-a-glance lists (e.g. the Time-off list), where a
// reader wants "which days, how long" — not a machine date. Pure display formatting only; the
// scheduler's geometry still works in integer day-indices (shared/lib/dateMath), never these
// strings. `date` arguments are validated `ISODate`s by the time they reach a render — an invalid
// one makes date-fns `format` throw a RangeError, which we deliberately let surface as the
// upstream-validation bug it is (see dateMath's module precondition) rather than wrap-and-swallow.
//
// DATE STYLE: this module is the only place that builds a month- or year-bearing (style-sensitive)
// date-fns pattern; call sites never see a pattern, only these helpers. The active style is the
// ACCOUNT's `dateStyle` — company data, not a device preference — mirrored into this module by the
// store so a pure formatter can read it mid-render (see the mirror below). It resolves
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
// year, because without it a range from one September to the next reads as a single day. The one
// deliberate exception is `formatWeekColumnRange`, whose dates sit in an ordered run of adjacent
// week columns; neighbouring headers supply the year and the narrow cell must stay compact. The
// range separator is always ` – ` (U+2013 EN DASH), never a hyphen.
//
// COLLAPSE IN ACCESSIBLE NAMES: a name that labels a control sitting beside a visible date range
// uses the same collapsed string that range shows, so a voice-control user can speak what is on
// screen (see `CompanyClosureSection.tsx`). A name that is the only place a date appears states
// both endpoints in full instead, because there is no visible text for it to agree with and the
// two dates are separately meaningful — `AllocationBar.tsx`'s bar names, read while the bar is
// being dragged or resized, are the case this rule exists for. "In full" still includes the year
// across a year boundary, by the collapse rule above: `formatDayMonthEndpoint` and
// `formatShortDateEndpoint` are those uncollapsed endpoints, and they are what such a name calls,
// never the bare single-date helpers.
//
// LOCALE: all of the above take the date-fns locale from `readActiveDateLocale()`
// (`src/i18n/index.ts:34`, `en → enGB`). Style is independent of locale today (no `en`/`enGB`
// literal lives outside `src/i18n`); a locale-driven style default is future work, and its
// insertion point is the account default in `resolveDateStyle` (`src/store/selectors.ts`).

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

/**
 * The active style, mirrored out of the store so these pure formatters can read it synchronously
 * mid-render without becoming hooks. The store pushes every change here inside its own `set`, before
 * React is notified (see `src/store/useStore.ts`), so a render can never read a style the store has
 * already moved past. Outside an account — sign-in, invite acceptance — it holds the default.
 *
 * This is NOT where a format change becomes visible: a component only re-renders because it
 * subscribed to the account, and a `useMemo` that BAKES a formatted string needs the style in its
 * dependencies (see `useDateStyle`). The mirror only guarantees the two agree.
 */
let activeDateStyle: DateStyle = DEFAULT_DATE_STYLE;

export function setActiveDateStyle(style: DateStyle): void {
  // Validated, not trusted. The style is a lookup key in every formatter and the column behind it
  // (`accounts.dateStyle`) is plain nullable TEXT with no CHECK constraint, so a database written by
  // a build that shipped another style — or a hand-edited row — reaches here as a well-typed value
  // that has no descriptor. Reading it as the default keeps every date on screen; the import
  // sanitiser is what rejects it at the boundary.
  activeDateStyle = DATE_STYLES.includes(style) ? style : DEFAULT_DATE_STYLE;
}

export function readActiveDateStyle(): DateStyle {
  return activeDateStyle;
}

function resolveDescriptor(): DateStyleDescriptor {
  return DATE_STYLE_DESCRIPTORS[activeDateStyle];
}

/**
 * What a rendered date spells out, before the active style decides the order. `ordinal` is separate
 * from `weekday` because the two weekday forms disagree: the terse list form keeps its ordinal in
 * every style, while the full one drops it (it already carries weekday, month and year). `month` is
 * false only for the endpoint of a range that shows the month at its other end.
 */
interface DateParts {
  weekday: boolean;
  ordinal: boolean;
  month: boolean;
  year: boolean;
}

/** The date-fns pattern for one endpoint. */
function buildPattern(descriptor: DateStyleDescriptor, parts: DateParts): string {
  const weekday = parts.weekday ? "EEE " : "";
  const day = parts.ordinal ? "do" : "d";
  if (!parts.month) return `${weekday}${day}`;
  const core = descriptor.monthFirst ? `${weekday}MMM ${day}` : `${weekday}${day} MMM`;
  if (!parts.year) return core;
  // A month-first style needs the comma an English reader expects before a trailing year.
  return descriptor.monthFirst ? `${core}, yyyy` : `${core} yyyy`;
}

/**
 * Every public helper below formats through `formatSingle`/`formatRange`, which resolve the active
 * style exactly once and hand the descriptor to this, rather than taking finished `DateParts` — so
 * a single format can never read the stored preference twice and disagree with itself mid-string.
 */
type PartsFor = (descriptor: DateStyleDescriptor) => DateParts;

interface RangeOptions {
  /** Used only by the ordered week-column header, where adjacent cells supply the year. */
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

/**
 * The module's collapse rule, once, for all three range helpers — they differ only in which parts
 * an endpoint spells out. A same-day range degrades to the single-date form; a range crossing a
 * year prints every part at both ends; inside a year the month appears once when both ends share
 * it, and the year (when the helper carries one) always trails the range rather than each endpoint.
 */
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

  // Inside one year the year is stated once, after the whole range — so the leading endpoint never
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
 * Abbreviated weekday + ordinal day + abbreviated month, deliberately **no year** — these read
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

/**
 * The tersest readable date: "10 Jun" (or "Jun 10" / "10th Jun" / "Jun 10th" under other styles).
 *
 * Day + abbreviated month, no weekday and no year — for surfaces where the date is a SECONDARY
 * detail squeezed beside other content (an allocation bar's accessible name and its hover card,
 * which both also carry the label, hours and status). {@link formatShortDate} is the scannable
 * list form; this is the one that has to stay short, so it deliberately drops the weekday rather
 * than reusing that longer shape. Day/month order and ordinal both follow the active style.
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
 * supply the year, and the cell is too narrow to spend two lines on it. Do NOT use this anywhere
 * a range stands alone — that is what the year exists for.
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
 * accessible-name case (COLLAPSE IN ACCESSIBLE NAMES above) where a screen reader meets the two
 * dates as separate words, and the "series through …" line, whose counterpart is the bar's own end.
 *
 * `counterpart` is the date this one is implicitly read against. When the two fall in different
 * years the year is spelled out — without it "28 Dec to 8 Jan" reads as a range running backwards
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
  // NaN comparison and print a year nobody asked for — the same upstream bug, made invisible.
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
 * this never carries an ordinal — it already spells out weekday, month and year, so the ordinal
 * suffix is redundant precision rather than the disambiguation it provides in the terser form.
 */
export function formatWeekdayScheduleDate(date: ISODate): string {
  return formatSingle(date, () => ({ weekday: true, ordinal: false, month: true, year: true }));
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

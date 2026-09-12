// Date-style preference. Device-global (one choice per browser), stored separately from account
// data — same contract as theme.ts (see that module's header and DECISIONS.md). This module is the
// pure read/write resolver; formatters in dateDisplay.ts are the only consumers of the read side.
//
// Model: four fixed styles, each an (order, ordinal) pair — see dateDisplay.ts's DateStyleDescriptor
// for how a style becomes a date-fns pattern. No locale input yet: the active Paraglide locale
// (src/i18n) is unconsulted here on purpose — a locale-driven default is a later change; the
// insertion point is marked below.
import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";

/**
 * Every supported style, in the order they appear in the Settings control. This list is the source
 * the {@link DateStyle} union is derived from, so a style cannot exist in the type while being
 * missing here — which would have left it out of the control and rejected by the read validation
 * below, with nothing failing to say so. The two `Record<DateStyle, …>` tables that turn a style
 * into a pattern (dateDisplay.ts) and a label (settingsLabels.ts) then fail to compile until they
 * cover the new entry.
 */
export const DATE_STYLES = ["day-month", "day-ordinal-month", "month-day", "month-day-ordinal"] as const;

export type DateStyle = (typeof DATE_STYLES)[number];

export const DEFAULT_DATE_STYLE: DateStyle = "day-month";

const STORAGE_KEY = `${STORAGE_KEY_PREFIX}dateStyle`;

const isDateStyle = (value: unknown): value is DateStyle => DATE_STYLES.includes(value as DateStyle);

/**
 * The choice made this session when storage refused to keep it. Storage is the preference's home,
 * and a successful write clears this back to null, so a value here is never a cache of a stored
 * one: it exists only for the browser (private mode, full quota, blocked site data) where the
 * write threw. Without it the Settings control would move while every formatter kept reading the
 * default, showing the user a choice the app never applied.
 */
let unstoredDateStyle: DateStyle | null = null;

/**
 * Read the active date-style preference. Reads storage fresh on every call — no module-level cache
 * of a stored value — so a write from another tab or a test's `writeStoredDateStyle` is picked up
 * immediately. Falls back to the choice this session could not persist, then to
 * {@link DEFAULT_DATE_STYLE} when nothing is stored, the stored value is invalid, or storage is
 * unavailable.
 *
 * (Locale-driven default insertion point: when a second locale ships, resolve its default style
 * here — after the storage check, before the DEFAULT_DATE_STYLE fallback — rather than in callers.)
 */
export function readActiveDateStyle(): DateStyle {
  // A choice storage refused outranks whatever is stored: a successful write clears it, so a value
  // here was made after the stored one. Reading storage first would let an older persisted style
  // shadow the choice the user just made on a device whose storage is readable but full.
  if (unstoredDateStyle) return unstoredDateStyle;
  let current: string | null = null;
  try {
    current = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode / quota): nothing stored to read.
  }
  return isDateStyle(current) ? current : DEFAULT_DATE_STYLE;
}

/**
 * Persist the preference. When storage refuses it, the choice still holds for this session through
 * {@link readActiveDateStyle} — the formatters read the resolver, not the store, so a swallowed
 * write with no fallback would leave the Settings control contradicting every date on screen.
 */
export function writeStoredDateStyle(style: DateStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, style);
    unstoredDateStyle = null;
  } catch {
    unstoredDateStyle = style;
  }
}

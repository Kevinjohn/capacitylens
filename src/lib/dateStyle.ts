// Date-style preference. Device-global (one choice per browser), stored separately from account
// data — same contract as theme.ts (see that module's header and DECISIONS.md). This module is the
// pure read/write resolver; formatters in dateDisplay.ts are the only consumers of the read side.
//
// Model: four fixed styles, each an (order, ordinal) pair — see dateDisplay.ts's DateStyleDescriptor
// for how a style becomes a date-fns pattern. No locale input yet: the active Paraglide locale
// (src/i18n) is unconsulted here on purpose — a locale-driven default is a later change; the
// insertion point is marked below.
import { STORAGE_KEY_PREFIX } from "@capacitylens/shared/brand";

export type DateStyle = "day-month" | "day-ordinal-month" | "month-day" | "month-day-ordinal";

/** Every supported style, in the order they appear in the Settings control and the plan's table. */
export const DATE_STYLES: readonly DateStyle[] = ["day-month", "day-ordinal-month", "month-day", "month-day-ordinal"];

export const DEFAULT_DATE_STYLE: DateStyle = "day-month";

const STORAGE_KEY = `${STORAGE_KEY_PREFIX}dateStyle`;

const isDateStyle = (value: unknown): value is DateStyle => DATE_STYLES.includes(value as DateStyle);

/**
 * Read the saved date-style preference. Reads storage fresh on every call — no module-level
 * cache — so a write from another tab or a test's `writeStoredDateStyle` is picked up immediately.
 * Falls back to {@link DEFAULT_DATE_STYLE} when nothing is stored, the stored value is invalid, or
 * storage is unavailable.
 *
 * (Locale-driven default insertion point: when a second locale ships, resolve its default style
 * here — after the storage check, before the DEFAULT_DATE_STYLE fallback — rather than in callers.)
 */
export function readActiveDateStyle(): DateStyle {
  let current: string | null;
  try {
    current = localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage blocked (private mode / quota) — fall through to the default
    return DEFAULT_DATE_STYLE;
  }
  return isDateStyle(current) ? current : DEFAULT_DATE_STYLE;
}

/** Persist the preference. Best-effort: if storage is unavailable the in-memory
 *  store still honours the choice for this session. */
export function writeStoredDateStyle(style: DateStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // ignore — see readActiveDateStyle
  }
}

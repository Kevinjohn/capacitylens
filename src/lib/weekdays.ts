import { m } from "@/i18n";
import type { Weekday } from "@capacitylens/shared/types/entities";

// The table holds UNCALLED message references (`m.weekday_long_mon`, not `m.weekday_long_mon()`).
// This module is evaluated once at import, and Paraglide resolves the active locale at CALL time —
// storing resolved strings here would freeze every weekday label to the import-time language, which
// can switch without a reload. The lookups below therefore call the reference they find.
// Indexed by the `Weekday` day-of-week number (Sun=0 … Sat=6), so a missing arm fails tsc.
const WEEKDAY_MESSAGES: Record<Weekday, { long: () => string; short: () => string }> = {
  0: { long: m.weekday_long_sun, short: m.weekday_short_sun },
  1: { long: m.weekday_long_mon, short: m.weekday_short_mon },
  2: { long: m.weekday_long_tue, short: m.weekday_short_tue },
  3: { long: m.weekday_long_wed, short: m.weekday_short_wed },
  4: { long: m.weekday_long_thu, short: m.weekday_short_thu },
  5: { long: m.weekday_long_fri, short: m.weekday_short_fri },
  6: { long: m.weekday_long_sat, short: m.weekday_short_sat },
};

/** The localised full label for a weekday (Sun=0 … Sat=6). */
export function weekdayLabel(day: Weekday): string {
  return WEEKDAY_MESSAGES[day].long();
}

/** The localised abbreviated label for a weekday (Sun=0 … Sat=6). */
export function weekdayShortLabel(day: Weekday): string {
  return WEEKDAY_MESSAGES[day].short();
}

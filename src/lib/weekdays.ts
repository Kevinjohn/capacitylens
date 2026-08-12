import { m } from "@/i18n";
import type { Weekday } from "@capacitylens/shared/types/entities";

/** The localised full label for a weekday (Sun=0 … Sat=6). */
export function weekdayLabel(day: Weekday): string {
  switch (day) {
    case 1:
      return m.weekday_long_mon();
    case 2:
      return m.weekday_long_tue();
    case 3:
      return m.weekday_long_wed();
    case 4:
      return m.weekday_long_thu();
    case 5:
      return m.weekday_long_fri();
    case 6:
      return m.weekday_long_sat();
    case 0:
      return m.weekday_long_sun();
  }
}

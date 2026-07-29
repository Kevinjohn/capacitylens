import { daysInclusive } from "@capacitylens/shared/lib/dateMath";
import type { ISODate } from "@capacitylens/shared/types/entities";

export interface RealizedVisibleSpan {
  days: number;
  /** Present only when the realized inclusive range is an exact whole number of weeks. */
  weeks?: number;
}

/** Describe the range actually measured after timeline clamping, not the requested zoom preset. */
export function realizedVisibleSpan(start: ISODate, end: ISODate): RealizedVisibleSpan {
  const days = Math.max(1, daysInclusive(start, end));
  return days % 7 === 0 ? { days, weeks: days / 7 } : { days };
}

import { format } from "date-fns";
import type { ISODate } from "../types/entities";

/**
 * Assert that a date string has the product's supported four-digit ISO year shape.
 * @throws RangeError when the value is outside the supported four-digit ISO year range.
 */
export function assertFourDigitISODate(candidate: string): ISODate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new RangeError("Date falls outside the supported four-digit ISO year range.");
  }
  return candidate;
}

/** Format a Date back to a date-only ISO string within the four-digit product year domain. */
export function toISODate(date: Date): ISODate {
  return assertFourDigitISODate(format(date, "yyyy-MM-dd"));
}

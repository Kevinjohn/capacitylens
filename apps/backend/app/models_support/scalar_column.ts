import { isIsoInstant } from '@capacitylens/shared/account/types';
import { DateTime } from 'luxon';
import { isOneOf } from '@kevinjohn/adonisjs-lucid-checked-columns';

/** Accepts a weekday number, 0 (Sunday) to 6 (Saturday), in a JSON column. */
export const isWeekday = isOneOf([0, 1, 2, 3, 4, 5, 6] as const);

/** Column options for a nullable flag stored as 1 or 0; any other value is refused both ways. */
export function booleanColumn(
  table: string,
  column: string
): {
  prepare: (value: unknown) => boolean | null;
  consume: (value: unknown) => boolean | null;
} {
  const refuse = () => new Error(`Invalid persisted boolean in ${table}.${column}`);
  return {
    // The SQLite driver binds true and false as 1 and 0.
    prepare: (value: unknown) => {
      if (value === null || typeof value === 'boolean') return value;
      throw refuse();
    },
    consume: (value: unknown) => {
      if (value === null) return null;
      if (value === 0 || value === 1) return value === 1;
      throw refuse();
    },
  };
}

/**
 * Column options for an instant stored and serialised as the canonical UTC ISO string
 * (`Date#toISOString()`), so storage and the wire keep the exact string they hold today.
 */
export function timestampColumn(
  table: string,
  column: string
): {
  prepare: (value: unknown) => string | null | undefined;
  consume: (value: unknown) => DateTime | null;
  serialize: (value: unknown) => string | null | undefined;
} {
  const toCanonical = (value: unknown) => {
    if (value === undefined || value === null) return value;
    if (DateTime.isDateTime(value) && value.isValid) return value.toJSDate().toISOString();
    throw new Error(`Invalid timestamp in ${table}.${column}`);
  };
  return {
    prepare: toCanonical,
    consume: (value: unknown) => {
      if (value === null) return null;
      if (!isIsoInstant(value)) {
        throw new Error(`Invalid persisted timestamp in ${table}.${column}`);
      }
      return DateTime.fromMillis(Date.parse(value), { zone: 'utc' });
    },
    serialize: toCanonical,
  };
}

import type { ColumnOptions } from '@adonisjs/lucid/types/model';
import type { ISOTimestamp } from '@capacitylens/shared/types/entities';
import { isIsoInstant } from '@capacitylens/shared/account/types';
import { DateTime } from 'luxon';
import { isOneOf } from '@kevinjohn/adonisjs-lucid-checked-columns';

/** Accepts a weekday number, 0 (Sunday) to 6 (Saturday), in a JSON column. */
export const isWeekday = isOneOf([0, 1, 2, 3, 4, 5, 6] as const);

/** Converts a valid Luxon tombstone to the canonical UTC value stored in SQLite. */
function serializeDeletedAt(value: unknown): ISOTimestamp | null | undefined {
  if (value === undefined || value === null) return value;
  const serialized =
    DateTime.isDateTime(value) && value.isValid
      ? value.toUTC().toISO({ suppressMilliseconds: false })
      : null;
  if (!isIsoInstant(serialized)) {
    throw new Error('Invalid soft-delete timestamp in model persistence.');
  }
  return serialized;
}

/** Hydrates canonical ISO values and the package's native Lucid bulk-builder SQLite format. */
function parseDeletedAt(value: unknown): DateTime | null | undefined {
  if (value === undefined || value === null) return value;
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone: 'utc' });
  if (typeof value !== 'string') throw new Error('Invalid persisted soft-delete timestamp.');
  if (isIsoInstant(value)) {
    const dateTime = DateTime.fromISO(value, { setZone: true });
    if (!dateTime.isValid || dateTime.toUTC().toISO({ suppressMilliseconds: false }) !== value) {
      throw new Error('Invalid persisted soft-delete timestamp.');
    }
    return dateTime;
  }

  // The package's bulk builder writes Lucid's SQLite datetime format without column prepare hooks.
  const dateTime = DateTime.fromSQL(value);
  if (!dateTime.isValid || dateTime.toFormat('yyyy-MM-dd HH:mm:ss') !== value) {
    throw new Error('Invalid persisted soft-delete timestamp.');
  }
  return dateTime;
}

/** Keeps the package's Luxon model property on the existing strict ISO SQLite contract. */
export const deletedAtColumn: Pick<ColumnOptions, 'columnName' | 'prepare' | 'consume'> = {
  columnName: 'deleted_at',
  prepare: serializeDeletedAt,
  consume: parseDeletedAt,
};

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

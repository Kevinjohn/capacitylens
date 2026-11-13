import type { ColumnOptions } from '@adonisjs/lucid/types/model';
import type { ISOTimestamp } from '@capacitylens/shared/types/entities';
import { isIsoInstant } from '@capacitylens/shared/account/types';
import { DateTime } from 'luxon';

/** Converts a valid Luxon tombstone to the canonical UTC value stored in SQLite and sent to the API. */
function canonicalDeletedAt(
  value: unknown,
  boundary: 'persistence' | 'serialization'
): ISOTimestamp | null | undefined {
  if (value === undefined || value === null) return value;
  const serialized =
    DateTime.isDateTime(value) && value.isValid
      ? value.toUTC().toISO({ suppressMilliseconds: false })
      : null;
  if (!isIsoInstant(serialized)) {
    throw new Error(`Invalid soft-delete timestamp in model ${boundary}.`);
  }
  return serialized;
}

/** Hydrates canonical ISO values and the package's native Lucid bulk-builder SQLite format. */
function consumeDeletedAt(value: unknown): DateTime | null | undefined {
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

/** Keeps the package's Luxon model property on the existing strict ISO SQLite and DTO contract. */
export const deletedAtColumn: Pick<
  ColumnOptions,
  'columnName' | 'prepare' | 'consume' | 'serialize'
> = {
  columnName: 'deleted_at',
  prepare: (value: unknown) => canonicalDeletedAt(value, 'persistence'),
  consume: consumeDeletedAt,
  serialize: (value: unknown) => canonicalDeletedAt(value, 'serialization'),
};

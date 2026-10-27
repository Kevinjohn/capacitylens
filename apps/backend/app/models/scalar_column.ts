import type { ColumnOptions } from '@adonisjs/lucid/types/model'
import type { ISODate, ISOTimestamp } from '@capacitylens/shared/types/entities'
import { isIsoInstant } from '@capacitylens/shared/account/types'
import { isValidISODate } from '@capacitylens/shared/lib/integrity'
import { DateTime } from 'luxon'

type ScalarColumnOptions<T extends string> = Pick<ColumnOptions, 'prepare' | 'consume'> & {
  prepare(value: T | null): T | null
  consume(value: unknown): T | null
}

function checkedColumn<T extends string>(
  table: string,
  column: string,
  kind: 'date' | 'timestamp',
  validate: (value: unknown) => value is T
): ScalarColumnOptions<T> {
  const consume = (value: unknown) => {
    if (value === null) return null
    if (!validate(value)) throw new Error(`Invalid persisted ${kind} in ${table}.${column}`)
    return value
  }
  return { prepare: consume, consume }
}

/** Preserves a canonical YYYY-MM-DD value across the SQLite model boundary. */
export const isoDateColumn = (table: string, column: string) =>
  checkedColumn<ISODate>(table, column, 'date', isValidISODate)

/** Preserves a canonical UTC instant with millisecond precision across the SQLite model boundary. */
export const isoTimestampColumn = (table: string, column: string) =>
  checkedColumn<ISOTimestamp>(table, column, 'timestamp', isIsoInstant)

/** Converts a valid Luxon tombstone to the canonical UTC value stored in SQLite. */
function prepareDeletedAt(value: unknown): ISOTimestamp | null | undefined {
  if (value === undefined || value === null) return value
  if (!DateTime.isDateTime(value) || !value.isValid)
    throw new Error('Invalid soft-delete timestamp in model persistence.')
  const serialized = value.toUTC().toISO({ suppressMilliseconds: false })
  if (!isIsoInstant(serialized))
    throw new Error('Invalid soft-delete timestamp in model persistence.')
  return serialized
}

/** Hydrates canonical ISO values and the package's native Lucid bulk-builder SQLite format. */
function consumeDeletedAt(value: unknown): DateTime | null | undefined {
  if (value === undefined || value === null) return value
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone: 'utc' })
  if (typeof value !== 'string') throw new Error('Invalid persisted soft-delete timestamp.')
  if (isIsoInstant(value)) {
    const dateTime = DateTime.fromISO(value, { setZone: true })
    if (!dateTime.isValid || dateTime.toUTC().toISO({ suppressMilliseconds: false }) !== value)
      throw new Error('Invalid persisted soft-delete timestamp.')
    return dateTime
  }

  // The package's bulk builder writes Lucid's SQLite datetime format without column prepare hooks.
  const dateTime = DateTime.fromSQL(value)
  if (!dateTime.isValid || dateTime.toFormat('yyyy-MM-dd HH:mm:ss') !== value)
    throw new Error('Invalid persisted soft-delete timestamp.')
  return dateTime
}

/** Serializes package-owned Luxon tombstones to the API's canonical UTC timestamp string. */
function serializeDeletedAt(value: unknown): ISOTimestamp | null | undefined {
  if (value === undefined || value === null) return value
  if (!DateTime.isDateTime(value) || !value.isValid)
    throw new Error('Invalid soft-delete timestamp in model serialization.')
  const serialized = value.toUTC().toISO({ suppressMilliseconds: false })
  if (!isIsoInstant(serialized))
    throw new Error('Invalid soft-delete timestamp in model serialization.')
  return serialized
}

/** Keeps the package's Luxon model property on the existing strict ISO SQLite and DTO contract. */
export const deletedAtColumn: Pick<
  ColumnOptions,
  'columnName' | 'prepare' | 'consume' | 'serialize'
> = {
  columnName: 'deleted_at',
  prepare: prepareDeletedAt,
  consume: consumeDeletedAt,
  serialize: serializeDeletedAt,
}

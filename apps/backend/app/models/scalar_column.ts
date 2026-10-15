import type { ColumnOptions } from '@adonisjs/lucid/types/model'
import type { ISODate, ISOTimestamp } from '@capacitylens/shared/types/entities'
import { isIsoInstant } from '@capacitylens/shared/account/types'
import { isValidISODate } from '@capacitylens/shared/lib/integrity'

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

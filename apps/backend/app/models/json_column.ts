import type { ColumnOptions } from '@adonisjs/lucid/types/model'

type JsonColumnOptions<T> = Pick<ColumnOptions, 'prepare' | 'consume'> & {
  prepare(value: T | null): string | null
  consume(value: unknown): T | null
}

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type JsonValidator<T> = (value: unknown) => value is T

export const isBoolean: JsonValidator<boolean> = (value): value is boolean =>
  typeof value === 'boolean'

export const isJsonValue: JsonValidator<JsonValue> = (value): value is JsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value as Record<string, unknown>).every(isJsonValue)
  )
}

export function isOneOf<const T extends string | number>(values: readonly T[]): JsonValidator<T> {
  return (value): value is T => values.includes(value as T)
}

export function isArrayOf<T>(validate: JsonValidator<T>): JsonValidator<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(validate)
}

/** Defines the SQLite JSON boundary for one known model column. */
export function jsonColumn<T>(
  table: string,
  column: string,
  validate: JsonValidator<T>
): JsonColumnOptions<T> {
  const invalid = () => new Error(`Invalid persisted JSON in ${table}.${column}`)
  return {
    prepare(value) {
      if (value === null) return null
      if (!validate(value)) throw invalid()
      const encoded = JSON.stringify(value)
      if (encoded === undefined)
        throw new Error(`Cannot persist undefined JSON in ${table}.${column}`)
      return encoded
    },
    consume(value) {
      if (value === null) return null
      let parsed: unknown = value
      try {
        if (typeof value === 'string') parsed = JSON.parse(value)
      } catch {
        throw invalid()
      }
      if (!validate(parsed)) throw invalid()
      return parsed
    },
  }
}

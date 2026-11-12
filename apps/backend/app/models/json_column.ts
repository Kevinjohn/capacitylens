import type { ColumnOptions } from '@adonisjs/lucid/types/model';

type JsonColumnOptions<T> = Pick<ColumnOptions, 'prepare' | 'consume'> & {
  prepare(value: T | null): string | null;
  consume(value: unknown): T | null;
};

export type JsonValidator<T> = (value: unknown) => value is T;

export const isBoolean: JsonValidator<boolean> = (value): value is boolean =>
  typeof value === 'boolean';

export function isOneOf<const T extends string | number>(values: readonly T[]): JsonValidator<T> {
  return (value): value is T => values.includes(value as T);
}

export function isArrayOf<T>(validate: JsonValidator<T>): JsonValidator<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(validate);
}

/** Defines the SQLite JSON boundary for one known model column. */
export function jsonColumn<T>(
  table: string,
  column: string,
  validate: JsonValidator<T>
): JsonColumnOptions<T> {
  const invalid = () => new Error(`Invalid persisted JSON in ${table}.${column}`);
  return {
    prepare(value) {
      if (value === null) return null;
      if (!validate(value)) throw invalid();
      // The lib types promise a string, but functions and undefined serialise to undefined, and an
      // annotated declaration would narrow straight back to string on assignment.
      const encoded = JSON.stringify(value) as string | undefined;
      if (encoded === undefined) {
        throw new Error(`Cannot persist undefined JSON in ${table}.${column}`);
      }
      return encoded;
    },
    consume(value) {
      if (value === null) return null;
      let parsed: unknown = value;
      try {
        if (typeof value === 'string') parsed = JSON.parse(value);
      } catch {
        throw invalid();
      }
      if (!validate(parsed)) throw invalid();
      return parsed;
    },
  };
}

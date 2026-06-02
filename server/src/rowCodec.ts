import type { SQLInputValue } from 'node:sqlite'
import type { TableSpec } from './tables'

// Row <-> object codecs, extracted from db.ts. They map between a SQL row (column order
// per the table spec) and the plain AppData entity object the client already speaks:
// json columns are JSON.stringify'd on write / parsed on read, and absent optionals are
// stored NULL and omitted again on read so a round-trip deep-equals the client's object.
// Pure — no DB handle — so they're independently testable.

export type Row = Record<string, unknown>

/** Object → SQL row cell: JSON-encode json columns, undefined → null. */
function toCell(c: TableSpec['columns'][number], v: unknown): SQLInputValue {
  if (v === undefined || v === null) return null
  return (c.json ? JSON.stringify(v) : v) as SQLInputValue
}

/** Object → SQL row: the cell array in the spec's column order, ready to spread into run(). */
export function toRow(spec: TableSpec, obj: Row): SQLInputValue[] {
  return spec.columns.map((c) => toCell(c, obj[c.name]))
}

/** SQL row → object: JSON-decode json columns, drop NULL optionals so the result
 *  deep-equals the client's object (which omits absent optionals). */
export function fromRow(spec: TableSpec, row: Row): Row {
  const obj: Row = {}
  for (const c of spec.columns) {
    const v = row[c.name]
    if (v === null || v === undefined) {
      if (!c.optional) obj[c.name] = v // required column: keep as-is (shouldn't be null)
      continue
    }
    obj[c.name] = c.json ? JSON.parse(v as string) : v
  }
  return obj
}

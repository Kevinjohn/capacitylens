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
 *  deep-equals the client's object (which omits absent optionals).
 *
 *  @throws {Error} a typed "Corrupt JSON in <table>.<column> (id=…)" error if a json column on
 *    disk can't be parsed (corruption, a manual edit, or a value written by an older/buggy codec).
 *    We RETHROW with the exact location rather than swallowing: loadState() reads every row through
 *    here, so a silent fallback to the raw string would quietly poison the in-memory AppData tree
 *    (the local-first data-corruption anti-goal), and a bare JSON.parse throw would surface only as
 *    an opaque 500 with no clue WHICH row is bad. Naming table.column.id makes it diagnosable. */
export function fromRow(spec: TableSpec, row: Row): Row {
  const obj: Row = {}
  for (const c of spec.columns) {
    const v = row[c.name]
    if (v === null || v === undefined) {
      if (!c.optional) obj[c.name] = v // required column: keep as-is (shouldn't be null)
      continue
    }
    if (c.json) {
      try {
        obj[c.name] = JSON.parse(v as string)
      } catch (e) {
        const id = typeof row.id === 'string' ? row.id : '?'
        throw new Error(
          `Corrupt JSON in ${spec.key}.${c.name} (id=${id}): ${e instanceof Error ? e.message : String(e)}`,
          { cause: e },
        )
      }
    } else {
      obj[c.name] = v
    }
  }
  return obj
}

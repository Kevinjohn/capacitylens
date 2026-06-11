import type { AppData, Entity } from '@floaty/shared/types/entities'

// The pure diff/apply core of server sync, extracted from ServerSyncAdapter so the
// snapshot-to-REST-ops logic can be read and tested in isolation from the network
// adapter. No I/O here — just two pure functions over AppData snapshots.

// Parent-before-child: every create/update must follow its foreign-key targets.
// Deletes use the reverse (child-before-parent). The emitted batch runs ALL upserts
// before ALL deletes — see diffOps for why (a reparent's new binding must land before
// the old parent's delete cascades).
const UPSERT_ORDER = [
  'accounts',
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'tasks',
  'allocations',
  'timeOff',
] as const

type TableKey = (typeof UPSERT_ORDER)[number]

// Exhaustiveness: every AppData key must appear in UPSERT_ORDER and vice versa.
// Adding a table to AppData without adding it here fails to compile.
type _MissingFromOrder = Exclude<keyof AppData, TableKey>
const _orderComplete: _MissingFromOrder extends never ? true : never = true
void _orderComplete

export interface Op {
  method: 'PUT' | 'DELETE'
  table: TableKey
  id: string
  row?: Entity
  /** For a scoped-entity DELETE: the owning account (read from the pre-delete snapshot),
   *  sent so the server can refuse a cross-account delete. Accounts are top-level and
   *  carry none. */
  accountId?: string
}

/** Compute the ordered operations that turn `prev` into `next`, applied as one
 *  transactional batch. Upserts run parent-first, then deletes run child-first. An
 *  entity is an "upsert" when it's new or its updatedAt changed (the store bumps
 *  updatedAt on every edit, so it's a reliable change marker); a "delete" when it's
 *  gone from `next`.
 *
 *  ORDER IS LOAD-BEARING: all upserts precede all deletes. Reparent + delete in one
 *  batch (e.g. move project P from client C1→C2, then delete C1) must apply P's new
 *  clientId BEFORE C1 is deleted — otherwise C1's `ON DELETE CASCADE` removes P (still
 *  bound to C1 in the DB) and its unmodified descendants, which carry no upsert op and
 *  would be lost. Doing upserts first lets the cascade find nothing to take.
 *  Exported for unit tests. */
export function diffOps(prev: AppData, next: AppData): Op[] {
  const upserts: Op[] = []
  const deletes: Op[] = []
  for (const table of UPSERT_ORDER) {
    const prevRows = prev[table] as Entity[]
    const nextRows = next[table] as Entity[]
    const prevById = new Map(prevRows.map((e) => [e.id, e]))
    const nextById = new Map(nextRows.map((e) => [e.id, e]))
    for (const row of nextRows) {
      const before = prevById.get(row.id)
      if (!before || before.updatedAt !== row.updatedAt) {
        upserts.push({ method: 'PUT', table, id: row.id, row })
      }
    }
    for (const row of prevRows) {
      if (!nextById.has(row.id)) {
        // Carry the owning account (from the pre-delete snapshot) so the server can scope
        // the delete; accounts are top-level so they carry none.
        const accountId = table === 'accounts' ? undefined : (row as { accountId?: string }).accountId
        deletes.push({ method: 'DELETE', table, id: row.id, accountId })
      }
    }
  }
  // upserts parent-first, then deletes child-first (reverse table order).
  deletes.reverse()
  return [...upserts, ...deletes]
}

/** Apply a set of (already-confirmed) ops to a base snapshot, returning a NEW AppData.
 *  Lets the sync advance lastSynced by EXACTLY the writes that landed, so a partial flush
 *  leaves only the failed rows in the next diff (the rest are marked synced and never
 *  replay). Exported for unit tests. */
export function applyOps(base: AppData, ops: Op[]): AppData {
  const next = {} as Record<TableKey, Entity[]>
  for (const table of UPSERT_ORDER) next[table] = [...(base[table] as Entity[])]
  for (const op of ops) {
    const list = next[op.table]
    if (op.method === 'DELETE') {
      next[op.table] = list.filter((r) => r.id !== op.id)
    } else if (op.row) {
      const idx = list.findIndex((r) => r.id === op.id)
      if (idx >= 0) list[idx] = op.row
      else list.push(op.row)
    }
  }
  return next as unknown as AppData
}

import type { PersistenceAdapter } from './PersistenceAdapter'
import { emptyAppData } from '@floaty/shared/types/entities'
import type { AppData, Entity } from '@floaty/shared/types/entities'
import { migrate } from '@floaty/shared/data/migrate'

// A PersistenceAdapter that keeps the SAME whole-tree contract the store already
// speaks (loadAll / saveAll) but talks to the entity-level REST API:
//   - loadAll(): GET /api/state  → one round-trip hydration (reads stay whole-tree)
//   - saveAll(next): DIFF next against the last-synced snapshot and emit per-entity
//     PUT (upsert) / DELETE calls. Writes are entity-level; the store never changes.
//
// Why a diff and not a command log: the store builds the whole next AppData on every
// action (incl. undo/redo and import), so a diff is the one place that turns any
// state transition — forward edit OR undo — into the right set of REST calls without
// the store knowing a server exists. lastSynced advances only from the local
// optimistic state on full success, so a server echo can never re-trigger a write
// (ids + timestamps are client-generated, so a re-read would match exactly).

// Parent-before-child: every create/update must follow its foreign-key targets.
// Deletes use the reverse so a child is always removed before its parent (and the
// DB's ON DELETE CASCADE covers any overlap — our DELETEs are idempotent).
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

interface Op {
  method: 'PUT' | 'DELETE'
  table: TableKey
  id: string
  row?: Entity
}

/** Compute the ordered REST operations that turn `prev` into `next`. Upserts run
 *  parent-first; deletes child-first. An entity is an "upsert" when it's new or its
 *  updatedAt changed (the store bumps updatedAt on every edit, so it's a reliable
 *  change marker); a "delete" when it's gone from `next`. Exported for unit tests. */
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
      if (!nextById.has(row.id)) deletes.push({ method: 'DELETE', table, id: row.id })
    }
  }
  // deletes child-first (reverse table order), then upserts parent-first.
  deletes.reverse()
  return [...deletes, ...upserts]
}

export class ServerSyncAdapter implements PersistenceAdapter {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  // The last state confirmed fully synced to the server; every diff is computed
  // against it and it only advances on a fully successful flush.
  private lastSynced: AppData = emptyAppData()
  // Coalesce-to-latest: while a flush is in flight, newer saves just park here and
  // the running flush picks them up. One write path, no overlapping requests.
  private queued: AppData | null = null
  private inFlight: Promise<void> | null = null

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch.bind(globalThis)) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fetchImpl = fetchImpl
  }

  async loadAll(): Promise<AppData> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/state`)
    if (!res.ok) throw new Error(`Failed to load state (${res.status})`)
    const json: unknown = await res.json()
    const data = migrate(json) // tolerate an older-schema server payload
    this.lastSynced = data
    return data
  }

  async hasExisting(): Promise<boolean> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/meta`)
    if (!res.ok) throw new Error(`Failed to read meta (${res.status})`)
    const json = (await res.json()) as { hasData?: boolean }
    return json.hasData === true
  }

  async saveAll(next: AppData): Promise<void> {
    this.queued = next
    if (this.inFlight) return this.inFlight
    this.inFlight = this.drain()
    try {
      await this.inFlight
    } finally {
      this.inFlight = null
    }
  }

  // Drain the queue: diff against lastSynced, apply, advance — repeat until no newer
  // state arrived mid-flush. Throws on the first failed request WITHOUT advancing
  // lastSynced, so persist.ts surfaces it (persistError) and the next save replays
  // the full delta since the last good sync.
  private async drain(): Promise<void> {
    while (this.queued) {
      const target = this.queued
      this.queued = null
      const ops = diffOps(this.lastSynced, target)
      for (const op of ops) await this.apply(op)
      this.lastSynced = target
    }
  }

  private async apply(op: Op): Promise<void> {
    const url = `${this.baseUrl}/api/${op.table}/${encodeURIComponent(op.id)}`
    const res =
      op.method === 'DELETE'
        ? await this.fetchImpl(url, { method: 'DELETE' })
        : await this.fetchImpl(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(op.row),
          })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`${op.method} ${op.table}/${op.id} failed (${res.status}) ${detail}`.trim())
    }
  }
}

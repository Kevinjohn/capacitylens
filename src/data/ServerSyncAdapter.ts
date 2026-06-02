import { LoadError, type PersistenceAdapter } from './PersistenceAdapter'
import { emptyAppData } from '@floaty/shared/types/entities'
import type { AppData } from '@floaty/shared/types/entities'
import { migrate } from '@floaty/shared/data/migrate'
import { diffOps, applyOps, type Op } from './syncOps'

// diffOps/applyOps now live in ./syncOps (the pure diff/apply core). Re-exported here
// so existing import sites (e.g. ServerSyncAdapter.test.ts) keep resolving them from
// this module unchanged.
export { diffOps, applyOps } from './syncOps'

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
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/state`)
      if (!res.ok) throw new Error(`Failed to load state (${res.status})`)
      const json: unknown = await res.json()
      const data = migrate(json) // tolerate an older-schema server payload
      this.lastSynced = data
      return data
    } catch (e) {
      // A rejected fetch (server down / network error), a non-OK status, or an
      // unreadable server payload are ALL remote conditions: the user recovers by
      // RETRYING, never by clearing local storage (the corrupt-data reset path,
      // which can't recover a server-backed app). Flag as 'unavailable' so bootstrap
      // routes to the connection-error screen, not StorageRecovery.
      throw new LoadError('unavailable', e instanceof Error ? e.message : 'Failed to load state from server.')
    }
  }

  async hasExisting(): Promise<boolean> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/meta`)
    if (!res.ok) throw new Error(`Failed to read meta (${res.status})`)
    const json = (await res.json()) as { hasData?: boolean }
    return json.hasData === true
  }

  async saveAll(next: AppData, opts?: { unload?: boolean }): Promise<void> {
    // Page-teardown flush: dispatch EVERY op up-front (keepalive) instead of the normal
    // sequential drain. On pagehide the event loop dies after the first `await`, so a
    // sequential loop would only ever get the FIRST request on the wire and lose the rest of
    // a multi-entity change (e.g. a cascade delete's child-then-parent DELETEs).
    if (opts?.unload) return this.flushUnload(next)
    this.queued = next
    if (this.inFlight) return this.inFlight
    this.inFlight = this.drain()
    try {
      await this.inFlight
    } finally {
      this.inFlight = null
    }
  }

  // Best-effort final flush on page teardown. Fires all fetches synchronously (apply()
  // initiates the request before its first await), so they're on the wire before the document
  // unloads; keepalive lets them outlive it. Deliberately does NOT advance lastSynced (the
  // page is going away — a surviving reload re-diffs against the server) and swallows per-op
  // errors. Ordering isn't guaranteed here, but deletes are idempotent + the DB cascades, and
  // the only FK-order casualty is the rare new-parent-and-child created within the 300ms
  // before close — still far better than the sequential loop losing everything after op 1.
  private async flushUnload(next: AppData): Promise<void> {
    const ops = diffOps(this.lastSynced, next)
    await Promise.all(ops.map((op) => this.apply(op).catch(() => {})))
  }

  // Drain the queue: diff against lastSynced, apply, advance — repeat until no newer
  // state arrived mid-flush. Attempts EVERY op (rather than stopping at the first
  // failure), so a single permanently-rejected row can't block all the others from
  // syncing. On any failure it throws WITHOUT advancing lastSynced, so persist.ts
  // surfaces it (persistError) and the next save replays the full delta since the last
  // good sync — PUT/DELETE are idempotent, so already-applied rows simply re-apply.
  private async drain(): Promise<void> {
    while (this.queued) {
      const target = this.queued
      this.queued = null
      const ops = diffOps(this.lastSynced, target)
      const applied: Op[] = []
      const failures: string[] = []
      for (const op of ops) {
        try {
          await this.apply(op)
          applied.push(op)
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e))
        }
      }
      // Advance the snapshot to reflect ONLY the ops that landed: on full success that's
      // exactly `target`; on partial failure it's the server's real state, so the next
      // diff re-emits just the still-failing rows (the rest are now synced and never
      // replay) — a poison row is isolated, not left blocking every later change.
      this.lastSynced = failures.length === 0 ? target : applyOps(this.lastSynced, applied)
      if (failures.length > 0) {
        throw new Error(`${failures.length} change(s) rejected: ${failures[0]}`)
      }
    }
  }

  private async apply(op: Op): Promise<void> {
    const path = `${this.baseUrl}/api/${op.table}/${encodeURIComponent(op.id)}`
    // keepalive: each entity write is tiny (one row, far below the 64KB keepalive cap),
    // so the request can outlive the page — the last debounced edit flushed on pagehide
    // isn't cancelled by the unload (a plain fetch would be, losing it in server mode).
    const res =
      op.method === 'DELETE'
        ? // Scope the delete to its owning account so the server can refuse a cross-account
          // delete (the server analog of the store's findOwned guard).
          await this.fetchImpl(op.accountId ? `${path}?accountId=${encodeURIComponent(op.accountId)}` : path, {
            method: 'DELETE',
            keepalive: true,
          })
        : await this.fetchImpl(path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(op.row),
            keepalive: true,
          })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`${op.method} ${op.table}/${op.id} failed (${res.status}) ${detail}`.trim())
    }
  }
}

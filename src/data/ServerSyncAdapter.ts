import { LoadError, type PersistenceAdapter } from './PersistenceAdapter'
import { emptyAppData } from '@floaty/shared/types/entities'
import type { AppData } from '@floaty/shared/types/entities'
import { migrate } from '@floaty/shared/data/migrate'
import { diffOps, type Op } from './syncOps'

// diffOps/applyOps now live in ./syncOps (the pure diff/apply core). Re-exported here
// so existing import sites (e.g. ServerSyncAdapter.test.ts) keep resolving them from
// this module unchanged.
export { diffOps, applyOps } from './syncOps'

// A PersistenceAdapter that keeps the SAME whole-tree contract the store already
// speaks (loadAll / saveAll) but talks to the entity-level REST API:
//   - loadAll(): GET /api/state  → one round-trip hydration (reads stay whole-tree)
//   - saveAll(next): DIFF next against the last-synced snapshot and POST the ordered
//     op set to /api/batch, which applies it in ONE server-side transaction (upserts
//     parent-first, then deletes child-first). One request, all-or-nothing. The store
//     never changes.
//
// Why a diff and not a command log: the store builds the whole next AppData on every
// action (incl. undo/redo and import), so a diff is the one place that turns any
// state transition — forward edit OR undo — into the right ops without the store
// knowing a server exists. Why a transactional batch and not per-op requests: a
// reparent (move a child to a new parent) coalesced with the old parent's delete must
// land the re-binding BEFORE the delete cascades, or the cascade takes the child's
// unmodified descendants. A single ordered transaction guarantees that and stays
// atomic on failure. lastSynced advances only from the local optimistic state on
// success, so a server echo can never re-trigger a write (ids + timestamps are
// client-generated, so a re-read would match exactly).

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
    // Page-teardown flush: send the whole diff as ONE keepalive batch request so it
    // survives the unload (a plain fetch would be cancelled mid-flight). See applyBatch.
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

  // Best-effort final flush on page teardown: one keepalive batch request, errors
  // swallowed (the page is going away — a surviving reload re-diffs against the server).
  // Deliberately does NOT advance lastSynced. One ordered, atomic request, so the
  // FK-order race the old per-op Promise.all had on a new-parent+child pair is gone.
  private async flushUnload(next: AppData): Promise<void> {
    const ops = diffOps(this.lastSynced, next)
    if (ops.length === 0) return
    await this.applyBatch(ops, { keepalive: true }).catch(() => {})
  }

  // Drain the queue: diff against lastSynced and apply the whole delta as ONE
  // transactional batch (the server runs it in a single tx → all-or-nothing, ordered).
  // Advance lastSynced ONLY on success; on failure throw WITHOUT advancing, so persist.ts
  // surfaces it (persistError) and the next save replays the full delta — the batch is
  // idempotent (PUT upserts, DELETE no-ops on an absent id). Repeats until no newer state
  // arrived mid-flush (coalesce-to-latest). Atomicity replaces the old per-op poison-row
  // isolation: a bad row now fails the whole batch rather than leaving a partial write.
  private async drain(): Promise<void> {
    while (this.queued) {
      const target = this.queued
      this.queued = null
      const ops = diffOps(this.lastSynced, target)
      if (ops.length > 0) await this.applyBatch(ops)
      this.lastSynced = target
    }
  }

  // POST the ordered ops to /api/batch; the server applies them in one transaction
  // (upserts parent-first, then deletes child-first — see syncOps.diffOps), so a
  // reparent+delete can't lose rows and a mid-batch failure rolls the whole thing back.
  // keepalive (unload) lets the request outlive the page; a debounced change's batch body
  // stays well under the 64KB keepalive cap.
  private async applyBatch(ops: Op[], opts?: { keepalive?: boolean }): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops }),
      keepalive: opts?.keepalive,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Batch sync failed (${res.status}) ${detail}`.trim())
    }
  }
}

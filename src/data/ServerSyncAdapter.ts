import { LoadError, type PersistenceAdapter } from './PersistenceAdapter'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { AppData } from '@capacitylens/shared/types/entities'
import { migrate } from '@capacitylens/shared/data/migrate'
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

/**
 * Thrown when POST /api/batch answers **409** — the server's optimistic-concurrency conflict
 * signal (CAPACITYLENS_OPTIMISTIC_CONCURRENCY=1: a stale `updatedAt`; body `{ error, current }`,
 * see the server's StaleWriteError arm). A TYPED error, not the generic batch failure, because the
 * persist layer must treat it differently: retrying the same stale diff is deterministic futility
 * (the server will 409 it forever), so persist.ts resolves a conflict by RELOADING the active
 * slice (server wins — the documented interim policy until a conflict UI exists).
 */
export class BatchConflictError extends Error {
  /** The server's copy of the conflicted row, when the 409 body carried one (best-effort parse). */
  readonly current?: unknown
  constructor(message: string, current?: unknown) {
    super(message)
    this.name = 'BatchConflictError'
    this.current = current
  }
}

// One logical diff is always one server transaction. The client never slices this limit into
// separately committed prefixes; an over-limit diff fails atomically and remains in the durable
// write journal. Server-mode imports use their dedicated atomic endpoint.
export const MAX_OPS_PER_BATCH = 5000
const KEEPALIVE_BODY_BUDGET = 60 * 1024
const WRITE_QUEUE_KEY = 'capacitylens/server-write-queue/v1'

interface DurableWrite {
  revision: string
  data: AppData
}

type DurableQueues = Record<string, Record<string, DurableWrite>>

function readDurableQueues(): DurableQueues {
  try {
    const raw = localStorage.getItem(WRITE_QUEUE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as DurableQueues)
      : {}
  } catch {
    return {}
  }
}

function writeDurableQueues(queues: DurableQueues): boolean {
  try {
    if (Object.keys(queues).length === 0) localStorage.removeItem(WRITE_QUEUE_KEY)
    else localStorage.setItem(WRITE_QUEUE_KEY, JSON.stringify(queues))
    return true
  } catch (error) {
    // Callers distinguish a required write-ahead journal entry from best-effort cleanup.
    console.warn('ServerSyncAdapter: durable write journal is unavailable', error)
    return false
  }
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
  private queuedRevision: string | null = null
  private inFlight: Promise<void> | null = null
  private revisionCounter = 0
  // Load generation counter: bumped at the START of every loadAll. A loadAll that is no longer
  // the newest by the time its fetch resolves must NOT seed `lastSynced` — persist.ts's token
  // guard discards that stale slice from the STORE, but without this guard the adapter snapshot
  // would still be mutated, leaving snapshot=stale-account while data=newer-account, and the next
  // save would diff across tenants (DELETEs for the stale account + PUTs for the newer one —
  // cross-account data loss).
  private loadGen = 0
  // Seed generation counter: bumped every time loadAll actually SEEDS `lastSynced`. This — not
  // loadGen — is what drain() must check: loadGen bumps at fetch START, so a save that begins
  // while a load is already in flight captures the same generation the load will seed under, and
  // a start-generation check would pass even though the seed landed mid-batch. Two uses:
  //   - a queued save whose seedGen is stale by the time drain picks it up is DROPPED — its diff
  //     basis (the snapshot it was queued against) is gone, and diffing it against the fresh seed
  //     could cross tenants (DELETEs of the new account's rows + PUTs of the old one's);
  //   - after a batch lands, `lastSynced` advances only if no seed happened since the diff was
  //     taken — otherwise the reload's fresh seed wins (skipping is safe: the server already
  //     holds the batch's idempotent ops, so the next diff re-derives anything still relevant).
  // persist.ts's reload paths surface/re-push any edit a dropped save carried (see refreshActive's
  // mid-load-edit handling), so a drop here is never a silent loss.
  private seedGen = 0
  // The seedGen at the moment `queued` was last written — pairs a parked save with the snapshot
  // generation it was diffed-to-be against.
  private queuedSeedGen = 0

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch.bind(globalThis)) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fetchImpl = fetchImpl
  }

  private accountIdFor(data: AppData): string | null {
    const ids = new Set<string>()
    for (const account of data.accounts) ids.add(account.id)
    for (const table of [
      data.disciplines,
      data.resources,
      data.clients,
      data.projects,
      data.phases,
      data.activities,
      data.allocations,
      data.timeOff,
    ]) {
      for (const row of table) ids.add(row.accountId)
    }
    return ids.size === 1 ? [...ids][0] : null
  }

  private persistPending(data: AppData): string | null {
    const accountId = this.accountIdFor(data)
    if (!accountId) return null
    const nonce = globalThis.crypto?.randomUUID?.() ?? String(++this.revisionCounter)
    const revision = `${Date.now()}-${nonce}-${++this.revisionCounter}`
    const queues = readDurableQueues()
    const backend = (queues[this.baseUrl] ??= {})
    backend[accountId] = { revision, data }
    if (!writeDurableQueues(queues)) {
      throw new Error('The durable write queue is unavailable; the change was not sent.')
    }
    return revision
  }

  private pendingFor(accountId: string): DurableWrite | null {
    const entry = readDurableQueues()[this.baseUrl]?.[accountId]
    if (!entry || typeof entry.revision !== 'string' || !entry.data) return null
    try {
      return { revision: entry.revision, data: migrate(entry.data) }
    } catch {
      return null
    }
  }

  private clearPending(accountId: string, revision: string): void {
    const queues = readDurableQueues()
    const backend = queues[this.baseUrl]
    if (!backend || backend[accountId]?.revision !== revision) return
    delete backend[accountId]
    if (Object.keys(backend).length === 0) delete queues[this.baseUrl]
    writeDurableQueues(queues)
  }

  discardPending(accountId: string): void {
    const queues = readDurableQueues()
    const backend = queues[this.baseUrl]
    if (!backend) return
    delete backend[accountId]
    if (Object.keys(backend).length === 0) delete queues[this.baseUrl]
    if (!writeDurableQueues(queues)) {
      throw new Error('The durable write queue could not discard the conflicted change.')
    }
  }

  // P3.4: every request carries credentials so an auth-enabled server (CAPACITYLENS_AUTH ≠ off)
  // sees the Better Auth session cookie. With auth off (the default) and same-origin
  // requests there are no cookies to send — a verified no-op (the db-backed e2e project
  // runs unchanged); the server pairs reflected CORS origins with Allow-Credentials.
  //
  // @param accountId  When PRESENT (P1.13), load ONLY that account's scoped slice via
  //   `GET /api/state?accountId=…`. This is the per-account hydration path: the picker chose a tenant
  //   and we load just its data. When ABSENT, fall back to the no-arg whole read — used in OFF/demo
  //   (still a whole tree) and the pre-pick bootstrap before any account is active (in auth-on the
  //   server now 400s a no-arg read, which surfaces as a LoadError → connection screen, which is
  //   correct: there's nothing to show until a tenant is picked and re-loaded with an id).
  //
  // EITHER WAY `lastSynced` is set to EXACTLY the returned body — this is the diff SNAPSHOT every save
  // is computed against, so it MUST equal the slice we just loaded. The persist switch orchestrator
  // (persist.ts) relies on this: re-seeding the snapshot to the new account in the SAME call as the
  // load is what keeps snapshot and `data` on the same tenant. If they ever desync (snapshot=A,
  // data=B) the next save would emit DELETEs for A + PUTs for B → cross-account data loss.
  async loadAll(accountId?: string): Promise<AppData> {
    const myGen = ++this.loadGen
    try {
      const url =
        accountId !== undefined
          ? `${this.baseUrl}/api/state?accountId=${encodeURIComponent(accountId)}`
          : `${this.baseUrl}/api/state`
      const res = await this.fetchImpl(url, { credentials: 'include' })
      // The no-arg whole read is CLOSED in auth-on (P1.13): the server 400s it (tenant isolation —
      // a logged-in user must hydrate PER ACCOUNT via ?accountId=). Treat that 400 on the NO-ARG read
      // as "nothing to hydrate yet" — return EMPTY (snapshot empty) so bootstrap shows the picker
      // rather than a connection-error dead end. The picker lists the login's accounts from
      // GET /api/accounts (useAccountSummaries); picking one hydrates its slice via loadAll(accountId).
      // OFF keeps the no-arg whole read (200), so this branch never fires there. A 400 on a SCOPED
      // read (accountId present) is a real error and still throws below.
      if (accountId === undefined && res.status === 400) {
        const empty = emptyAppData()
        if (myGen === this.loadGen) {
          this.lastSynced = empty
          this.seedGen += 1
        }
        return empty
      }
      if (!res.ok) throw new Error(`Failed to load state (${res.status})`)
      // An HTML body — the SPA-fallback index.html or a proxy error page, a REACHABLE case now an
      // empty-env server-default build can hit a backend-less same-origin host — starts with '<', so
      // native res.json() runs JSON.parse and REJECTS with a SyntaxError. That rejection is caught
      // below and mapped to LoadError('unavailable') → the connection-error screen; it does NOT reach
      // migrate(). So migrate() only ever sees a body that already parsed as JSON.
      const json: unknown = await res.json()
      // migrate() is TOLERANT of a PARSED-but-malformed/non-CapacityLens object: it coerces it to an
      // EMPTY AppData rather than throwing. So a 200 carrying valid JSON of the wrong shape hydrates
      // EMPTY and sets lastSynced=empty here — accepted because in server mode the SERVER is the source
      // of truth (there's nothing local to overwrite). If such a 200 should instead be a hard failure,
      // reuse the shared hasNonArrayKnownTable guard before migrate and throw LoadError('unavailable').
      let data = migrate(json)
      // Replay a crash/offline-surviving desired state before exposing the server slice. The diff
      // is still one atomic batch; if it conflicts or the network fails the journal remains and the
      // load fails visibly rather than silently presenting a server copy that omits local work.
      if (accountId !== undefined) {
        const pending = this.pendingFor(accountId)
        // Replay is a new-session recovery path. If this adapter already has a write in flight,
        // that drain owns the same journal entry; replaying it inside a concurrent refresh would
        // create a second batch and can deadlock a held request in addition to duplicating work.
        if (pending && this.inFlight === null) {
          const pendingOps = diffOps(data, pending.data)
          if (pendingOps.length > 0) await this.applyBatch(pendingOps)
          this.clearPending(accountId, pending.revision)
          data = pending.data
        }
      }
      // Re-seed the diff snapshot to the SLICE we just loaded (atomic with the load — see the
      // method doc). A switch orchestrator calling loadAll(newId) gets lastSynced === the new
      // account's slice, so the immediately-following saveAll diffs new-vs-new = ZERO ops, never
      // cross-account deletes. Generation-guarded: a SUPERSEDED load (a newer loadAll started
      // while this fetch was in flight) must not seed — its slice is discarded by persist.ts's
      // token guard, and seeding here anyway would desync snapshot from data (see loadGen).
      if (myGen === this.loadGen) {
        this.lastSynced = data
        this.seedGen += 1 // announce the seed to drain() — see the seedGen doc
      }
      return data
    } catch (e) {
      // A rejected fetch (server down / network error), a non-OK status, or an
      // unreadable server payload are ALL remote conditions: the user recovers by
      // RETRYING, never by clearing local storage (the corrupt-data reset path,
      // which can't recover a server-backed app). Flag as 'unavailable' so bootstrap
      // routes to the connection-error screen, not StorageRecovery.
      throw new LoadError('unavailable', e instanceof Error ? e.message : 'Failed to load state from server.', {
        cause: e,
      })
    }
  }

  async hasExisting(): Promise<boolean> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/meta`, { credentials: 'include' })
    if (!res.ok) throw new Error(`Failed to read meta (${res.status})`)
    const json = (await res.json()) as { hasData?: boolean }
    return json.hasData === true
  }

  async saveAll(next: AppData, opts?: { unload?: boolean }): Promise<void> {
    const revision = this.persistPending(next)
    // Page-teardown flush: send the whole diff as ONE keepalive batch request so it
    // survives the unload (a plain fetch would be cancelled mid-flight). See applyBatch.
    if (opts?.unload) return this.flushUnload(next, revision)
    this.queued = next
    this.queuedRevision = revision
    this.queuedSeedGen = this.seedGen // pair the parked save with the snapshot it was made against
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
  private async flushUnload(next: AppData, revision: string | null): Promise<void> {
    const ops = diffOps(this.lastSynced, next)
    const accountId = this.accountIdFor(next)
    if (ops.length === 0) {
      if (revision && accountId) this.clearPending(accountId, revision)
      return
    }
    const committed = await this.applyBatch(ops, { keepalive: true })
    if (committed && revision && accountId) this.clearPending(accountId, revision)
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
      const targetRevision = this.queuedRevision
      const targetSeedGen = this.queuedSeedGen
      this.queued = null
      this.queuedRevision = null
      // A reload SEEDED the snapshot after this save was queued: the state it was diffed-to-be
      // against no longer exists, and diffing it against the fresh seed could cross tenants
      // (see the seedGen doc). Drop it — persist.ts's reload paths have already surfaced or
      // re-pushed whatever edit it carried.
      if (targetSeedGen !== this.seedGen) continue
      const ops = diffOps(this.lastSynced, target)
      // The ABSENCE of a try/catch here is INTENTIONAL — do not "harden" it. An applyBatch throw
      // MUST propagate so saveAll rejects, persist.ts surfaces it (persistError) and retries, and
      // lastSynced is NOT advanced. Swallowing here would advance lastSynced past writes that never
      // landed, silently dropping them from every future diff — permanent data loss.
      if (ops.length > 0) await this.applyBatch(ops)
      // Advance the snapshot ONLY if no seed landed while this batch was in flight — a reload's
      // fresh seed must win over our pre-reload target, or snapshot and store desync. Checked via
      // seedGen, NOT loadGen: loadGen bumps at fetch START, so a load already in flight when this
      // diff was taken would pass a start-generation check and still seed mid-batch. Skipping is
      // safe: the server already holds these idempotent ops, so the next diff re-derives anything
      // still relevant against the fresh seed.
      if (targetSeedGen === this.seedGen) this.lastSynced = target
      const accountId = this.accountIdFor(target)
      if (targetRevision && accountId) this.clearPending(accountId, targetRevision)
    }
  }

  // Apply the complete ordered diff as ONE request and therefore ONE SQLite transaction. An
  // over-limit diff remains in the durable journal; it is never split into committed prefixes.
  private async applyBatch(ops: Op[], opts?: { keepalive?: boolean }): Promise<boolean> {
    if (ops.length > MAX_OPS_PER_BATCH) {
      throw new Error(`Atomic sync exceeds the ${MAX_OPS_PER_BATCH}-operation server limit.`)
    }
    const body = JSON.stringify({ ops })
    if (opts?.keepalive && new TextEncoder().encode(body).byteLength > KEEPALIVE_BODY_BUDGET) {
      // Fetch keepalive has a small aggregate byte budget. The durable journal already owns this
      // desired state, so skip a predictably rejected teardown request and replay next session.
      return false
    }
    await this.postBatch(ops, body, opts)
    return true
  }

  // POST the complete ≤MAX_OPS_PER_BATCH diff to /api/batch; the server applies it in one
  // transaction (upserts parent-first, then deletes child-first — see syncOps.diffOps), so a
  // mid-batch failure rolls the whole transaction back. keepalive (unload) lets the request outlive
  // the page.
  private async postBatch(
    ops: Op[],
    body = JSON.stringify({ ops }),
    opts?: { keepalive?: boolean },
  ): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: opts?.keepalive,
      credentials: 'include',
    })
    if (!res.ok) {
      // 409 is the optimistic-concurrency conflict signal (stale updatedAt; body
      // `{ error, current }`). Throw the TYPED BatchConflictError so persist.ts can resolve it
      // by reloading (server wins) — retrying the same stale diff is deterministic futility.
      // Body parse is best-effort: an unreadable body still yields a conflict error.
      if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as { error?: string; current?: unknown } | null
        throw new BatchConflictError(body?.error ?? 'Batch sync failed (409): stale write conflict', body?.current)
      }
      // A 401 (session expired on an auth-enabled server) surfaces like any other write
      // failure — persist.ts raises the banner, and the AuthProvider's re-check sees the
      // 401 and swaps to the login screen. Never a silent drop.
      const detail = await res.text().catch(() => '')
      throw new Error(`Batch sync failed (${res.status}) ${detail}`.trim())
    }
    const receipt = (await res.json().catch(() => null)) as { ok?: unknown; applied?: unknown } | null
    if (receipt?.ok !== true || receipt.applied !== ops.length) {
      throw new Error('Batch sync returned an invalid commit receipt.')
    }
  }
}

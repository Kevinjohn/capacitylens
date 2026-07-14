import { LoadError, type PersistenceAdapter } from './PersistenceAdapter'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { AppData } from '@capacitylens/shared/types/entities'
import { migrate } from '@capacitylens/shared/data/migrate'
import { diffOps, type Op } from './syncOps'
import { announceAuditWarning } from '../lib/auditWarning'
import {
  cacheAccountSlice,
  readCachedAccountSlice,
  readCachedAuthSnapshot,
  setOfflineReadState,
} from './offlineCache'
import { requestSignal, API_REQUEST_TIMEOUT_MS, API_BULK_TIMEOUT_MS } from './requestTimeout'

// diffOps/applyOps now live in ./syncOps (the pure diff/apply core). Re-exported here
// so existing import sites (e.g. ServerSyncAdapter.test.ts) keep resolving them from
// this module unchanged.
export { diffOps, applyOps } from './syncOps'

interface CommittedRevision {
  table: Op['table']
  id: string
  createdAt: string
  updatedAt: string
}

function applyCommittedRevisions(data: AppData, revisions: CommittedRevision[]): AppData {
  if (revisions.length === 0) return data
  const byRow = new Map(revisions.map((revision) => [`${revision.table}\0${revision.id}`, revision]))
  const next = { ...data }
  for (const table of Object.keys(data) as Array<keyof AppData>) {
    next[table] = data[table].map((row) => {
      const revision = byRow.get(`${table}\0${row.id}`)
      return revision ? { ...row, createdAt: revision.createdAt, updatedAt: revision.updatedAt } : row
    }) as never
  }
  return next
}

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
// atomic on failure. Batch receipts carry server-owned revisions; the adapter reconciles them
// with client-local change markers before advancing lastSynced or flushing a queued edit.

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

/**
 * Thrown when a single logical diff exceeds {@link MAX_OPS_PER_BATCH}. The atomic design refuses to
 * split it into separately-committed prefixes (that would reintroduce the reparent-before-delete
 * FK-order race the single transaction exists to prevent), so this is a TERMINAL, non-retryable
 * condition — re-sending the identical over-limit diff throws forever, unlike a transient network
 * failure. A TYPED error (not the generic batch failure) so persist.ts can special-case it: surface
 * the banner plus a clear sticky notice and STOP the exponential-backoff retry loop. The desired
 * state stays in memory until a later, smaller diff lands or the page is closed.
 */
export class BatchTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BatchTooLargeError'
  }
}

class OfflineEligibleLoadError extends Error {}

// One logical diff is always one server transaction. The client never slices this limit into
// separately committed prefixes; an over-limit diff fails atomically. Server-mode imports use
// their dedicated atomic endpoint.
export const MAX_OPS_PER_BATCH = 5000
const KEEPALIVE_BODY_BUDGET = 60 * 1024

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
  private acknowledgedRevisions = new Map<string, { client: string; server: CommittedRevision }>()

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch.bind(globalThis)) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fetchImpl = fetchImpl
  }

  private request(
    input: RequestInfo | URL,
    init: RequestInit = {},
    timeoutMs: number | null = API_REQUEST_TIMEOUT_MS,
  ): Promise<Response> {
    // Share the one request-timeout/abort seam (requestSignal) with the rest of the API surface —
    // same AbortSignal.any fallback for engines that lack it — instead of a second hand-rolled copy
    // that could drift. `timeoutMs` picks the tier: interactive 15s by default, the longer bulk
    // bound for whole-slice load/batch, or `null` (no deadline) for the keepalive unload flush.
    return this.fetchImpl(input, { ...init, signal: requestSignal(init.signal, timeoutMs) })
  }

  private canonicalizeAcknowledged(data: AppData): AppData {
    const next = { ...data }
    let changed = false
    for (const table of Object.keys(data) as Array<keyof AppData>) {
      next[table] = data[table].map((row) => {
        const key = `${table}\0${row.id}`
        const acknowledged = this.acknowledgedRevisions.get(key)
        if (!acknowledged || row.updatedAt !== acknowledged.client) return row
        changed = true
        // Consumed: the server's canonical timestamps are now baked into the row that becomes
        // lastSynced, so this entry has done its job — delete it to bound the Map (it otherwise grows
        // one entry per distinct row ever PUT, for the tab's lifetime). If this result is later
        // discarded (a seedGen race) or the batch throws, the worst case is one redundant idempotent
        // PUT that simply re-remembers the revision — never data loss.
        this.acknowledgedRevisions.delete(key)
        return { ...row, createdAt: acknowledged.server.createdAt, updatedAt: acknowledged.server.updatedAt }
      }) as never
    }
    return changed ? next : data
  }

  private rememberRevisions(ops: Op[], revisions: CommittedRevision[]): void {
    const byRow = new Map(revisions.map((revision) => [`${revision.table}\0${revision.id}`, revision]))
    for (const op of ops) {
      if (op.method !== 'PUT' || !op.row) continue
      const server = byRow.get(`${op.table}\0${op.id}`)
      if (server) this.acknowledgedRevisions.set(`${op.table}\0${op.id}`, { client: op.row.updatedAt, server })
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
      // Whole-slice hydration: the BULK tier, not the interactive 15s — a large tenant's full read
      // can legitimately outrun the interactive bound against a healthy-but-slow server.
      const res = await this.request(url, { credentials: 'include' }, API_BULK_TIMEOUT_MS)
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
      if (!res.ok) {
        const ErrorType = res.status >= 500 ? OfflineEligibleLoadError : Error
        throw new ErrorType(`Failed to load state (${res.status})`)
      }
      // An HTML body — the SPA-fallback index.html or a proxy error page, a REACHABLE case now an
      // empty-env server-default build can hit a backend-less same-origin host — starts with '<', so
      // native res.json() runs JSON.parse and REJECTS with a SyntaxError. That rejection is caught
      // below and mapped to LoadError('unavailable') → the connection-error screen; it does NOT reach
      // migrate(). So migrate() only ever sees a body that already parsed as JSON.
      const json: unknown = await res.json()
      // Reject only a body that isn't a JSON object at all (null / array / primitive) — real garbage.
      // A MISSING or off-shape table key is tolerated: migrate() coerces every known table to [] via
      // normalize(), so a version-skewed server that omits a table the newer client expects still
      // hydrates and keeps working, rather than hard-failing the whole load to the connection-error
      // screen during a rolling deploy.
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error('The server returned an invalid state payload.')
      }
      const data = migrate(json)
      setOfflineReadState(false)
      if (accountId !== undefined) {
        void cacheAccountSlice(accountId, data).catch((error) =>
          console.warn('ServerSyncAdapter: the offline account snapshot could not be updated', error),
        )
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
      const transportFailure =
        e instanceof OfflineEligibleLoadError ||
        e instanceof TypeError ||
        (e instanceof DOMException && e.name === 'AbortError')
      if (accountId === undefined && transportFailure) {
        try {
          const cachedIdentity = await readCachedAuthSnapshot()
          if (cachedIdentity) {
            const empty = emptyAppData()
            if (myGen === this.loadGen) {
              this.lastSynced = empty
              this.seedGen += 1
            }
            setOfflineReadState(true, cachedIdentity.savedAt)
            return empty
          }
        } catch (cacheError) {
          console.warn('ServerSyncAdapter: the offline identity snapshot could not be read', cacheError)
        }
      }
      if (accountId !== undefined && transportFailure) {
        try {
          const cached = await readCachedAccountSlice(accountId)
          if (cached) {
            if (myGen === this.loadGen) {
              this.lastSynced = cached.value
              this.seedGen += 1
            }
            setOfflineReadState(true, cached.savedAt)
            return cached.value
          }
        } catch (cacheError) {
          console.warn('ServerSyncAdapter: the offline account snapshot could not be read', cacheError)
        }
      }
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
    const res = await this.request(`${this.baseUrl}/api/meta`, { credentials: 'include' })
    if (!res.ok) throw new Error(`Failed to read meta (${res.status})`)
    const json = (await res.json()) as { hasData?: boolean }
    return json.hasData === true
  }

  async saveAll(next: AppData, opts?: { unload?: boolean }): Promise<void> {
    // Page-teardown flush: send the whole diff as ONE keepalive batch request so it
    // survives the unload (a plain fetch would be cancelled mid-flight). See applyBatch.
    if (opts?.unload) return this.flushUnload(next)
    this.queued = next
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
  private async flushUnload(next: AppData): Promise<void> {
    const ops = diffOps(this.lastSynced, next)
    if (ops.length === 0) return
    await this.applyBatch(ops, { keepalive: true })
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
      const targetSeedGen = this.queuedSeedGen
      this.queued = null
      // A reload SEEDED the snapshot after this save was queued: the state it was diffed-to-be
      // against no longer exists, and diffing it against the fresh seed could cross tenants
      // (see the seedGen doc). Drop it — persist.ts's reload paths have already surfaced or
      // re-pushed whatever edit it carried.
      if (targetSeedGen !== this.seedGen) continue
      const canonicalTarget = this.canonicalizeAcknowledged(target)
      const ops = diffOps(this.lastSynced, canonicalTarget)
      // The ABSENCE of a try/catch here is INTENTIONAL — do not "harden" it. An applyBatch throw
      // MUST propagate so saveAll rejects, persist.ts surfaces it (persistError) and retries, and
      // lastSynced is NOT advanced. Swallowing here would advance lastSynced past writes that never
      // landed, silently dropping them from every future diff — permanent data loss.
      let committedTarget = canonicalTarget
      if (ops.length > 0) {
        const revisions = await this.applyBatch(ops)
        if (revisions) {
          this.rememberRevisions(ops, revisions)
          committedTarget = applyCommittedRevisions(canonicalTarget, revisions)
        }
      }
      // Advance the snapshot ONLY if no seed landed while this batch was in flight — a reload's
      // fresh seed must win over our pre-reload target, or snapshot and store desync. Checked via
      // seedGen, NOT loadGen: loadGen bumps at fetch START, so a load already in flight when this
      // diff was taken would pass a start-generation check and still seed mid-batch. Skipping is
      // safe: the server already holds these idempotent ops, so the next diff re-derives anything
      // still relevant against the fresh seed.
      if (targetSeedGen === this.seedGen) this.lastSynced = committedTarget
    }
  }

  // Apply the complete ordered diff as ONE request and therefore ONE SQLite transaction. An
  // over-limit diff is never split into separately committed prefixes.
  private async applyBatch(ops: Op[], opts?: { keepalive?: boolean }): Promise<CommittedRevision[] | null> {
    if (ops.length > MAX_OPS_PER_BATCH) {
      throw new BatchTooLargeError(`Atomic sync exceeds the ${MAX_OPS_PER_BATCH}-operation server limit.`)
    }
    // Rebase PUT preconditions, then serialize ONCE — the same body feeds both the keepalive
    // byte-budget check and the request, so a large batch isn't JSON.stringified twice per save.
    const body = JSON.stringify({ ops: this.rebaseForWire(ops) })
    if (opts?.keepalive && new TextEncoder().encode(body).byteLength > KEEPALIVE_BODY_BUDGET) {
      // Fetch keepalive has a small aggregate byte budget. Skip a predictably rejected teardown
      // request; the user-facing save pipeline remains responsible for surfacing any unsaved state.
      return null
    }
    return this.postBatch(body, ops.length, opts)
  }

  // updatedAt on the wire is a concurrency precondition: rebase each PUT onto the last authoritative
  // server revision while retaining every locally edited field. A Map per touched table keeps this
  // O(ops + rows) — a linear .find per op degraded a whole-table re-timestamp (undo/redo touching
  // every allocation) to O(ops × rows) on the hot save path. Maps are built lazily, so a batch that
  // touches one table never indexes the rest.
  private rebaseForWire(ops: Op[]): Op[] {
    const indexByTable = new Map<Op['table'], Map<string, { updatedAt: string }>>()
    const indexFor = (table: Op['table']): Map<string, { updatedAt: string }> => {
      let index = indexByTable.get(table)
      if (!index) {
        index = new Map(this.lastSynced[table].map((row) => [row.id, row] as const))
        indexByTable.set(table, index)
      }
      return index
    }
    return ops.map((op) => {
      if (op.method !== 'PUT' || !op.row) return op
      const existing = indexFor(op.table).get(op.id)
      return existing ? { ...op, row: { ...op.row, updatedAt: existing.updatedAt } } : op
    })
  }

  // POST the complete ≤MAX_OPS_PER_BATCH diff to /api/batch; the server applies it in one
  // transaction (upserts parent-first, then deletes child-first — see syncOps.diffOps), so a
  // mid-batch failure rolls the whole transaction back. keepalive (unload) lets the request outlive
  // the page. `body` is the already-serialized, PUT-rebased wire payload; `opCount` is the op total
  // the server receipt must echo back.
  private async postBatch(
    body: string,
    opCount: number,
    opts?: { keepalive?: boolean },
  ): Promise<CommittedRevision[]> {
    const res = await this.request(
      `${this.baseUrl}/api/batch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: opts?.keepalive,
        credentials: 'include',
      },
      // The atomic write is a BULK op: give it the long bound so a big-but-healthy batch isn't
      // aborted into the retry-the-same-diff wedge (drain never advances lastSynced on abort).
      // The keepalive unload flush gets NO deadline — a timeout on a request meant to outlive the
      // page is self-contradictory; it's best-effort and errors are swallowed anyway.
      opts?.keepalive ? null : API_BULK_TIMEOUT_MS,
    )
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
    const receipt = (await res.json().catch(() => null)) as { ok?: unknown; applied?: unknown; revisions?: unknown; auditWarning?: unknown } | null
    if (receipt?.ok !== true || receipt.applied !== opCount) {
      throw new Error('Batch sync returned an invalid commit receipt.')
    }
    if (receipt.auditWarning === true || res.headers.get('x-capacitylens-audit-warning') === 'true') {
      announceAuditWarning()
    }
    if (!Array.isArray(receipt.revisions)) return [] // compatibility with older servers
    const knownTables = emptyAppData() // hoisted: one shape probe for the whole receipt, not one per revision
    const revisions = receipt.revisions.filter((revision): revision is CommittedRevision => {
      if (!revision || typeof revision !== 'object') return false
      const value = revision as Partial<CommittedRevision>
      return typeof value.table === 'string' && Object.hasOwn(knownTables, value.table) &&
        typeof value.id === 'string' && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string'
    })
    if (revisions.length !== receipt.revisions.length) {
      throw new Error('Batch sync returned invalid server revisions.')
    }
    return revisions
  }
}

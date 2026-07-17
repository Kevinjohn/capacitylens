import { LoadError, type PersistenceAdapter } from './PersistenceAdapter'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { AppData, Entity } from '@capacitylens/shared/types/entities'
import { KNOWN_KEYS, migrate } from '@capacitylens/shared/data/migrate'
import { isLifecycleEntityKey } from '@capacitylens/shared/domain/lifecycle'
import { diffOps, type Op } from './syncOps'
import { announceAuditWarning } from '../lib/auditWarning'
import {
  cacheAccountSlice,
  readCachedAccountSlice,
  readCachedAuthSnapshot,
  setOfflineReadState,
} from './offlineCache'
import { requestSignal, API_REQUEST_TIMEOUT_MS, API_BULK_TIMEOUT_MS } from './requestTimeout'
import { validateAccountSlice } from './validateAccountSlice'

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

// Re-insert lifecycle rows whose out-of-batch archive did NOT converge back into `data`, so the
// NEXT diff re-emits their DELETE and the adapter keeps trying (rather than silently dropping the
// deletion intent by advancing the snapshot past an archive that never landed). Append-if-absent —
// a defensive no-dup guard; the row is the pre-delete copy read from the current snapshot.
function restoreRows(data: AppData, rows: Array<{ table: Op['table']; row: Entity }>): AppData {
  if (rows.length === 0) return data
  const next = { ...data }
  for (const { table, row } of rows) {
    const list = next[table] as Entity[]
    if (!list.some((existing) => existing.id === row.id)) next[table] = [...list, row] as never
  }
  return next
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

export class KeepaliveNotDispatchedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeepaliveNotDispatchedError'
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
      // DEPLOYMENT CONTRACT (rolling deploy — new client, older server): a version-skewed OLDER
      // server may OMIT a table key this newer client already knows about. A MISSING key is
      // TOLERATED on BOTH read paths — the unscoped migrate()/normalize hydrates it empty, and the
      // scoped path pre-fills it empty below so validateAccountSlice hydrates it empty too — so a
      // new-client/old-server skew is not a total outage on every deploy, and an account switch or
      // scoped load during a version-skew window no longer throws "incomplete state payload". But a
      // key that is PRESENT and NOT an array is a corrupt/incomplete payload masquerading as empty
      // data, so it stays a HARD failure on both paths. (Same principle as the import path's
      // hasNonArrayKnownTable: repair within a record, reject a structurally broken one — never coerce
      // a broken table to [] and report it as success.) The cross-tenant (wrong accountId) checks
      // inside validateAccountSlice keep their FULL strictness regardless.
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error('The server returned an invalid state payload.')
      }
      const record = json as Record<string, unknown>
      if (KNOWN_KEYS.some((key) => key in record && !Array.isArray(record[key]))) {
        throw new Error('The server returned an invalid state payload.')
      }
      // A missing known key is tolerated (hydrated empty) but DIAGNOSABLE: warn ONCE per load, naming
      // every omitted table. A rolling-deploy skew (new client, older server) is the expected benign
      // cause; the SAME warning against a same-version server is the signal that a proxy or server bug
      // silently dropped a table — without this it would load as "empty" invisibly and be undiagnosable.
      const missingKeys = KNOWN_KEYS.filter((key) => !(key in record))
      if (missingKeys.length > 0) {
        console.warn(
          `ServerSyncAdapter: the server state payload omitted known table(s) [${missingKeys.join(', ')}]; ` +
            'hydrating them empty. Expected during a rolling deploy (new client, older server); if the ' +
            'server is the SAME version, a proxy or server bug dropped the table(s).',
        )
      }
      // Scoped path: pre-fill any missing known table as an empty array so validateAccountSlice
      // hydrates it empty instead of hard-failing "incomplete" (its per-key Array.isArray check treats
      // an ABSENT key as a reject). We do this in the scoped BRANCH rather than in validateAccountSlice
      // itself because other callers of that validator (fetchInactiveSlice's backup/export path) rely
      // on its full-completeness contract. Present-but-non-array was already rejected above; the
      // accountId cross-tenant checks still run at full strictness on the real rows.
      const scopedInput =
        missingKeys.length > 0
          ? { ...record, ...Object.fromEntries(missingKeys.map((key) => [key, [] as unknown[]])) }
          : record
      const data = accountId === undefined ? migrate(json) : validateAccountSlice(scopedInput, accountId)
      if (!data) throw new Error('The server returned a cross-tenant or incomplete state payload.')
      // Re-seed the diff snapshot to the SLICE we just loaded (atomic with the load — see the
      // method doc). A switch orchestrator calling loadAll(newId) gets lastSynced === the new
      // account's slice, so the immediately-following saveAll diffs new-vs-new = ZERO ops, never
      // cross-account deletes. Generation-guarded: a SUPERSEDED load (a newer loadAll started
      // while this fetch was in flight) must not seed — its slice is discarded by persist.ts's
      // token guard, and seeding here anyway would desync snapshot from data (see loadGen).
      if (myGen === this.loadGen) {
        this.lastSynced = data
        this.seedGen += 1 // announce the seed to drain() — see the seedGen doc
        setOfflineReadState(false)
        if (accountId !== undefined) {
          void cacheAccountSlice(accountId, data).catch((error) =>
            console.warn('ServerSyncAdapter: the offline account snapshot could not be updated', error),
          )
        }
      }
      return data
    } catch (e) {
      const transportFailure =
        e instanceof OfflineEligibleLoadError ||
        e instanceof TypeError ||
        (e instanceof DOMException && e.name === 'AbortError')
      if (accountId === undefined && transportFailure) {
        try {
          const cachedIdentity = await readCachedAuthSnapshot({ acceptEffects: () => myGen === this.loadGen })
          if (cachedIdentity) {
            const empty = emptyAppData()
            if (myGen === this.loadGen) {
              this.lastSynced = empty
              this.seedGen += 1
            }
            if (myGen === this.loadGen) setOfflineReadState(true, cachedIdentity.savedAt)
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
            if (myGen === this.loadGen) setOfflineReadState(true, cached.savedAt)
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
    const json: unknown = await res.json()
    if (
      !json || typeof json !== 'object' || Array.isArray(json) ||
      typeof (json as { hasData?: unknown }).hasData !== 'boolean'
    ) {
      throw new Error('The server returned an invalid meta payload.')
    }
    return (json as { hasData: boolean }).hasData
  }

  async saveAll(next: AppData, opts?: { unload?: boolean }): Promise<void> {
    // Page-teardown flush: send the whole diff as ONE keepalive batch request so it
    // survives the unload (a plain fetch would be cancelled mid-flight). See applyBatch.
    if (opts?.unload) {
      if (this.inFlight) {
        // drain() has already dispatched its current target. Do not merely park this newer
        // snapshot behind that ordinary request: page teardown can terminate the tab before the
        // drain gets another turn. Clear any older parked target and synchronously dispatch the
        // latest complete delta as a keepalive request. The complete lastSynced→next diff is
        // intentional: it remains self-contained if the earlier request is lost in transit.
        this.queued = null
        const ordinaryFlush = this.inFlight
        const teardownFlush = this.flushUnload(next)
        await Promise.all([ordinaryFlush, teardownFlush])
        return
      }
      return this.flushUnload(next)
    }
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

  // Final flush on page teardown: one keepalive batch request. Errors propagate to the persistence
  // orchestrator so a page that survives (for example via bfcache) can surface and retry them.
  // Deliberately does NOT advance lastSynced. One ordered, atomic request, so the
  // FK-order race the old per-op Promise.all had on a new-parent+child pair is gone.
  private async flushUnload(next: AppData): Promise<void> {
    const ops = diffOps(this.lastSynced, next)
    const { batchOps, lifecycleDeletes } = this.splitLifecycleDeletes(ops)
    // Dispatch the atomic batch FIRST so any reparent/upsert it carries at least reaches the wire
    // before the lifecycle deletes below (mirrors drain's upserts-before-deletes). applyBatch is
    // async, so an over-budget batch REJECTS the returned promise rather than throwing synchronously —
    // the lifecycle deletes still fire before we surface that rejection via `await`.
    const batchFlush =
      batchOps.length > 0 ? this.applyBatch(batchOps, { keepalive: true }) : Promise.resolve(null)
    // A lifecycle-entity delete cannot ride the keepalive batch (the server 400-rejects a lifecycle
    // DELETE, which would poison the WHOLE teardown request). Converge it BEST-EFFORT instead: fire a
    // SINGLE archive keepalive POST per pending lifecycle delete (archive-only, exactly like
    // archiveLifecycleRow — one round-trip, no two-step chain). fire-and-forget (no await — a dying
    // page cannot act on the result). If the page dies before the request leaves, the row resurfaces
    // next session (lastSynced is in-memory and dies with the page, so the intent is NOT preserved) —
    // an accepted residual risk, strictly better than the guaranteed loss of dropping it entirely.
    // Never blocks or prompts on unload.
    for (const op of lifecycleDeletes) this.keepaliveArchiveLifecycleRow(op)
    await batchFlush
  }

  // Best-effort keepalive convergence of ONE sync-originated lifecycle deletion on page teardown:
  // ARCHIVE-ONLY (see archiveLifecycleRow's policy), a single POST with keepalive set and NO timeout
  // deadline (a request meant to outlive the page must not carry one). Fire-and-forget; its rejection
  // is swallowed — teardown has nowhere to surface it, and a surviving reload re-diffs against the
  // source of truth (the DEFENSIVE-CODING §5 page-teardown swallow). If the page dies first the archive
  // may never fire and the row resurfaces next session (the accepted residual risk noted in flushUnload).
  private keepaliveArchiveLifecycleRow(op: Op): void {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: op.accountId }),
      credentials: 'include',
      keepalive: true,
    }
    void this.request(`${this.baseUrl}/api/${op.table}/${encodeURIComponent(op.id)}/archive`, init, null).catch(() => {})
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
      // Lifecycle-entity deletes (clients/projects/resources) CANNOT ride the atomic batch — the
      // server 400-rejects them, which would poison the whole batch and permanently strand every
      // later edit re-including the poisoned op. Split them out and converge them by ARCHIVING through
      // the dedicated archive route AFTER the batch (see archiveLifecycleRow for the archive-only
      // policy), so any reparent/upsert the same diff carries (e.g. a child moved off the row being
      // deleted) lands first — mirroring the batch's own upserts-before-deletes invariant across the split.
      const { batchOps, lifecycleDeletes } = this.splitLifecycleDeletes(ops)
      // The ABSENCE of a try/catch around applyBatch is INTENTIONAL — do not "harden" it. An
      // applyBatch throw MUST propagate (below, before the snapshot advances) so saveAll rejects,
      // persist.ts surfaces it (persistError) and retries, and lastSynced is NOT advanced. Swallowing
      // here would advance lastSynced past writes that never landed, silently dropping them from every
      // future diff — permanent data loss. (The lifecycle-delete loop below has a try/catch, but it
      // does NOT swallow: it records un-converged rows, advances only the parts that DID land, then
      // RE-THROWS — no committed write is ever skipped from a future diff.)
      let committedTarget = canonicalTarget
      if (batchOps.length > 0) {
        const revisions = await this.applyBatch(batchOps)
        if (revisions) {
          this.rememberRevisions(batchOps, revisions)
          committedTarget = applyCommittedRevisions(canonicalTarget, revisions)
        }
      }
      // Drive the lifecycle deletes one row at a time by ARCHIVING (the batch above has already
      // committed all ordinary ops, so a stuck archive can never block them). A row whose archive does
      // NOT converge is RESTORED into the advanced snapshot so the NEXT diff re-emits its delete
      // (retry); the rows that DID converge (archived) stay absent. The FIRST failure is surfaced via
      // the normal save-error path (persist banner + retry) — after the snapshot advances, so the
      // committed batch and the converged archives are never replayed.
      let lifecycleError: unknown = null
      const unconverged: Array<{ table: Op['table']; row: Entity }> = []
      for (const op of lifecycleDeletes) {
        try {
          await this.archiveLifecycleRow(op)
        } catch (e) {
          if (lifecycleError === null) lifecycleError = e
          const row = (this.lastSynced[op.table] as Entity[]).find((r) => r.id === op.id)
          if (row) unconverged.push({ table: op.table, row })
        }
      }
      committedTarget = restoreRows(committedTarget, unconverged)
      // Advance the snapshot ONLY if no seed landed while this batch was in flight — a reload's
      // fresh seed must win over our pre-reload target, or snapshot and store desync. Checked via
      // seedGen, NOT loadGen: loadGen bumps at fetch START, so a load already in flight when this
      // diff was taken would pass a start-generation check and still seed mid-batch. Skipping is
      // safe: the server already holds these idempotent ops, so the next diff re-derives anything
      // still relevant against the fresh seed.
      if (targetSeedGen === this.seedGen) this.lastSynced = committedTarget
      // Surface a lifecycle-archive failure LAST — after the snapshot advanced — so unrelated ops are
      // never blocked (they committed above and won't replay) and only the un-converged row's delete
      // re-fires on the next diff.
      if (lifecycleError !== null) throw lifecycleError
    }
  }

  // The server 400-REJECTS a batch DELETE of a lifecycle entity (clients/projects/resources) — those
  // deletions must converge through the dedicated archive route instead (see archiveLifecycleRow).
  // Partition an op set into the atomic-batch ops and the lifecycle deletes the caller drives
  // out-of-band by archiving (see drain/flushUnload).
  private splitLifecycleDeletes(ops: Op[]): { batchOps: Op[]; lifecycleDeletes: Op[] } {
    const batchOps: Op[] = []
    const lifecycleDeletes: Op[] = []
    for (const op of ops) {
      if (op.method === 'DELETE' && isLifecycleEntityKey(op.table)) lifecycleDeletes.push(op)
      else batchOps.push(op)
    }
    return { batchOps, lifecycleDeletes }
  }

  // Converge a sync-originated lifecycle-entity disappearance (clients/projects/resources) by ARCHIVING
  // the row through the dedicated POST /api/{table}/{id}/archive route. It cannot ride the atomic batch
  // (POST /api/batch 400-rejects a lifecycle DELETE op, to keep the retained-tombstone data-lifecycle
  // from being bypassed).
  //
  // POLICY — ARCHIVE-ONLY from the sync layer (deliberately NOT soft-delete): a lifecycle DELETE that
  // originates from ordinary syncing (e.g. undo of a just-synced create) parks the row as ARCHIVED on
  // the server. Archive is action 'write' — allowed to every role that can create the row (editor+) and
  // NEVER freshness-gated — so background sync, which has no re-auth/step-up UI, can always complete it.
  // It is also REVERSIBLE (unarchive restores the row). Soft-delete and purge are deliberately NOT
  // emitted by sync: soft-delete is IRREVERSIBLE (for resources it destroys PII via obfuscateResource,
  // and there is no tombstone→active restore path in shared/src/domain/lifecycle.ts), admin-gated AND
  // freshness/step-up gated — it stays a deliberate UI action only. RESIDUAL (accepted): the row lingers
  // in the account's ARCHIVED list rather than vanishing server-side; the local view already hides it.
  //
  // Idempotent/convergent status handling: a 409 (already archived — a retry after a partial success or
  // a concurrent archive) and a 404 (row already gone from this account) are BOTH the intended
  // out-of-active end state, so they count as CONVERGED — surfacing them would re-poison every future
  // diff with a delete that can never "succeed". Any OTHER non-ok is a real, surfaced failure; a THROWN
  // fetch (network/abort) also propagates — the whole save fails and retries alone when healthy.
  private async archiveLifecycleRow(op: Op): Promise<void> {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: op.accountId }),
      credentials: 'include',
    }
    const res = await this.request(`${this.baseUrl}/api/${op.table}/${encodeURIComponent(op.id)}/archive`, init)
    if (res.status === 409 || res.status === 404) return
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Lifecycle archive of ${op.table}/${op.id} failed (${res.status}) ${detail}`.trim())
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
      throw new KeepaliveNotDispatchedError('The pending change was too large for a page-teardown keepalive request.')
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

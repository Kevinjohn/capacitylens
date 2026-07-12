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

// The server hard-rejects batches over MAX_BATCH_OPS = 5000 ops (see server/src/app.ts), and an
// in-app import can legitimately produce tens of thousands of ops (fresh ids per record + deletes
// of the replaced slice) — an unchunked POST would 400 deterministically forever, losing the
// import on reload. 2000 leaves headroom under the server cap and bounds the server's
// per-request loadState/validate work. Exported for the chunking tests.
export const MAX_OPS_PER_BATCH = 2000

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
        this.lastSynced = empty
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
      const data = migrate(json)
      // Re-seed the diff snapshot to the SLICE we just loaded (atomic with the load — see the
      // method doc). A switch orchestrator calling loadAll(newId) gets lastSynced === the new
      // account's slice, so the immediately-following saveAll diffs new-vs-new = ZERO ops, never
      // cross-account deletes.
      this.lastSynced = data
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
      // The ABSENCE of a try/catch here is INTENTIONAL — do not "harden" it. An applyBatch throw
      // MUST propagate so saveAll rejects, persist.ts surfaces it (persistError) and retries, and
      // lastSynced is NOT advanced. Swallowing here would advance lastSynced past writes that never
      // landed, silently dropping them from every future diff — permanent data loss.
      if (ops.length > 0) await this.applyBatch(ops)
      this.lastSynced = target
    }
  }

  // Apply the ordered ops to /api/batch in chunks of MAX_OPS_PER_BATCH (the server caps a request
  // at MAX_BATCH_OPS = 5000 — an unchunked large import would 400 forever).
  //
  // The atomicity trade, honestly: each CHUNK is one server-side transaction, so a mid-sequence
  // failure leaves a PARTIAL write on the server. That is safe here because ops are idempotent
  // upserts/deletes, lastSynced advances (in drain) only after ALL chunks land, and a failure
  // throws so the retry re-sends the FULL remaining diff. Ordering is preserved across chunks:
  // diffOps emits ALL upserts (parent-first) before ALL deletes (child-first) in one ordered list
  // (verified in syncOps.ts — `[...upserts, ...deletes]`), and consecutive slices of that list
  // POSTed strictly sequentially keep the global order, so a reparent's new binding still lands
  // before the old parent's delete even when they fall into different chunks.
  private async applyBatch(ops: Op[], opts?: { keepalive?: boolean }): Promise<void> {
    const chunks: Op[][] = []
    for (let i = 0; i < ops.length; i += MAX_OPS_PER_BATCH) chunks.push(ops.slice(i, i + MAX_OPS_PER_BATCH))
    if (opts?.keepalive) {
      // Page teardown: dispatch EVERY chunk up-front, no await between dispatches — awaiting
      // sequentially would get only the first chunk on the wire before the event loop dies (the
      // same dispatch-all rationale as persist.ts's flushOnUnload). Cross-chunk arrival order is
      // NOT guaranteed here, which is acceptable for this best-effort final flush: errors are
      // swallowed by the caller, lastSynced never advances on this path, and a surviving reload
      // re-diffs against the server. Chunking helps here anyway — keepalive caps each request
      // body at ~64KB, so smaller bodies give more of the flush a chance to survive.
      await Promise.all(chunks.map((chunk) => this.postBatch(chunk, { keepalive: true })))
      return
    }
    // Normal drain: strictly sequential so the global upserts-before-deletes order holds server-side.
    for (const chunk of chunks) await this.postBatch(chunk)
  }

  // POST one ≤MAX_OPS_PER_BATCH slice of ops to /api/batch; the server applies it in one
  // transaction (upserts parent-first, then deletes child-first — see syncOps.diffOps), so a
  // mid-batch failure rolls the whole chunk back. keepalive (unload) lets the request outlive
  // the page.
  private async postBatch(ops: Op[], opts?: { keepalive?: boolean }): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops }),
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
  }
}

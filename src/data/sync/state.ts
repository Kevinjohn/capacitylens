import type { AppData } from "@capacitylens/shared/types/entities";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { type AllocationRewriteRevision } from "../PersistenceAdapter";
import { API_REQUEST_TIMEOUT_MS, requestSignal } from "../requestTimeout";
import { type AcknowledgedRevision } from "./revisions";

// One live owner per adapter. Async operations always read this object after awaits;
// tenant generations and request ordering must never be captured as a state snapshot.
export class SyncState {
  readonly baseUrl: string;
  readonly fetchImpl: typeof fetch;
  // The last state confirmed fully synced to the server; every diff is computed
  // against it and it only advances on a fully successful flush.
  lastSynced: AppData = emptyAppData();
  // Coalesce-to-latest: while a flush is in flight, newer saves just park here and
  // the running flush picks them up. One write path, no overlapping requests.
  queued: AppData | null = null;
  inFlight: Promise<void> | null = null;
  /** Target already on the wire but not yet fully acknowledged. During an overlapping teardown,
   * either this target or lastSynced may be the server's current state. */
  dispatchedTarget: AppData | null = null;
  // Load generation counter: bumped at the START of every loadAll. A loadAll that is no longer
  // the newest by the time its fetch resolves must NOT seed `lastSynced` — persist.ts's token
  // guard discards that stale slice from the STORE, but without this guard the adapter snapshot
  // would still be mutated, leaving snapshot=stale-account while data=newer-account, and the next
  // save would diff across tenants (DELETEs for the stale account + PUTs for the newer one —
  // cross-account data loss).
  loadGen = 0;
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
  seedGen = 0;
  /** Tenant paired with the current scoped snapshot. Null means the snapshot came from the
   * unscoped OFF/demo bootstrap path. A scoped save must match this tenant before diffing. */
  seededAccountId: string | null = null;
  // The seedGen at the moment `queued` was last written — pairs a parked save with the snapshot
  // generation it was diffed-to-be against.
  queuedSeedGen = 0;
  acknowledgedRevisions = new Map<string, AcknowledgedRevision>();
  allocationRewriteHandler: ((revisions: readonly AllocationRewriteRevision[]) => void) | null = null;
  /** Lifecycle rows this adapter successfully archived after a local disappearance. If the same id
   * returns through undo/redo, it must be unarchived before ordinary descendant writes can land. */
  archivedBySync = new Set<string>();
  // Every adapter instance is one browser sync session. Monotonic request sequences let the server
  // order a newer pagehide batch against an older ordinary batch even when the network reverses
  // their arrival. The id contains no user/device data and is never persisted client-side.
  readonly syncSessionId = crypto.randomUUID();
  nextSyncSequence = 1;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch.bind(globalThis)) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  request(
    input: RequestInfo | URL,
    init: RequestInit = {},
    timeoutMs: number | null = API_REQUEST_TIMEOUT_MS,
  ): Promise<Response> {
    // Share the one request-timeout/abort seam (requestSignal) with the rest of the API surface —
    // same AbortSignal.any fallback for engines that lack it — instead of a second hand-rolled copy
    // that could drift. `timeoutMs` picks the tier: interactive 15s by default, the longer bulk
    // bound for whole-slice load/batch, or `null` (no deadline) for the keepalive unload flush.
    return this.fetchImpl(input, {
      ...init,
      signal: requestSignal(init.signal, timeoutMs),
    });
  }
}

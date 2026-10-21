import type { AppData } from "@capacitylens/shared/types/entities";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { CommittedRowRevision, AllocationRewriteRevision } from "@/data/PersistenceAdapter";
import { API_REQUEST_TIMEOUT_MS, createRequestSignal } from "@/data/requestTimeout";
import type { AcknowledgedRevision } from "./revisions";

// One live owner per adapter. Async operations always read this object after awaits;
// tenant generations and request ordering must never be captured as a state snapshot.
/** Mutable live state for one adapter owner. Async operations must re-read generations and ordering after awaits. */
export class SyncState {
  readonly baseUrl: string;
  readonly fetchImpl: typeof fetch;
  // The baseline for subsequent diffs includes confirmed writes and retains rows whose lifecycle archives failed so their removal remains retryable.
  lastSynced: AppData = emptyAppData();
  // Ordinary saves coalesce to the latest queued target while a flush is in flight. Teardown may dispatch an ordered successor request concurrently.
  queued: AppData | null = null;
  inFlight: Promise<void> | null = null;
  /** Target already on the wire but not yet fully acknowledged. During an overlapping teardown,
   * either this target or lastSynced may be the server's current state. */
  dispatchedTarget: AppData | null = null;
  // A superseded load must not seed the baseline or later saves could diff across tenants.
  loadGen = 0;
  // A seed generation change invalidates queued diffs and prevents a completed flush from replacing a newer loaded baseline. Persistence surfaces or rebases any edits affected by that change.
  seedGen = 0;
  /** Tenant paired with the current scoped snapshot. Null means the snapshot came from the
   * unscoped off/demo bootstrap path. A scoped save must match this tenant before diffing. */
  seededAccountId: string | null = null;
  // Pair a queued target with the generation of its diff baseline.
  queuedSeedGen = 0;
  acknowledgedRevisions = new Map<string, AcknowledgedRevision>();
  committedRevisionHandler: ((revisions: readonly CommittedRowRevision[]) => void) | null = null;
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
    requestOptions: RequestInit = {},
    timeoutMs: number | null = API_REQUEST_TIMEOUT_MS,
  ): Promise<Response> {
    // Share the request-signal builder so adapter deadlines match the rest of the API.
    // Keepalive teardown disables the client deadline.
    return this.fetchImpl(input, {
      ...requestOptions,
      signal: createRequestSignal(requestOptions.signal, timeoutMs),
    });
  }
}

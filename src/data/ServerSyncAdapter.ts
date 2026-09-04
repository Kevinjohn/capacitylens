import type { AppData, Entity } from "@capacitylens/shared/types/entities";
import { SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import { type AllocationRewriteRevision, type PersistenceAdapter } from "./PersistenceAdapter";
import {
  KEEPALIVE_BODY_BUDGET,
  KEEPALIVE_REQUEST_OVERHEAD_BUDGET,
  KeepaliveNotDispatchedError,
} from "./sync/batchErrors";
import { applyBatch, dispatchPreparedBatch, prepareBatchBody } from "./sync/batchWire";
import {
  archiveLifecycleRow,
  rememberedLifecycleRestoreOps,
  rememberLifecycleArchives,
  restoreRememberedLifecycleRows,
  splitLifecycleDeletes,
} from "./sync/lifecycleOps";
import { hasExisting, loadAll } from "./sync/loadSlice";
import { applyCommittedRevisions, writeRows, type BatchCommitReceipt } from "./sync/revisions";
import {
  canonicalizeAcknowledged,
  pruneAcknowledgedRevisions,
  publishAllocationRewrites,
  rememberRevisions,
} from "./sync/snapshot";
import { SyncState } from "./sync/state";
import { diffOps, diffOpsFromPossibleBases, type Op } from "./syncOps";

// diffOps/applyOps now live in ./syncOps (the pure diff/apply core). Re-exported here
// so existing import sites (e.g. ServerSyncAdapter.test.ts) keep resolving them from
// this module unchanged.
export { applyOps, diffOps } from "./syncOps";

export {
  BatchCommitUncertainError,
  BatchConflictError,
  BatchMasqueradeReadOnlyError,
  BatchReconciliationError,
  BatchTooLargeError,
  BatchValidationError,
  KeepaliveNotDispatchedError,
  LifecycleRestoreError,
  MAX_OPS_PER_BATCH,
} from "./sync/batchErrors";

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

export class ServerSyncAdapter implements PersistenceAdapter {
  private readonly state: SyncState;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch.bind(globalThis)) {
    this.state = new SyncState(baseUrl, fetchImpl);
  }

  loadAll(accountId?: string): Promise<AppData> {
    return loadAll(this.state, (next) => this.saveAll(next), accountId);
  }

  hasExisting(): Promise<boolean> {
    return hasExisting(this.state);
  }

  setAllocationRewriteHandler(handler: ((revisions: readonly AllocationRewriteRevision[]) => void) | null): void {
    this.state.allocationRewriteHandler = handler;
  }

  async saveAll(next: AppData, opts?: { unload?: boolean }): Promise<void> {
    if (this.state.seededAccountId !== null) {
      const expected = this.state.seededAccountId;
      const mismatchedAccount = next.accounts.some((account) => account.id !== expected);
      const mismatchedScopedRow = SCOPED_KEYS.some((table) => next[table].some((row) => row.accountId !== expected));
      if (mismatchedAccount || mismatchedScopedRow) {
        throw new Error("The pending changes do not belong to the active company.");
      }
    }
    // Page-teardown flush: send the whole diff as ONE keepalive batch request so it
    // survives the unload (a plain fetch would be cancelled mid-flight). See applyBatch.
    if (opts?.unload) {
      if (this.state.inFlight) {
        // drain() has already dispatched its current target. Do not merely park this newer
        // snapshot behind that ordinary request: page teardown can terminate the tab before the
        // drain gets another turn. Clear any older parked target and synchronously dispatch the
        // latest complete delta as a keepalive request. The complete lastSynced→next diff is
        // intentional: it remains self-contained if the earlier request is lost in transit.
        this.state.queued = null;
        const ordinaryFlush = this.state.inFlight;
        const teardownFlush = this.flushUnload(next);
        await Promise.all([ordinaryFlush, teardownFlush]);
        return;
      }
      return this.flushUnload(next);
    }
    this.state.queued = next;
    this.state.queuedSeedGen = this.state.seedGen; // pair the parked save with the snapshot it was made against
    if (this.state.inFlight) return this.state.inFlight;
    this.state.inFlight = this.drain();
    try {
      await this.state.inFlight;
    } finally {
      this.state.inFlight = null;
    }
  }

  // Final flush on page teardown: dispatch one ordered keepalive batch containing ordinary writes
  // and lifecycle archives. Errors propagate to the persistence orchestrator so a page that
  // survives (for example via bfcache) remains dirty and can surface/retry them. Deliberately does
  // NOT advance lastSynced. One atomic final-state request closes both the FK-order race and the
  // cross-request lifecycle resurrection race.
  private async flushUnload(next: AppData): Promise<void> {
    const canonicalTarget = canonicalizeAcknowledged(this.state, next);
    const possibleBases = this.state.dispatchedTarget
      ? [this.state.lastSynced, this.state.dispatchedTarget]
      : [this.state.lastSynced];
    const ops = diffOpsFromPossibleBases(possibleBases, canonicalTarget);
    if (rememberedLifecycleRestoreOps(this.state, canonicalTarget).length > 0) {
      // Restoring an archive requires an ordered request/receipt before any dependent batch can be
      // constructed. A page-teardown keepalive cannot safely promise that second dispatch after the
      // page dies, so refuse explicitly; a surviving page retains the dirty state and retries through
      // the normal drain instead of sending a generic PUT that can never clear the tombstone.
      throw new KeepaliveNotDispatchedError(
        "A pending lifecycle restore requires the normal ordered sync path before page teardown.",
      );
    }
    const { batchOps, lifecycleDeletes } = splitLifecycleDeletes(ops);
    // Teardown must carry one complete successor state. Lifecycle disappearances become ARCHIVE
    // operations inside the same ordered transaction as ordinary writes, so the successor can
    // safely fence an older in-flight creation even if the network delivers it first.
    const orderedOps = [...batchOps, ...lifecycleDeletes];
    const batchBody =
      orderedOps.length > 0
        ? prepareBatchBody(this.state, orderedOps, { keepalive: true, archiveLifecycleDeletes: true })
        : null;
    const keepaliveBytes =
      batchBody === null ? 0 : new TextEncoder().encode(batchBody).byteLength + KEEPALIVE_REQUEST_OVERHEAD_BUDGET;
    if (keepaliveBytes > KEEPALIVE_BODY_BUDGET) {
      throw new KeepaliveNotDispatchedError(
        "The pending changes and lifecycle archives exceed the page-teardown keepalive budget.",
      );
    }
    if (batchBody === null) return;
    const receipt = await dispatchPreparedBatch(this.state, batchBody, orderedOps, {
      keepalive: true,
      archiveLifecycleDeletes: true,
    });
    if (!receipt.superseded) {
      rememberRevisions(this.state, batchOps, receipt.revisions, canonicalTarget);
      publishAllocationRewrites(this.state, receipt.revisions, canonicalTarget);
      rememberLifecycleArchives(this.state, lifecycleDeletes, receipt.archivedLifecycleKeys);
    }
  }

  // Drain the queue: diff against lastSynced and apply the whole delta as ONE
  // transactional batch (the server runs it in a single tx → all-or-nothing, ordered).
  // Advance lastSynced ONLY on success; on failure throw WITHOUT advancing, so persist.ts
  // surfaces it (persistError) and the next save replays the full delta — the batch is
  // idempotent (PUT upserts, DELETE no-ops on an absent id). Repeats until no newer state
  // arrived mid-flush (coalesce-to-latest). Atomicity replaces the old per-op poison-row
  // isolation: a bad row now fails the whole batch rather than leaving a partial write.
  private async drain(): Promise<void> {
    while (this.state.queued) {
      const target = this.state.queued;
      const targetSeedGen = this.state.queuedSeedGen;
      this.state.queued = null;
      // A reload SEEDED the snapshot after this save was queued: the state it was diffed-to-be
      // against no longer exists, and diffing it against the fresh seed could cross tenants
      // (see the seedGen doc). Reject rather than resolving the public save contract: persist can
      // surface/rebase the edit instead of treating an undispatched target as acknowledged.
      if (targetSeedGen !== this.state.seedGen) {
        throw new Error("The pending changes were superseded by a refreshed company snapshot.");
      }
      let canonicalTarget = canonicalizeAcknowledged(this.state, target);
      this.state.dispatchedTarget = canonicalTarget;
      let ops = diffOps(this.state.lastSynced, canonicalTarget);
      // A lifecycle row removed by a prior sync was archived, not deleted. Redo therefore cannot
      // recreate it with a generic PUT: the server deliberately pins archivedAt. Reverse those
      // remembered transitions parent-first, fold their authoritative revisions into the baseline,
      // then re-diff so the ordinary batch carries only genuine edits and descendants.
      try {
        // Keep the ordinary save path synchronous through its first network dispatch. That timing
        // lets an overlapping pagehide observe the in-flight request and immediately put its own
        // compensating keepalive on the wire. Only a real remembered restore needs this await.
        const restoreOps = rememberedLifecycleRestoreOps(this.state, canonicalTarget);
        const restored =
          restoreOps.length > 0 ? await restoreRememberedLifecycleRows(this.state, restoreOps, targetSeedGen) : false;
        if (targetSeedGen !== this.state.seedGen) {
          this.state.dispatchedTarget = null;
          continue;
        }
        if (restored) {
          canonicalTarget = canonicalizeAcknowledged(this.state, target);
          this.state.dispatchedTarget = canonicalTarget;
          ops = diffOps(this.state.lastSynced, canonicalTarget);
        }
      } catch (error) {
        this.state.dispatchedTarget = null;
        throw error;
      }
      // Lifecycle-entity deletes (clients/projects/resources) CANNOT ride the atomic batch — the
      // server 400-rejects them, which would poison the whole batch and permanently strand every
      // later edit re-including the poisoned op. Split them out and converge them by ARCHIVING through
      // the dedicated archive route AFTER the batch (see archiveLifecycleRow for the archive-only
      // policy), so any reparent/upsert the same diff carries (e.g. a child moved off the row being
      // deleted) lands first — mirroring the batch's own upserts-before-deletes invariant across the split.
      const { batchOps, lifecycleDeletes } = splitLifecycleDeletes(ops);
      // An applyBatch throw MUST propagate before the snapshot advances so saveAll rejects and
      // persist.ts either retries a transport failure or reloads after an uncertain receipt. The
      // narrow catch below clears only the no-longer-in-flight possible base and rethrows; swallowing
      // would advance past writes that never landed and permanently drop them from future diffs.
      let committedTarget = canonicalTarget;
      if (batchOps.length > 0) {
        let receipt: BatchCommitReceipt;
        try {
          receipt = await applyBatch(this.state, batchOps);
        } catch (error) {
          // The request has settled without an accepted receipt, so it is no longer an in-flight
          // possible base for a later teardown diff. An uncertain commit is resolved by the
          // persistence layer's authoritative reload before another write is accepted.
          this.state.dispatchedTarget = null;
          throw error;
        }
        if (receipt.superseded) {
          this.state.dispatchedTarget = null;
          continue;
        }
        if (targetSeedGen === this.state.seedGen) {
          rememberRevisions(this.state, batchOps, receipt.revisions, canonicalTarget);
          publishAllocationRewrites(this.state, receipt.revisions, canonicalTarget);
          committedTarget = applyCommittedRevisions(canonicalTarget, receipt.revisions);
        }
      }
      // Drive the lifecycle deletes one row at a time by ARCHIVING (the batch above has already
      // committed all ordinary ops, so a stuck archive can never block them). A row whose archive does
      // NOT converge is RESTORED into the advanced snapshot so the NEXT diff re-emits its delete
      // (retry); the rows that DID converge (archived) stay absent. The FIRST failure is surfaced via
      // the normal save-error path (persist banner + retry) — after the snapshot advances, so the
      // committed batch and the converged archives are never replayed.
      let lifecycleError: unknown = null;
      const unconverged: Array<{ table: Op["table"]; row: Entity }> = [];
      for (const op of lifecycleDeletes) {
        try {
          await archiveLifecycleRow(this.state, op);
        } catch (e) {
          if (lifecycleError === null) lifecycleError = e;
          const row = (this.state.lastSynced[op.table] as Entity[]).find((r) => r.id === op.id);
          if (row) unconverged.push({ table: op.table, row });
        }
      }
      // Re-insert lifecycle rows whose out-of-batch archive did NOT converge back into the advanced
      // snapshot, so the NEXT diff re-emits their DELETE and the adapter keeps trying (rather than
      // silently dropping the deletion intent by advancing past an archive that never landed). The
      // row is the pre-delete copy read from the current snapshot, so never overwrite a live one.
      committedTarget = writeRows(committedTarget, unconverged, { replaceExisting: false });
      // Advance the snapshot ONLY if no seed landed while this batch was in flight — a reload's
      // fresh seed must win over our pre-reload target, or snapshot and store desync. Checked via
      // seedGen, NOT loadGen: loadGen bumps at fetch START, so a load already in flight when this
      // diff was taken would pass a start-generation check and still seed mid-batch. Skipping is
      // safe: the server already holds these idempotent ops, so the next diff re-derives anything
      // still relevant against the fresh seed.
      if (targetSeedGen === this.state.seedGen) {
        this.state.lastSynced = committedTarget;
        pruneAcknowledgedRevisions(this.state, committedTarget);
      }
      this.state.dispatchedTarget = null;
      // Surface a lifecycle-archive failure LAST — after the snapshot advanced — so unrelated ops are
      // never blocked (they committed above and won't replay) and only the un-converged row's delete
      // re-fires on the next diff.
      if (lifecycleError !== null) throw lifecycleError;
    }
  }
}

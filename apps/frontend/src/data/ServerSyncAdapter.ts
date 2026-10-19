import type { AppData, Entity } from "@capacitylens/shared/types/entities";
import { SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import type { CommittedRowRevision, AllocationRewriteRevision, PersistenceAdapter } from "./PersistenceAdapter";
import {
  KEEPALIVE_BODY_BUDGET,
  KEEPALIVE_REQUEST_OVERHEAD_BUDGET,
  KeepaliveNotDispatchedError,
} from "./sync/batchErrors";
import { commitBatch, dispatchPreparedBatch, prepareBatchBody } from "./sync/batchWire";
import {
  archiveLifecycleRow,
  listRememberedLifecycleRestoreOps,
  rememberLifecycleArchives,
  restoreRememberedLifecycleRows,
  splitLifecycleDeletes,
} from "./sync/lifecycleOps";
import { loadAll, readHasExistingData } from "./sync/loadSlice";
import { applyCommittedRevisions, writeRows } from "./sync/revisions";
import type { BatchCommitReceipt } from "./sync/revisions";
import {
  canonicalizeAcknowledged,
  pruneAcknowledgedRevisions,
  publishAllocationRewrites,
  rememberRevisions,
} from "./sync/snapshot";
import { SyncState } from "./sync/SyncState";
import { diffOps, diffOpsFromPossibleBases } from "./syncOps";
import type { Op } from "./syncOps";

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
  MAX_BATCH_OPS,
} from "./sync/batchErrors";

interface DrainTarget {
  canonicalTarget: AppData;
  ops: Op[];
}

interface PreparedDrainTarget extends DrainTarget {
  restoreOps: Op[];
}

function prepareDrainTarget(state: SyncState, target: AppData): PreparedDrainTarget {
  const canonicalTarget = canonicalizeAcknowledged(state, target);
  state.dispatchedTarget = canonicalTarget;
  return {
    canonicalTarget,
    ops: diffOps(state.lastSynced, canonicalTarget),
    restoreOps: listRememberedLifecycleRestoreOps(state, canonicalTarget),
  };
}

interface RestoreDrainTargetInput {
  state: SyncState;
  target: AppData;
  prepared: PreparedDrainTarget;
  targetSeedGen: number;
}

async function restoreDrainTarget({
  state,
  target,
  prepared,
  targetSeedGen,
}: RestoreDrainTargetInput): Promise<DrainTarget | null> {
  try {
    const restored = await restoreRememberedLifecycleRows(state, prepared.restoreOps, targetSeedGen);
    if (targetSeedGen !== state.seedGen) {
      state.dispatchedTarget = null;
      return null;
    }
    if (!restored) return prepared;
    const canonicalTarget = canonicalizeAcknowledged(state, target);
    state.dispatchedTarget = canonicalTarget;
    return { canonicalTarget, ops: diffOps(state.lastSynced, canonicalTarget) };
  } catch (error) {
    // Clear the no-longer-in-flight target before propagating restore failure so later diffs do not use a phantom request baseline.
    state.dispatchedTarget = null;
    throw error;
  }
}

interface CommitOrdinaryOpsInput {
  state: SyncState;
  target: AppData;
  ops: Op[];
  targetSeedGen: number;
}

async function commitOrdinaryOps({
  state,
  target,
  ops,
  targetSeedGen,
}: CommitOrdinaryOpsInput): Promise<AppData | null> {
  if (ops.length === 0) return target;
  let receipt: BatchCommitReceipt;
  try {
    receipt = await commitBatch(state, ops);
  } catch (error) {
    // Clear the no-longer-in-flight target before propagating commit failure; never advance the confirmed baseline here.
    state.dispatchedTarget = null;
    throw error;
  }
  if (receipt.superseded) {
    state.dispatchedTarget = null;
    return null;
  }
  if (targetSeedGen !== state.seedGen) return target;
  rememberRevisions({ state, ops, revisions: receipt.revisions, committedSnapshot: target });
  publishAllocationRewrites(state, receipt.revisions, target);
  return applyCommittedRevisions(target, receipt.revisions);
}

interface LifecycleConvergence {
  committedTarget: AppData;
  error: unknown;
}

async function convergeLifecycleDeletes(
  state: SyncState,
  committedTarget: AppData,
  lifecycleDeletes: Op[],
): Promise<LifecycleConvergence> {
  let error: unknown = null;
  const unconverged: Array<{ table: Op["table"]; row: Entity }> = [];
  for (const op of lifecycleDeletes) {
    try {
      await archiveLifecycleRow(state, op);
    } catch (e) {
      // Remember the first archive failure while retaining failed rows in the baseline so only unconverged archives retry.
      if (error === null) error = e;
      const row: Entity | undefined = state.lastSynced[op.table].find((candidate) => candidate.id === op.id);
      if (row) unconverged.push({ table: op.table, row });
    }
  }
  return {
    committedTarget: writeRows(committedTarget, unconverged, { replaceExisting: false }),
    error,
  };
}

function throwLifecycleError(error: unknown): void {
  if (error === null) return;
  throw error instanceof Error
    ? error
    : new Error("Lifecycle archival failed with a non-Error value.", { cause: error });
}

/** Diffs complete snapshots because undo and redo supply a whole next state. Ordinary
 * writes commit in foreign-key order before lifecycle archives converge separately.
 * Acknowledged canonical revisions seed later diffs without overwriting newer edits.
 */

/** Persists account data through the server batch and refresh APIs. */
export class ServerSyncAdapter implements PersistenceAdapter {
  private readonly state: SyncState;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch.bind(globalThis)) {
    this.state = new SyncState(baseUrl, fetchImpl);
  }

  loadAll(accountId?: string, options?: { skipRemoteRead?: boolean }): Promise<AppData> {
    return loadAll(this.state, (next) => this.saveAll(next), { accountId, ...options });
  }

  hasExisting(): Promise<boolean> {
    return readHasExistingData(this.state);
  }

  setCommittedRevisionHandler(handler: ((revisions: readonly CommittedRowRevision[]) => void) | null): void {
    this.state.committedRevisionHandler = handler;
  }

  setAllocationRewriteHandler(handler: ((revisions: readonly AllocationRewriteRevision[]) => void) | null): void {
    this.state.allocationRewriteHandler = handler;
  }

  async saveAll(next: AppData, options?: { unload?: boolean }): Promise<void> {
    if (this.state.seededAccountId !== null) {
      const expected = this.state.seededAccountId;
      const mismatchedAccount = next.accounts.some((account) => account.id !== expected);
      const mismatchedScopedRow = SCOPED_KEYS.some((table) => next[table].some((row) => row.accountId !== expected));
      if (mismatchedAccount || mismatchedScopedRow) {
        throw new Error("The pending changes do not belong to the active company.");
      }
    }
    // Dispatch keepalive before teardown so the transport may finish after the page leaves.
    if (options?.unload) {
      if (this.state.inFlight) {
        // The final unload diff covers every possible in-flight baseline so it preserves the
        // complete latest intent regardless of which earlier request commits first.
        this.state.queued = null;
        const ordinaryFlush = this.state.inFlight;
        const teardownFlush = this.flushUnload(next);
        await Promise.all([ordinaryFlush, teardownFlush]);
        return;
      }
      return this.flushUnload(next);
    }
    this.state.queued = next;
    // Pair the pending target with its generation so an older account cannot seed the baseline.
    this.state.queuedSeedGen = this.state.seedGen;
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
  // not advance lastSynced. One atomic final-state request closes both the FK-order race and the
  // cross-request lifecycle resurrection race.
  private async flushUnload(next: AppData): Promise<void> {
    const canonicalTarget = canonicalizeAcknowledged(this.state, next);
    const possibleBases = this.state.dispatchedTarget
      ? [this.state.lastSynced, this.state.dispatchedTarget]
      : [this.state.lastSynced];
    const ops = diffOpsFromPossibleBases(possibleBases, canonicalTarget);
    if (listRememberedLifecycleRestoreOps(this.state, canonicalTarget).length > 0) {
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
    const receipt = await dispatchPreparedBatch({
      state: this.state,
      body: batchBody,
      ops: orderedOps,
      options: {
        keepalive: true,
        archiveLifecycleDeletes: true,
      },
    });
    if (!receipt.superseded) {
      rememberRevisions({
        state: this.state,
        ops: batchOps,
        revisions: receipt.revisions,
        committedSnapshot: canonicalTarget,
      });
      publishAllocationRewrites(this.state, receipt.revisions, canonicalTarget);
      rememberLifecycleArchives(this.state, lifecycleDeletes, receipt.archivedLifecycleKeys);
    }
  }

  // Ordinary operations commit atomically before lifecycle archives converge separately. Advance the baseline only for confirmed work and retain failed archives for retry; propagate failures to the persistence surface.
  private async drain(): Promise<void> {
    while (this.state.queued) {
      const target = this.state.queued;
      const targetSeedGen = this.state.queuedSeedGen;
      this.state.queued = null;
      // Reject an unsent target from an older generation so it cannot overwrite the newly loaded account.
      if (targetSeedGen !== this.state.seedGen) {
        throw new Error("The pending changes were superseded by a refreshed company snapshot.");
      }
      // A lifecycle row removed by a prior sync was archived, not deleted. Redo therefore cannot
      // recreate it with a generic PUT: the server deliberately pins archivedAt. Reverse those
      // remembered transitions parent-first, fold their authoritative revisions into the baseline,
      // then re-diff so the ordinary batch carries only genuine edits and descendants.
      // Prepare the target before yielding to the native client so an overlapping pagehide can
      // include this possible server basis in its compensating keepalive. Only a remembered
      // restore needs to wait for an earlier server receipt.
      const initialTarget = prepareDrainTarget(this.state, target);
      let prepared: DrainTarget | null = initialTarget;
      if (initialTarget.restoreOps.length > 0) {
        prepared = await restoreDrainTarget({ state: this.state, target, prepared: initialTarget, targetSeedGen });
      }
      if (!prepared) continue;
      // Commit ordinary edits before archiving parents so reparented children are not archived by the cascade.
      const { batchOps, lifecycleDeletes } = splitLifecycleDeletes(prepared.ops);
      // A failed ordinary commit must propagate before its target is acknowledged so persistence can retry or reload an uncertain receipt.
      const committedTarget = await commitOrdinaryOps({
        state: this.state,
        target: prepared.canonicalTarget,
        ops: batchOps,
        targetSeedGen,
      });
      if (!committedTarget) continue;
      // Drive the lifecycle deletes one row at a time by archiving (the batch above has already
      // committed all ordinary ops, so a stuck archive can never block them). A row whose archive does
      // not converge is restored into the advanced snapshot so the next diff re-emits its delete
      // (retry); the rows that did converge (archived) stay absent. The first failure is surfaced via
      // the normal save-error path (persist banner + retry), after the snapshot advances, so the
      // committed batch and the converged archives are never replayed.
      const convergence = await convergeLifecycleDeletes(this.state, committedTarget, lifecycleDeletes);
      // A newer load owns the baseline even when an earlier save finishes after it.
      if (targetSeedGen === this.state.seedGen) {
        this.state.lastSynced = convergence.committedTarget;
        pruneAcknowledgedRevisions(this.state, convergence.committedTarget);
      }
      this.state.dispatchedTarget = null;
      // Surface a lifecycle-archive failure last, after the snapshot advanced, so unrelated ops are
      // never blocked (they committed above and won't replay) and only the un-converged row's delete
      // re-fires on the next diff.
      throwLifecycleError(convergence.error);
    }
  }
}

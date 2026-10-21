import type { AppData, Entity } from "@capacitylens/shared/types/entities";
import type { AllocationRewriteRevision } from "@/data/PersistenceAdapter";
import type { Op } from "@/data/syncOps";
import { applyCommittedRevision, buildRowKey, rowKeyParts } from "./revisions";
import type { AcknowledgedRevision, CommittedRevision } from "./revisions";
import type { SyncState } from "./SyncState";

/** Regroup the flat key→translation map into table→(id→translation) once per pass, so a whole-table
 * scan can look rows up by plain id instead of composing a key string per row. */
export function buildAcknowledgedRevisionsByTable(
  state: SyncState,
): Map<keyof AppData, Map<string, AcknowledgedRevision>> {
  const acknowledgedRevisionsByTable = new Map<keyof AppData, Map<string, AcknowledgedRevision>>();
  for (const [key, acknowledged] of state.acknowledgedRevisions) {
    const [table, id] = rowKeyParts(key);
    let rows = acknowledgedRevisionsByTable.get(table as keyof AppData);
    if (!rows) {
      rows = new Map<string, AcknowledgedRevision>();
      acknowledgedRevisionsByTable.set(table as keyof AppData, rows);
    }
    rows.set(id, acknowledged);
  }
  return acknowledgedRevisionsByTable;
}

/** Returns a snapshot with matching client stamps translated to acknowledged server revisions without mutating the input. */
export function canonicalizeAcknowledged(state: SyncState, data: AppData): AppData {
  if (state.acknowledgedRevisions.size === 0) return data;
  let next = data;
  for (const [table, acknowledgedById] of buildAcknowledgedRevisionsByTable(state)) {
    const sourceRows = data[table];
    const canonicalRows = sourceRows.map((row) => {
      const acknowledged = acknowledgedById.get(row.id);
      if (!acknowledged || row.updatedAt !== acknowledged.client) return row;
      // Keep revision translations across diffs so unchanged client-stamped rows do not
      // emit phantom writes. A new client stamp stops matching, and rehydration clears
      // translations. Server content rewrites may also update the store through the rewrite handler.
      return applyCommittedRevision(row, acknowledged.server);
    });
    if (canonicalRows.some((row, index) => row !== sourceRows[index])) {
      next = { ...next, [table]: canonicalRows };
    }
  }
  return next;
}

/** Seeds the authoritative baseline and advances its generation. Clears prior
 * revision and lifecycle translations so reused client stamps cannot match stale receipts.
 */
export function seedSnapshot(state: SyncState, data: AppData, accountId?: string): void {
  state.lastSynced = data;
  state.seededAccountId = accountId ?? null;
  state.seedGen += 1;
  state.acknowledgedRevisions.clear();
  state.archivedBySync.clear();
}

interface RememberRevisionsInput {
  state: SyncState;
  ops: Op[];
  revisions: CommittedRevision[];
  committedSnapshot: AppData;
}

/** Records durable client-to-server revision translations using the flushed snapshot as the basis for content rewrites. */
export function rememberRevisions({ state, ops, revisions, committedSnapshot }: RememberRevisionsInput): void {
  const revisionsByRowKey = new Map(
    revisions
      .filter((revision) => revision.rewrite !== true)
      .map((revision) => [buildRowKey(revision.table, revision.id), revision]),
  );
  for (const op of ops) {
    if (op.method !== "PUT" || !op.row) continue;
    const key = buildRowKey(op.table, op.id);
    const server = revisionsByRowKey.get(key);
    if (server) {
      state.acknowledgedRevisions.set(key, {
        client: op.row.updatedAt,
        server,
      });
    }
  }
  const acknowledged = ops.flatMap((op) => {
    if (op.method !== "PUT" || !op.row) return [];
    const revision = revisionsByRowKey.get(buildRowKey(op.table, op.id));
    return revision ? [{ ...revision, flushedUpdatedAt: op.row.updatedAt }] : [];
  });
  if (acknowledged.length > 0) state.committedRevisionHandler?.(acknowledged);
  const rowsByTable = new Map<Op["table"], Map<string, Entity>>();
  for (const revision of revisions) {
    const key = buildRowKey(revision.table, revision.id);
    if (revision.rewrite !== true) continue;
    let rows = rowsByTable.get(revision.table);
    if (!rows) {
      rows = new Map((committedSnapshot[revision.table] as Entity[]).map((row) => [row.id, row]));
      rowsByTable.set(revision.table, rows);
    }
    const row = rows.get(revision.id);
    if (row) {
      state.acknowledgedRevisions.set(key, {
        client: row.updatedAt,
        server: revision,
      });
    }
  }
}

/** Publishes allocation content rewrites paired with the flushed row revision so consumers can preserve newer edits. */
export function publishAllocationRewrites(
  state: SyncState,
  revisions: readonly CommittedRevision[],
  committedSnapshot: AppData,
): void {
  const rewrites = revisions.flatMap((revision): AllocationRewriteRevision[] => {
    if (revision.table !== "allocations" || revision.rewrite !== true) return [];
    const flushed = committedSnapshot.allocations.find((allocation) => allocation.id === revision.id);
    return flushed ? [{ ...revision, flushedUpdatedAt: flushed.updatedAt }] : [];
  });
  if (rewrites.length > 0) state.allocationRewriteHandler?.(rewrites);
}

/** Drop translations for rows absent from the fully committed target. Defer this until lifecycle
 * convergence has restored any failed archives, so retryable disappearances keep their mapping. */
export function pruneAcknowledgedRevisions(state: SyncState, data: AppData): void {
  // Nothing to prune, and, since only the tables the surviving translations mention can decide a
  // key's fate, never a reason to index every row of every table just to answer a handful of ids.
  if (state.acknowledgedRevisions.size === 0) return;
  for (const [table, acknowledgedById] of buildAcknowledgedRevisionsByTable(state)) {
    const live = new Set<string>(data[table].map((row) => row.id));
    for (const id of acknowledgedById.keys()) {
      if (!live.has(id)) state.acknowledgedRevisions.delete(buildRowKey(table, id));
    }
  }
}

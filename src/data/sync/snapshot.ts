import type { AppData, Entity } from "@capacitylens/shared/types/entities";
import { type AllocationRewriteRevision } from "../PersistenceAdapter";
import { type Op } from "../syncOps";
import {
  applyCommittedRevision,
  rowKey,
  rowKeyParts,
  type AcknowledgedRevision,
  type CommittedRevision,
} from "./revisions";
import type { SyncState } from "./state";

/** Regroup the flat key→translation map into table→(id→translation) ONCE per pass, so a whole-table
 *  scan can look rows up by plain id instead of composing a key string per row. */
export function acknowledgedByTable(state: SyncState): Map<keyof AppData, Map<string, AcknowledgedRevision>> {
  const byTable = new Map<keyof AppData, Map<string, AcknowledgedRevision>>();
  for (const [key, acknowledged] of state.acknowledgedRevisions) {
    const [table, id] = rowKeyParts(key);
    let rows = byTable.get(table as keyof AppData);
    if (!rows) {
      rows = new Map<string, AcknowledgedRevision>();
      byTable.set(table as keyof AppData, rows);
    }
    rows.set(id, acknowledged);
  }
  return byTable;
}

export function canonicalizeAcknowledged(state: SyncState, data: AppData): AppData {
  if (state.acknowledgedRevisions.size === 0) return data;
  const next = { ...data };
  let changed = false;
  for (const [table, acknowledgedById] of acknowledgedByTable(state)) {
    next[table] = data[table].map((row) => {
      const acknowledged = acknowledgedById.get(row.id);
      if (!acknowledged || row.updatedAt !== acknowledged.client) return row;
      changed = true;
      // DURABLE translation, NOT consume-once — the entry MUST survive this diff. Nothing ever
      // writes the server's revision back into the Zustand store, so the store's copy of this row
      // keeps its client-side updatedAt for the tab's whole life. lastSynced holds the SERVER stamp;
      // every future diff therefore re-sees store(clientStamp) ≠ lastSynced(serverStamp) and would
      // re-emit a phantom PUT for a row the user never touched — which would re-stamp the row on the
      // server and 409-discard another user's real edit. Keeping the entry lets each future diff
      // translate the client stamp to the acknowledged server stamp, yielding ZERO ops. The entry is
      // invalidated only when it stops applying: a genuine re-edit bumps row.updatedAt to a NEW value
      // (this `=== acknowledged.client` guard then fails, so exactly one real PUT is emitted and
      // rememberRevisions overwrites the entry with the new client→server pair), and a full rehydrate
      // clears the whole Map (seedSnapshot). So the Map holds at most one entry per row edited since
      // the last rehydrate — bounded, not consume-once.
      return applyCommittedRevision(row, acknowledged.server);
    }) as never;
  }
  return changed ? next : data;
}

// Seed the diff snapshot to a freshly loaded slice and announce the seed to drain() (seedGen).
// Clearing the acknowledged-revision translations is PART of seeding: those entries map the prior
// session's client stamps onto server revisions, but a rehydrate replaces both lastSynced and the
// store with server-stamped rows, so the translations are now stale (and a fresh row reusing an old
// client stamp could be mistranslated). This is also the Map's cleanup boundary — see
// canonicalizeAcknowledged: without a rehydrate the Map only ever shrinks or overwrites, so seeding
// is where it is emptied.
export function seedSnapshot(state: SyncState, data: AppData, accountId?: string): void {
  state.lastSynced = data;
  state.seededAccountId = accountId ?? null;
  state.seedGen += 1;
  state.acknowledgedRevisions.clear();
  state.archivedBySync.clear();
}

export function rememberRevisions(
  state: SyncState,
  ops: Op[],
  revisions: CommittedRevision[],
  committedSnapshot: AppData,
): void {
  const byRow = new Map(
    revisions
      .filter((revision) => revision.rewrite !== true)
      .map((revision) => [rowKey(revision.table, revision.id), revision]),
  );
  for (const op of ops) {
    if (op.method !== "PUT" || !op.row) continue;
    const key = rowKey(op.table, op.id);
    const server = byRow.get(key);
    if (server) {
      state.acknowledgedRevisions.set(key, {
        client: op.row.updatedAt,
        server,
      });
    }
  }
  const rowsByTable = new Map<Op["table"], Map<string, Entity>>();
  for (const revision of revisions) {
    const key = rowKey(revision.table, revision.id);
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
  // Nothing to prune, and — since only the tables the surviving translations MENTION can decide a
  // key's fate — never a reason to index every row of every table just to answer a handful of ids.
  if (state.acknowledgedRevisions.size === 0) return;
  for (const [table, acknowledgedById] of acknowledgedByTable(state)) {
    const live = new Set<string>((data[table] as Entity[] | undefined)?.map((row) => row.id));
    for (const id of acknowledgedById.keys()) {
      if (!live.has(id)) state.acknowledgedRevisions.delete(rowKey(table, id));
    }
  }
}

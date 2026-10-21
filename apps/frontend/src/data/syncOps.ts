import { APP_DATA_WRITE_ORDER } from "@capacitylens/shared/types/entities";
import type { AppData, Entity } from "@capacitylens/shared/types/entities";

// Pure snapshot diffs and operation replay keep sync ordering separate from network I/O.

// Parent-before-child: every create/update must follow its foreign-key targets.
// Deletes use the reverse (child-before-parent). The emitted batch runs all upserts
// before all deletes, see diffOps for why (a reparent's new binding must land before
// the old parent's delete cascades).
const UPSERT_ORDER = APP_DATA_WRITE_ORDER;

type TableKey = (typeof UPSERT_ORDER)[number];

/** A snapshot-diff operation; scoped deletion carries its owning account and revision so ordering cannot cross tenants or newer edits. */
export interface Op {
  method: "PUT" | "DELETE";
  table: TableKey;
  id: string;
  row?: Entity;
  /** For a scoped-entity DELETE: the owning account (read from the pre-delete snapshot),
   * sent so the server can refuse a cross-account delete. Accounts are top-level and
   * carry none. */
  accountId?: string;
  /** Stored revision of the row being deleted. Ordered browser-sync batches use it to distinguish
   * their own predecessor from an intervening edit before applying a successor deletion. */
  updatedAt?: string;
}

interface TableDiff {
  upserts: Op[];
  deletes: Op[];
}

function createDeleteOp(table: TableKey, row: Entity): Op {
  // Carry the owning account (from the pre-delete snapshot) so the server can scope
  // the delete; accounts are top-level so they carry none.
  const accountId = table === "accounts" ? undefined : (row as { accountId?: string }).accountId;
  return {
    method: "DELETE",
    table,
    id: row.id,
    ...(accountId === undefined ? {} : { accountId }),
    updatedAt: row.updatedAt,
  };
}

function collectSingleBaseDeletes(
  table: TableKey,
  baseIndex: Map<string, Entity>,
  nextById: Map<string, Entity>,
): Op[] {
  const deletes: Op[] = [];
  for (const [id, row] of baseIndex) {
    if (!nextById.has(id)) deletes.push(createDeleteOp(table, row));
  }
  return deletes;
}

interface PossibleBaseDeletesInput {
  table: TableKey;
  baseRows: Entity[][];
  baseIndexes: Map<string, Entity>[];
  nextById: Map<string, Entity>;
}

function collectPossibleBaseDeletes({ table, baseRows, baseIndexes, nextById }: PossibleBaseDeletesInput): Op[] {
  const deletes: Op[] = [];
  const candidateIds = new Set(baseRows.flatMap((rows) => rows.map((row) => row.id)));
  for (const id of candidateIds) {
    if (nextById.has(id)) continue;
    const row = baseIndexes.map((index) => index.get(id)).find((candidate) => candidate !== undefined);
    if (!row) throw new Error(`diffOps: candidate row "${id}" is missing from every possible base.`);
    deletes.push(createDeleteOp(table, row));
  }
  return deletes;
}

function diffTable(table: TableKey, possibleBases: readonly AppData[], next: AppData): TableDiff {
  // Invariant: every AppData reaching the adapter is post-migrate (migrate() guarantees each
  // table column is an array) and lastSynced begins as emptyAppData(), so these `as Entity[]`
  // casts are always over real arrays. A non-array here is an upstream programmer error, not
  // user data; the assert turns an otherwise-cryptic "x.map is not a function" into a diagnosable
  // message. Pure function, a throw correctly propagates to the caller's error path.
  const nextRows = next[table] as Entity[];
  const baseRows = possibleBases.map((base) => base[table] as Entity[]);
  if (baseRows.some((rows) => !Array.isArray(rows)) || !Array.isArray(nextRows)) {
    throw new Error(`diffOps: table "${table}" is not an array — inputs must be post-migrate AppData.`);
  }
  const baseIndexes = baseRows.map((rows) => new Map(rows.map((entity) => [entity.id, entity])));
  const nextById = new Map(nextRows.map((entity) => [entity.id, entity]));
  const upserts = nextRows
    .filter((row) => baseIndexes.some((index) => index.get(row.id)?.updatedAt !== row.updatedAt))
    .map((row): Op => ({ method: "PUT", table, id: row.id, row }));
  if (baseIndexes.length !== 1) {
    return { upserts, deletes: collectPossibleBaseDeletes({ table, baseRows, baseIndexes, nextById }) };
  }
  // The ordinary single-base diff: that base's index already is the candidate id set, same
  // first-seen order, same per-id row (the last duplicate) the multi-base lookup above picks,
  // so iterate it instead of flattening every row id into a throwaway array plus a Set.
  const [baseIndex] = baseIndexes;
  if (!baseIndex) throw new Error("diffOps: expected the single possible base index.");
  return { upserts, deletes: collectSingleBaseDeletes(table, baseIndex, nextById) };
}

/** Computes revision-based upserts and removals between snapshots. Parent-first
 * upserts precede child-first deletes so reparented children survive old-parent cascades.
 * Ordinary operations commit atomically; lifecycle removals archive separately.
 */
export function diffOps(previous: AppData, next: AppData): Op[] {
  return diffOpsFromPossibleBases([previous], next);
}

/** Build one final-state delta that is correct when any supplied snapshot may be the server's
 * current base. Page teardown uses this while an ordinary batch is unacknowledged: that earlier
 * request may be absent, committed, or still racing the keepalive successor. */
export function diffOpsFromPossibleBases(possibleBases: readonly AppData[], next: AppData): Op[] {
  if (possibleBases.length === 0) {
    throw new Error("diffOpsFromPossibleBases: at least one possible base is required.");
  }
  const upserts: Op[] = [];
  const deletes: Op[] = [];
  for (const table of UPSERT_ORDER) {
    // Allocations are written only through typed planning operations, never as batch operations.
    if (table === "allocations") continue;
    const tableDiff = diffTable(table, possibleBases, next);
    upserts.push(...tableDiff.upserts);
    deletes.push(...tableDiff.deletes);
  }

  deletes.reverse();
  return [...upserts, ...deletes];
}

/** Applies operations immutably to a migrated baseline. Refresh reconciliation uses
 * replay to rebase edits made during a load onto its authoritative slice.
 * @throws When a baseline table is not an array.
 */
export function applyOps(base: AppData, ops: Op[]): AppData {
  const next = {} as Record<TableKey, Entity[]>;
  // Same invariant as diffOps: `base` is post-migrate, so every table is an array; and `ops` are
  // produced only by diffOps over UPSERT_ORDER, so every op.table is a known table (next[op.table]
  // is always defined below). A non-array base is a programmer error, fail loud, don't paper over.
  for (const table of UPSERT_ORDER) {
    const rows = base[table] as Entity[];
    if (!Array.isArray(rows)) {
      throw new Error(`applyOps: table "${table}" is not an array — base must be post-migrate AppData.`);
    }
    next[table] = [...rows];
  }
  // Lazy per-table position maps keep repeated PUTs linear. Discard an index after
  // deletion or row renaming so later lookups cannot use moved positions.
  const indexByTable = new Map<TableKey, Map<string, number>>();
  for (const op of ops) {
    applyOpInPlace({ next, indexByTable }, op);
  }
  return next as unknown as AppData;
}

interface ApplyState {
  next: Record<TableKey, Entity[]>;
  indexByTable: Map<TableKey, Map<string, number>>;
}

function applyOpInPlace(state: ApplyState, op: Op): void {
  const list = state.next[op.table];
  if (op.method === "DELETE") {
    state.next[op.table] = list.filter((row) => row.id !== op.id);
    state.indexByTable.delete(op.table);
    return;
  }
  if (!op.row) return;
  const index = indexFor(state.next, state.indexByTable, op.table);
  const rowIndex = index.get(op.id);
  if (rowIndex === undefined) {
    list.push(op.row);
    if (!index.has(op.row.id)) index.set(op.row.id, list.length - 1);
    return;
  }
  list[rowIndex] = op.row;
  if (op.row.id !== op.id) state.indexByTable.delete(op.table);
}

function indexFor(
  next: Record<TableKey, Entity[]>,
  indexByTable: Map<TableKey, Map<string, number>>,
  table: TableKey,
): Map<string, number> {
  const existing = indexByTable.get(table);
  if (existing) return existing;
  const index = new Map<string, number>();
  for (const [position, row] of next[table].entries()) {
    if (!index.has(row.id)) index.set(row.id, position);
  }
  indexByTable.set(table, index);
  return index;
}

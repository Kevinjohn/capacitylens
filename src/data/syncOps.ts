import { APP_DATA_WRITE_ORDER, type AppData, type Entity } from "@capacitylens/shared/types/entities";

// The pure diff/apply core of server sync, extracted from ServerSyncAdapter so the
// snapshot-to-REST-ops logic can be read and tested in isolation from the network
// adapter. No I/O here — just two pure functions over AppData snapshots.

// Parent-before-child: every create/update must follow its foreign-key targets.
// Deletes use the reverse (child-before-parent). The emitted batch runs ALL upserts
// before ALL deletes — see diffOps for why (a reparent's new binding must land before
// the old parent's delete cascades).
const UPSERT_ORDER = APP_DATA_WRITE_ORDER;

type TableKey = (typeof UPSERT_ORDER)[number];

export interface Op {
  method: "PUT" | "DELETE";
  table: TableKey;
  id: string;
  row?: Entity;
  /** For a scoped-entity DELETE: the owning account (read from the pre-delete snapshot),
   *  sent so the server can refuse a cross-account delete. Accounts are top-level and
   *  carry none. */
  accountId?: string;
  /** Stored revision of the row being deleted. Ordered browser-sync batches use it to distinguish
   *  their own predecessor from an intervening edit before applying a successor deletion. */
  updatedAt?: string;
}

/** Compute the ordered operations that turn `prev` into `next`, applied as one
 *  transactional batch. Upserts run parent-first, then deletes run child-first. An
 *  entity is an "upsert" when it's new or its updatedAt changed (the store bumps
 *  updatedAt on every edit, so it's a reliable change marker); a "delete" when it's
 *  gone from `next`.
 *
 *  ORDER IS LOAD-BEARING: all upserts precede all deletes. Reparent + delete in one
 *  batch (e.g. move project P from client C1→C2, then delete C1) must apply P's new
 *  clientId BEFORE C1 is deleted — otherwise C1's `ON DELETE CASCADE` removes P (still
 *  bound to C1 in the DB) and its unmodified descendants, which carry no upsert op and
 *  would be lost. Doing upserts first lets the cascade find nothing to take.
 *  Exported for unit tests. */
export function diffOps(prev: AppData, next: AppData): Op[] {
  return diffOpsFromPossibleBases([prev], next);
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
    // INVARIANT: every AppData reaching the adapter is post-migrate (migrate() guarantees each
    // table column is an array) and lastSynced begins as emptyAppData() — so these `as Entity[]`
    // casts are always over real arrays. A non-array here is an UPSTREAM PROGRAMMER ERROR, not
    // user data; the assert turns an otherwise-cryptic "x.map is not a function" into a diagnosable
    // message. Pure function — a throw correctly propagates to the caller's error path.
    const nextRows = next[table] as Entity[];
    const baseRows = possibleBases.map((base) => base[table] as Entity[]);
    if (baseRows.some((rows) => !Array.isArray(rows)) || !Array.isArray(nextRows)) {
      throw new Error(`diffOps: table "${table}" is not an array — inputs must be post-migrate AppData.`);
    }
    const baseIndexes = baseRows.map((rows) => new Map(rows.map((entity) => [entity.id, entity])));
    const nextById = new Map(nextRows.map((e) => [e.id, e]));
    for (const row of nextRows) {
      if (baseIndexes.some((index) => index.get(row.id)?.updatedAt !== row.updatedAt)) {
        upserts.push({ method: "PUT", table, id: row.id, row });
      }
    }
    // Carry the owning account (from the pre-delete snapshot) so the server can scope
    // the delete; accounts are top-level so they carry none.
    const pushDelete = (row: Entity): void => {
      const accountId = table === "accounts" ? undefined : (row as { accountId?: string }).accountId;
      deletes.push({ method: "DELETE", table, id: row.id, accountId, updatedAt: row.updatedAt });
    };
    if (baseIndexes.length === 1) {
      // The ordinary single-base diff: that base's index ALREADY is the candidate id set — same
      // first-seen order, same per-id row (the last duplicate) the multi-base lookup below picks —
      // so iterate it instead of flattening every row id into a throwaway array plus a Set.
      for (const [id, row] of baseIndexes[0]) {
        if (!nextById.has(id)) pushDelete(row);
      }
    } else {
      const candidateIds = new Set(baseRows.flatMap((rows) => rows.map((row) => row.id)));
      for (const id of candidateIds) {
        if (!nextById.has(id)) {
          pushDelete(baseIndexes.map((index) => index.get(id)).find((candidate) => candidate !== undefined)!);
        }
      }
    }
  }
  // upserts parent-first, then deletes child-first (reverse table order).
  deletes.reverse();
  return [...upserts, ...deletes];
}

/** Apply a set of (already-confirmed) ops to a base snapshot, returning a NEW AppData.
 *
 *  Diff-replay utility, exported for unit tests. It is NOT wired into a partial-advance sync path:
 *  `ServerSyncAdapter.drain()` relies on BATCH ATOMICITY — a batch either fully applies or throws,
 *  so on success `lastSynced` advances to the WHOLE target (see drain), and there is no production
 *  caller that advances `lastSynced` by only-the-ops-that-landed. If a per-op partial-advance
 *  recovery is ever added, this is the building block; until then, don't assume sync recovers
 *  row-by-row from a partial flush. */
export function applyOps(base: AppData, ops: Op[]): AppData {
  const next = {} as Record<TableKey, Entity[]>;
  // Same invariant as diffOps: `base` is post-migrate, so every table is an array; and `ops` are
  // produced only by diffOps over UPSERT_ORDER, so every op.table is a known table (next[op.table]
  // is always defined below). A non-array base is a programmer error — fail loud, don't paper over.
  for (const table of UPSERT_ORDER) {
    const rows = base[table] as Entity[];
    if (!Array.isArray(rows)) {
      throw new Error(`applyOps: table "${table}" is not an array — base must be post-migrate AppData.`);
    }
    next[table] = [...rows];
  }
  // Position index per TOUCHED table, built lazily (same idiom as ServerSyncAdapter.rebaseForWire):
  // a run of PUTs into one table costs O(ops + rows) instead of a linear findIndex each. An entry
  // records the FIRST position holding an id — exactly what findIndex returned — and the whole
  // table's index is dropped whenever a mutation can move or re-label rows (a DELETE re-filters the
  // array; a PUT whose row carries a different id than the op renames a slot), so the next lookup
  // rebuilds from the live array rather than trusting a stale position.
  const indexByTable = new Map<TableKey, Map<string, number>>();
  const indexFor = (table: TableKey): Map<string, number> => {
    let index = indexByTable.get(table);
    if (!index) {
      index = new Map<string, number>();
      for (const [position, row] of next[table].entries()) {
        if (!index.has(row.id)) index.set(row.id, position);
      }
      indexByTable.set(table, index);
    }
    return index;
  };
  for (const op of ops) {
    const list = next[op.table];
    if (op.method === "DELETE") {
      next[op.table] = list.filter((r) => r.id !== op.id);
      indexByTable.delete(op.table);
    } else if (op.row) {
      const index = indexFor(op.table);
      const idx = index.get(op.id);
      if (idx !== undefined) {
        list[idx] = op.row;
        if (op.row.id !== op.id) indexByTable.delete(op.table);
      } else {
        list.push(op.row);
        if (!index.has(op.row.id)) index.set(op.row.id, list.length - 1);
      }
    }
  }
  return next as unknown as AppData;
}

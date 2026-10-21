import type { Db } from "../db";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import { fromRow } from "../rowCodec";
import type { Row } from "../rowCodec";
import { createStatementCache, createCachedTableStatement } from "./statementCache";
import { CREATE_ORDER, SCOPED_ORDER } from "../tables";
import { resolveTable, tableExists } from "./introspection";
import { tx } from "../txn";
import { hasGatedFields, redactGatedEcho } from "../fieldPolicy";
import type { SanitizeWriteOptions } from "../fieldPolicy";
import { activeOnly } from "@capacitylens/shared/domain/lifecycle";
/** Assemble the whole AppData tree from the tables. */
export function readState(db: Db): AppData {
  const data = emptyAppData() as unknown as Record<string, Row[]>;
  const cache = createStatementCache(db).loadStateSelectAll;
  for (const table of CREATE_ORDER) {
    // During historical migration replay, newer AppData tables do not exist yet. They are empty
    // until their explicit migration creates them; the post-migration schema assertion still
    // rejects a missing table at the current version.
    if (!tableExists(db, table)) continue;
    const spec = resolveTable(table);
    const statement = createCachedTableStatement({ cache, table, db, sql: `SELECT * FROM ${table}` });
    data[table] = statement.all().map((r) => fromRow(spec, r));
  }
  return data as unknown as AppData;
}

/** GET /api/accounts' authMode="off" query: every account's id and name. Off mode is trusted-local
 * and has no membership rows, so every account is visible. The caller adds the `role: "owner"`
 * sentinel to form AccountSummary values; this function owns only the cached query. */
export function listAccountSummaries(db: Db): Array<{ id: string; name: string }> {
  const cache = createStatementCache(db);
  cache.accountSummariesSelect ??= db.prepare(`SELECT id, name FROM accounts ORDER BY id`);
  return cache.accountSummariesSelect.all() as Array<{ id: string; name: string }>;
}

declare const projectedAccountSliceBrand: unique symbol;
declare const completeAccountSliceBrand: unique symbol;

/** Serialization-only account projection. It may omit confidential fields or inactive rows and
 * therefore cannot be passed to a destructive whole-slice replacement. */
export type ProjectedAccountSlice = AppData & { readonly [projectedAccountSliceBrand]: true };

/** Complete, unredacted account slice suitable for an atomic read-modify-write replacement. */
export type CompleteAccountSlice = AppData & { readonly [completeAccountSliceBrand]: true };

/** Mark an independently validated import/remap result as complete replacement input. This is the
 * only escape hatch for data that did not originate from {@link readFullSlice}. */
export function buildCompleteAccountSlice(data: AppData): CompleteAccountSlice {
  return data as CompleteAccountSlice;
}

/** Reads one account’s tenant-scoped projection from a consistent SQLite snapshot.
 * Required visibility flags redact confidential fields and optionally remove inactive rows.
 * Unknown accounts produce an empty, complete-shaped slice. The returned projection is serialization-only
 * and cannot be used for destructive replacement; use readFullSlice for that purpose.
 */
export function readSlice(
  db: Db,
  accountId: string,
  options: {
    includeTimeOffNote: boolean;
    includeInactive: boolean;
    includePrivateNames: boolean;
  },
): ProjectedAccountSlice {
  // A slice is one logical read. Under WAL another handle may commit between table SELECTs; BEGIN
  // pins all of them to one snapshot. tx() uses a savepoint when the caller already owns a write.
  return tx(db, () => readSliceFromSnapshot(db, accountId, options)) as ProjectedAccountSlice;
}

/** Read an unredacted, tombstone-retaining slice for atomic transformation and replacement. */
export function readFullSlice(db: Db, accountId: string): CompleteAccountSlice {
  return tx(db, () =>
    readSliceFromSnapshot(db, accountId, {
      includeTimeOffNote: true,
      includeInactive: true,
      includePrivateNames: true,
    }),
  ) as CompleteAccountSlice;
}

function readSliceFromSnapshot(
  db: Db,
  accountId: string,
  options: {
    includeTimeOffNote: boolean;
    includeInactive: boolean;
    includePrivateNames: boolean;
  },
): AppData {
  const data = emptyAppData() as unknown as Record<string, Row[]>;
  const cache = createStatementCache(db);
  // The single global table: read the one account by id (0 or 1 row), via the same codec loadState uses.
  const accountsSpec = resolveTable("accounts");
  cache.accountByIdSelect ??= db.prepare(`SELECT * FROM accounts WHERE id = ?`);
  data["accounts"] = cache.accountByIdSelect.all(accountId).map((r) => fromRow(accountsSpec, r));
  // Every scoped table: WHERE accountId = ?, never an unpredicated read (the no-cross-tenant invariant).
  for (const table of SCOPED_ORDER) {
    const spec = resolveTable(table);
    const statement = createCachedTableStatement({
      cache: cache.scopedSelect,
      table,
      db,
      sql: `SELECT * FROM ${table} WHERE accountId = ?`,
    });
    data[table] = statement.all(accountId).map((r) => fromRow(spec, r));
  }
  // Use the same field-policy catalogue for read redaction and write preservation so the two cannot diverge.
  // Redact before applying the active-row projection.
  const visibility: SanitizeWriteOptions = {
    canSeeTimeOffNote: options.includeTimeOffNote,
    canSeePrivateNames: options.includePrivateNames,
  };
  for (const table of Object.keys(data)) {
    if (!hasGatedFields(table)) continue;
    const rows = data[table];
    if (!rows) throw new Error(`Missing application data collection for "${table}".`);
    data[table] = rows.map((row) => redactGatedEcho(table, row as Record<string, unknown>, visibility) as Row);
  }
  const visibleData = data as unknown as AppData;
  // Filter inactive rows after confidential-field redaction; omitted rows stay in storage and export.
  if (!options.includeInactive) return activeOnly(visibleData);
  return visibleData;
}

import type { Db } from "../db";
import { type AppData, emptyAppData } from "@capacitylens/shared/types/entities";
import { type Row, fromRow } from "../rowCodec";
import { statementCache, cachedTableStatement } from "./statementCache";
import { CREATE_ORDER, TABLES, SCOPED_ORDER } from "../tables";
import { tableExists } from "./introspection";
import { tx } from "../txn";
import { type SanitizeWriteOptions, tableHasGatedFields, redactGatedEcho } from "../fieldPolicy";
import { activeOnly } from "@capacitylens/shared/domain/lifecycle";
/** Assemble the whole AppData tree from the tables. */
export function loadState(db: Db): AppData {
  const data = emptyAppData() as unknown as Record<string, Row[]>;
  const cache = statementCache(db).loadStateSelectAll;
  for (const table of CREATE_ORDER) {
    // During historical migration replay, newer AppData tables do not exist yet. They are empty
    // until their explicit migration creates them; the post-migration schema assertion still
    // rejects a missing table at the current version.
    if (!tableExists(db, table)) continue;
    const spec = TABLES[table];
    const stmt = cachedTableStatement(cache, table, db, `SELECT * FROM ${table}`);
    data[table] = stmt.all().map((r) => fromRow(spec, r));
  }
  return data as unknown as AppData;
}

/** GET /api/accounts' authMode="off" branch: every account, id+name only (OFF mode is trusted-local
 *  and has no membership rows, so every account is visible there). SQL copied byte-identically from
 *  the app.ts route this encapsulates — the caller still maps each row onto the wire AccountSummary
 *  shape (adding the OFF sentinel `role: "owner"`); this only owns the query and its cached statement. */
export function listAccountSummaries(db: Db): Array<{ id: string; name: string }> {
  const cache = statementCache(db);
  if (!cache.accountSummariesSelect) {
    cache.accountSummariesSelect = db.prepare(`SELECT id, name FROM accounts ORDER BY id`);
  }
  return cache.accountSummariesSelect.all() as Array<{ id: string; name: string }>;
}

/**
 * Read ONLY one account's slice of AppData — the per-account scoped read primitive (P1.4).
 *
 * Returns an AppData whose `accounts` array is the single requested account (0 rows if it does not
 * exist) and whose every SCOPED table holds ONLY rows where `accountId = accountId`. The result has
 * EVERY AppData key present (it starts from {@link emptyAppData}), so a consumer never sees a missing
 * table even when an account has no rows in it.
 *
 * NO-CROSS-TENANT INVARIANT: every scoped query carries `WHERE accountId = ?`, and the only global
 * table (`accounts`) is read by its id (`WHERE id = ?`). No query here omits its predicate, so this
 * function can NEVER return a row belonging to another account — the tenant-isolation guarantee the
 * {@link TenantStore} seam rests on (see tenantStore.ts).
 *
 * UNKNOWN accountId: not an error. An id with no matching account yields `accounts: []` plus an empty
 * array for every scoped table — degrade to "empty slice", never throw (a stale/typo'd id from a
 * client is a 0-row read, not a corruption signal). Rows are mapped through the SAME `fromRow` codec
 * {@link loadState} uses, so optional/json columns round-trip identically.
 *
 * FIELD-LEVEL REDACTION (P1.6): `opts.includeTimeOffNote` is REQUIRED — there is no silent default, so
 * every caller must DECIDE the visibility of the owner/admin-only time-off `note` (the access rule
 * lives in `canSeeTimeOffNote`, shared/domain/access). When `false`, the `note` key is STRIPPED from every returned `timeOff`
 * row HERE, server-side — so an Editor/Viewer's read can never serialize the note onto the wire. When
 * `true`, the note is returned as stored. This is a payload-narrowing rule, not a request gate: the
 * read is already authorized; this only decides which columns leave the server.
 *
 * PRIVATE-NAME PROJECTION: `opts.includePrivateNames` is REQUIRED. When false, private client and
 * project real names are replaced with their quoted code names and the raw `codeName` field is
 * removed. Only account owners pass true; every other role is narrowed before serialization.
 *
 * LIFECYCLE PROJECTION (P2.4): `opts.includeInactive` is REQUIRED, mirroring `includeTimeOffNote` (no
 * silent default — every caller DECIDES). When `false` (the normal app read), the SHARED `activeOnly`
 * helper is applied AFTER the note redaction, dropping every NON-active (archived OR soft-deleted)
 * resource/client/project from the returned slice — exactly the rows the normal views hide. The rows
 * REMAIN in the DB and in EXPORT; this only narrows what the per-account read serializes. When `true`
 * (P2.5's admin "Archived & deleted" read), the full slice is returned untouched. Composition order is
 * load-bearing: redact the note FIRST, then `activeOnly` — the two narrowings are independent, and
 * applying `activeOnly` last keeps it a single, total projection over the already-redacted slice.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account whose slice to read.
 * @param opts.includeTimeOffNote  REQUIRED. `true` keeps each time-off `note`; `false` strips it
 *                                 (owner/admin-only field — redacted before it leaves the server).
 * @param opts.includePrivateNames REQUIRED. `true` keeps real private names; `false` substitutes
 *                                 quoted code names and strips the raw codeName field.
 * @param opts.includeInactive  REQUIRED. `false` drops archived/soft-deleted resources/clients/projects
 *                              (the normal app read); `true` returns every row (the P2.5 admin read).
 * @returns A serialization-only projected slice containing ONLY `accountId`'s data. Its brand is
 *          intentionally incompatible with {@link replaceAccountSlice}.
 */
declare const projectedAccountSliceBrand: unique symbol;
declare const completeAccountSliceBrand: unique symbol;

/** Serialization-only account projection. It may omit confidential fields or inactive rows and
 * therefore cannot be passed to a destructive whole-slice replacement. */
export type ProjectedAccountSlice = AppData & { readonly [projectedAccountSliceBrand]: true };

/** Complete, unredacted account slice suitable for an atomic read-modify-write replacement. */
export type CompleteAccountSlice = AppData & { readonly [completeAccountSliceBrand]: true };

/** Mark an independently validated import/remap result as complete replacement input. This is the
 * only escape hatch for data that did not originate from {@link readFullSlice}. */
export function validatedCompleteAccountSlice(data: AppData): CompleteAccountSlice {
  return data as CompleteAccountSlice;
}

export function readSlice(
  db: Db,
  accountId: string,
  opts: {
    includeTimeOffNote: boolean;
    includeInactive: boolean;
    includePrivateNames: boolean;
  },
): ProjectedAccountSlice {
  // A slice is one logical read. Under WAL another handle may commit between table SELECTs; BEGIN
  // pins all of them to one snapshot. tx() uses a savepoint when the caller already owns a write.
  return tx(db, () => readSliceFromSnapshot(db, accountId, opts)) as ProjectedAccountSlice;
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
  opts: {
    includeTimeOffNote: boolean;
    includeInactive: boolean;
    includePrivateNames: boolean;
  },
): AppData {
  const data = emptyAppData() as unknown as Record<string, Row[]>;
  const cache = statementCache(db);
  // The single global table: read the ONE account by id (0 or 1 row), via the same codec loadState uses.
  const accountsSpec = TABLES["accounts"];
  if (!cache.accountByIdSelect) cache.accountByIdSelect = db.prepare(`SELECT * FROM accounts WHERE id = ?`);
  data["accounts"] = cache.accountByIdSelect.all(accountId).map((r) => fromRow(accountsSpec, r));
  // Every scoped table: WHERE accountId = ? — never an unpredicated read (the no-cross-tenant invariant).
  for (const table of SCOPED_ORDER) {
    const spec = TABLES[table];
    const stmt = cachedTableStatement(cache.scopedSelect, table, db, `SELECT * FROM ${table} WHERE accountId = ?`);
    data[table] = stmt.all(accountId).map((r) => fromRow(spec, r));
  }
  // P1.6 / private-name field-level redaction: derive BOTH gated-field redactions from the SAME
  // fieldPolicy.ts GATED_FIELD_POLICIES catalogue the write-pin (pinGatedFields) and export-include
  // (readSliceVisibility) sites already use, so a read/write/export can never disagree about who may
  // see a gated field. redactGatedEcho DELETES the gated key (never nulls it) — matching TimeOff's
  // optional `note` shape — and is applied per-table via tableHasGatedFields, so redacting
  // clients/projects here is byte-identical to the former direct whole-slice `redactPrivateNames`
  // call, which was itself exactly `clients.map(redactPrivateName)` / `projects.map(redactPrivateName)`
  // — the SAME function the catalogue's privateNames policy's redactEcho calls. Applied BEFORE the
  // activeOnly projection below, over every gated table at once (table iteration order doesn't matter:
  // each policy only ever touches its own table(s), so the net result of this loop is unchanged
  // regardless of order — the one ordering that DOES matter, gated redaction before activeOnly, is
  // preserved).
  const vis: SanitizeWriteOptions = {
    canSeeTimeOffNote: opts.includeTimeOffNote,
    canSeePrivateNames: opts.includePrivateNames,
  };
  for (const table of Object.keys(data)) {
    if (!tableHasGatedFields(table)) continue;
    data[table] = data[table].map((row) => redactGatedEcho(table, row as Record<string, unknown>, vis) as Row);
  }
  const visibleData = data as unknown as AppData;
  // P2.4 lifecycle projection: for the NORMAL app read (includeInactive:false), drop every NON-active
  // (archived/soft-deleted) resource/client/project via the SHARED activeOnly helper — the SAME rule
  // the client views use (useActiveScopedData), so the two halves can't drift. Applied AFTER the gated
  // redaction above so the projection runs over the already-redacted slice. includeInactive:true (P2.5's
  // admin read) returns the full slice untouched. The dropped rows stay in the DB + export.
  if (!opts.includeInactive) return activeOnly(visibleData);
  return visibleData;
}

import { type Db } from "../db";
import { statementCache } from "./statementCache";
import { type AppData } from "@capacitylens/shared/types/entities";
import { tx } from "../txn";
import { type Row } from "../rowCodec";
import { CREATE_ORDER, SCOPED_ORDER } from "../tables";
import { insertRowRaw } from "./rows";
import { type CompleteAccountSlice } from "./slices";
/** Persistent "this dataset has been initialised" marker, set on the first write. Unlike
 *  a row count it SURVIVES the user emptying their data, so /api/meta can tell a
 *  genuinely-fresh DB (seed it) from one the user deliberately cleared (don't re-seed) —
 *  mirroring the web app's "storage key present" semantics, where the two diverged. */
export function markInitialized(db: Db): void {
  const cache = statementCache(db);
  if (!cache.markInitialized) {
    cache.markInitialized = db.prepare(`INSERT OR IGNORE INTO _meta (key, value) VALUES ('initialized', '1')`);
  }
  cache.markInitialized.run();
}

export function isInitialized(db: Db): boolean {
  const row = db.prepare(`SELECT value FROM _meta WHERE key = 'initialized'`).get() as { value?: string } | undefined;
  return row?.value === "1";
}

/** First-run seeding gate used by the server entrypoint: seed ONLY a never-initialised DB.
 *  Gated on the persistent `initialized` marker — which survives the user emptying their
 *  data — NOT on mere emptiness, so a user who deletes everything is NOT handed the demo
 *  dataset back on the next restart (the same predicate /api/meta reports). Seeding sets
 *  the marker, so it fires exactly once. Returns whether it seeded. */
export function seedIfUninitialized(db: Db, data: AppData): boolean {
  return tx(
    db,
    () => {
      // Reserve SQLite's single writer before inspecting the marker. Concurrent first boots then
      // serialize here, so the loser observes the winner's marker instead of colliding on seed ids.
      if (isInitialized(db)) return false;
      insertAllRows(db, data);
      markInitialized(db);
      return true;
    },
    "immediate",
  );
}

function insertAllRows(db: Db, data: AppData): void {
  const rows = data as unknown as Record<string, Row[]>;
  for (const table of CREATE_ORDER) for (const row of rows[table] ?? []) insertRowRaw(db, table, row);
}

/** Insert an entire AppData tree (parent-first). Used by seeding and reset. */
export function insertAll(db: Db, data: AppData): void {
  tx(db, () => {
    insertAllRows(db, data);
    markInitialized(db); // once for the whole batch, not per row
  });
}

/** Wipe every product-domain row plus account membership/invitation control state. Domain tables
 *  are deleted children-first so FK checks stay satisfied. Authentication identities, migration
 *  history and installation-level control state deliberately survive this trusted-local reset. The
 *  init marker is cleared so the next load seeds again. */
export function wipe(db: Db): void {
  tx(db, () => {
    for (let i = CREATE_ORDER.length - 1; i >= 0; i--) db.exec(`DELETE FROM ${CREATE_ORDER[i]}`);
    db.exec(`DELETE FROM account_member_sign_in_tracking`);
    db.exec(`DELETE FROM account_members`);
    db.exec(`DELETE FROM invites`);
    db.exec(`DELETE FROM _meta`);
  });
}

/** Replace one account's scoped slice with the rows for that account in a branded complete `next`.
 *  Used by /api/import after its snapshot is revalidated inside the surrounding write transaction.
 *  The rewrite erases any sibling row not re-supplied; independently validated replacement data
 *  must cross the explicit {@link validatedCompleteAccountSlice} boundary. */
export function replaceAccountSlice(db: Db, accountId: string, next: CompleteAccountSlice): void {
  const d = next as unknown as Record<string, Row[]>;
  tx(db, () => {
    for (let i = SCOPED_ORDER.length - 1; i >= 0; i--) {
      db.prepare(`DELETE FROM ${SCOPED_ORDER[i]} WHERE accountId = ?`).run(accountId);
    }
    for (const table of SCOPED_ORDER) {
      for (const row of d[table] ?? []) if (row.accountId === accountId) insertRowRaw(db, table, row);
    }
    markInitialized(db); // once for the whole slice, not per row
  });
}

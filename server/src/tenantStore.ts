import type { AppData } from '@capacitylens/shared/types/entities'
import { type Db, readSlice, replaceAccountSlice } from './db'

// THE TENANT-STORE SWAP POINT (P1.4). The single per-account scoped read/write primitive every
// permissioned route goes through — "code as if one-instance-per-agency, run shared for now."
//
// TODAY: one shared SQLite file, scoped by `WHERE accountId = ?` (readSlice / replaceAccountSlice in
// db.ts). TOMORROW: a per-agency DB, a per-instance deployment, or Postgres — all of which swap in
// BEHIND THIS INTERFACE ONLY, with no change to any caller. That is the whole point of the seam: the
// routes depend on TenantStore, not on db.ts, so the storage backend is replaceable in one place.
//
// THE NO-CROSS-TENANT INVARIANT (mirrors the aspiration documented in membership.ts): no caller may
// issue a cross-tenant query. Every method is keyed by a single accountId and returns/writes ONLY
// that account's slice; readSlice's predicates (db.ts) enforce it at the SQL layer. A future
// implementation MUST preserve this — a method that could touch >1 account breaks the seam's contract.
//
// SYNCHRONOUS today: node:sqlite is synchronous, so these are sync (simpler, no needless async). The
// architecture writes the aspirational interface as `Promise<…>` for a later per-agency-DB / Postgres
// swap; wrapping a sync return in `await` is harmless, so a future async swap is anticipated.
//
// SCOPE NOTE (P1.4): `write` is a THIN wrap of replaceAccountSlice — it is NOT yet wired into
// /api/batch or the per-entity write routes. Routing those through the store (and closing
// replaceAccountSlice behind ownership) is P1.5; full can()-gating is P1.5 too. This task only
// establishes the seam plus the two READ endpoints.

/**
 * The per-account scoped storage seam — the documented swap point for the tenancy backend.
 *
 * Both methods are keyed by a single `accountId` and operate on ONLY that account's slice; neither
 * can read or write another tenant's data (the no-cross-tenant invariant). A future per-agency-DB /
 * per-instance / Postgres backend replaces the implementation here without changing any caller.
 */
export interface TenantStore {
  /**
   * Read ONLY `accountId`'s slice of AppData (every AppData key present; arrays may be empty). An
   * unknown id yields an empty slice (`accounts: []` + empty scoped arrays), never a throw.
   */
  readSlice(accountId: string): AppData
  /**
   * Replace `accountId`'s scoped rows with the rows for that account in `next`. Affects ONLY that
   * account's scoped tables; the global `accounts` row and every other account are left untouched.
   */
  write(accountId: string, next: AppData): void
}

/**
 * THE single shared-SQLite {@link TenantStore} — the documented swap point (see the module header).
 *
 * `readSlice` delegates to db.ts's {@link readSlice} (`WHERE accountId = ?` on all scoped tables +
 * accounts-by-id); `write` delegates to {@link replaceAccountSlice} (scoped delete + reinsert for
 * the one account). A THIN wrap by design: the isolation logic lives in db.ts, and this is the seam
 * a future backend swaps. No method here issues a cross-tenant query.
 *
 * @param db  The open SQLite handle this store reads from / writes to.
 * @returns A {@link TenantStore} bound to `db`.
 */
export function sqliteTenantStore(db: Db): TenantStore {
  return {
    readSlice: (accountId) => readSlice(db, accountId),
    write: (accountId, next) => replaceAccountSlice(db, accountId, next),
  }
}

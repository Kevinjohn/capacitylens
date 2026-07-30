import {
  SCOPED_KEYS,
  type Allocation,
  type AppDataKey,
  type Client,
  type Project,
  type Resource,
  type ScopedEntityKey,
} from "@capacitylens/shared/types/entities";
import type { ValidationDataLookup } from "@capacitylens/shared/domain/mutations";
import type { LifecycleEntityKey } from "@capacitylens/shared/domain/lifecycle";
import {
  deleteRow,
  getRow,
  type CompleteAccountSlice,
  type Db,
  type ProjectedAccountSlice,
  readFullSlice,
  readSlice,
  replaceAccountSlice,
  upsertRow,
} from "./db";
import { tx } from "./txn";
import { nextServerRevision } from "./revision";

type SynchronousResult<Result> = [Extract<Result, PromiseLike<unknown>>] extends [never] ? Result : never;

export type LifecycleRow = Resource | Client | Project;

export interface ResourceNoteScrubResult {
  allocationNotes: boolean;
  timeOffNotes: boolean;
}

function ownedLifecycleRow(
  db: Db,
  accountId: string,
  entity: LifecycleEntityKey,
  id: string,
): LifecycleRow | undefined {
  const row = getRow(db, entity, id) as LifecycleRow | undefined;
  return row?.accountId === accountId ? row : undefined;
}

function restampRows(
  db: Db,
  table: "resources" | "activities",
  rows: Array<{ id: string; updatedAt: unknown }>,
  clearedColumn: "projectId" | "phaseId",
): void {
  const update = db.prepare(`UPDATE ${table} SET ${clearedColumn} = NULL, updatedAt = ? WHERE id = ?`);
  for (const row of rows) update.run(nextServerRevision(row.updatedAt), row.id);
}

export interface PurgeLifecycleResult {
  removedCounts: Partial<Record<ScopedEntityKey, number>>;
}

function scopedRowCounts(db: Db, accountId: string): Record<ScopedEntityKey, number> {
  return Object.fromEntries(
    SCOPED_KEYS.map((table) => [
      table,
      Number(
        (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE accountId = ?`).get(accountId) as { count: number })
          .count,
      ),
    ]),
  ) as Record<ScopedEntityKey, number>;
}

function purgeLifecycleRow(
  db: Db,
  accountId: string,
  entity: LifecycleEntityKey,
  id: string,
): PurgeLifecycleResult | null {
  if (!ownedLifecycleRow(db, accountId, entity, id)) return null;
  const before = scopedRowCounts(db, accountId);

  if (entity === "projects") {
    const resources = db
      .prepare(`SELECT id, updatedAt FROM resources WHERE accountId = ? AND projectId = ?`)
      .all(accountId, id) as Array<{ id: string; updatedAt: unknown }>;
    const activities = db
      .prepare(
        `SELECT activities.id, activities.updatedAt
         FROM activities
         JOIN phases ON phases.id = activities.phaseId
        WHERE activities.accountId = ? AND phases.projectId = ?
          AND (activities.projectId IS NULL OR activities.projectId <> ?)`,
      )
      .all(accountId, id, id) as Array<{ id: string; updatedAt: unknown }>;
    restampRows(db, "resources", resources, "projectId");
    restampRows(db, "activities", activities, "phaseId");
  } else if (entity === "clients") {
    const resources = db
      .prepare(
        `SELECT resources.id, resources.updatedAt
         FROM resources
         JOIN projects ON projects.id = resources.projectId
        WHERE resources.accountId = ? AND projects.clientId = ?`,
      )
      .all(accountId, id) as Array<{ id: string; updatedAt: unknown }>;
    const activities = db
      .prepare(
        `SELECT activities.id, activities.updatedAt
         FROM activities
         JOIN phases ON phases.id = activities.phaseId
         JOIN projects AS phaseProjects ON phaseProjects.id = phases.projectId
        WHERE activities.accountId = ? AND phaseProjects.clientId = ?
          AND (
            activities.projectId IS NULL OR
            activities.projectId NOT IN (SELECT id FROM projects WHERE clientId = ?)
          )`,
      )
      .all(accountId, id, id) as Array<{ id: string; updatedAt: unknown }>;
    restampRows(db, "resources", resources, "projectId");
    restampRows(db, "activities", activities, "phaseId");
  }

  deleteRow(db, entity, id);
  const after = scopedRowCounts(db, accountId);
  const removedCounts: Partial<Record<ScopedEntityKey, number>> = {};
  for (const table of SCOPED_KEYS) {
    const removed = before[table] - after[table];
    if (removed > 0) removedCounts[table] = removed;
  }
  return { removedCounts };
}

function transactSlice<Result>(
  db: Db,
  accountId: string,
  opts: Readonly<{ includeTimeOffNote: true; includeInactive: true; includePrivateNames: true }>,
  operation: (slice: CompleteAccountSlice) => {
    next: CompleteAccountSlice;
    result: SynchronousResult<Result>;
  },
): Result {
  let output!: Result;
  tx(
    db,
    () => {
      void opts;
      const { next, result } = operation(readFullSlice(db, accountId));
      replaceAccountSlice(db, accountId, next);
      output = result as Result;
    },
    "immediate",
  );
  return output;
}

// THE TENANT-STORE SWAP POINT (P1.4). The single per-account scoped read/write primitive every
// permissioned route goes through — "code as if one-instance-per-agency, run shared for now."
//
// TODAY: one shared SQLite file, scoped by `WHERE accountId = ?` (readSlice / replaceAccountSlice in
// db.ts). TOMORROW: a per-agency DB, a per-instance deployment, or Postgres — all of which swap in
// BEHIND THIS INTERFACE ONLY, with no change to any caller. That is the whole point of the seam: the
// routes depend on TenantStore, not on db.ts, so the storage backend is replaceable in one place.
//
// THE NO-CROSS-TENANT INVARIANT (mirrors the account-boundary contract): no caller may
// issue a cross-tenant query. Every method is keyed by a single accountId and returns/writes ONLY
// that account's slice; readSlice's predicates (db.ts) enforce it at the SQL layer. A future
// implementation MUST preserve this — a method that could touch >1 account breaks the seam's contract.
//
// ATOMICITY INVARIANT: a read that feeds a whole-slice replacement belongs inside `transact`; never
// pair readSlice and write across a suspension point. The interface is deliberately synchronous for
// node:sqlite. A future async backend must preserve `transact` as one storage transaction and update
// callers to await that complete unit; changing readSlice/write to promises independently is unsafe.
//
// SCOPE NOTE (P1.4): `write` is a THIN wrap of replaceAccountSlice for independently complete
// imports. Lifecycle routes use the semantic row/cascade methods below so one tombstone change never
// rewrites every tenant row. /api/batch assembles its validation projection from scoped reads but
// applies individual mutations through lower-level helpers. Generic per-entity routes likewise use
// scoped validation reads and lower-level row writes.

/**
 * The per-account scoped storage seam — the documented swap point for the tenancy backend.
 *
 * Both methods are keyed by a single `accountId` and operate on ONLY that account's slice; neither
 * can read or write another tenant's data (the no-cross-tenant invariant). A future per-agency-DB /
 * per-instance / Postgres backend replaces the implementation here without changing any caller.
 */
export interface TenantStore {
  /**
   * Read ONLY `accountId`'s serialization projection (every AppData key present; arrays may be
   * empty). The projected brand cannot be passed to {@link write}. An unknown id yields an empty
   * slice (`accounts: []` + empty scoped arrays), never a throw.
   *
   * `opts.includeTimeOffNote` is REQUIRED (P1.6) — the caller must decide whether the owner/admin-only
   * time-off `note` is included. When `false`, `note` is redacted from every time-off row server-side
   * (see {@link readSlice} in db.ts), so it never reaches an Editor/Viewer client.
   *
   * `opts.includePrivateNames` is REQUIRED — only owners pass true. False substitutes quoted code
   * names for private client/project real names and strips raw codeName fields server-side.
   *
   * `opts.includeInactive` is REQUIRED (P2.4) — the caller must decide whether archived/soft-deleted
   * resources/clients/projects are included. When `false` (the normal app read), they are dropped
   * server-side (see {@link readSlice}); `true` is the P2.5 admin "Archived & deleted" read.
   */
  readSlice(
    accountId: string,
    opts: {
      includeTimeOffNote: boolean;
      includeInactive: boolean;
      includePrivateNames: boolean;
    },
  ): ProjectedAccountSlice;
  /** Read every field and lifecycle row for an atomic read-modify-write operation. */
  readFullSlice(accountId: string): CompleteAccountSlice;
  /** Indexed point/reverse lookups for validating one generic write without materialising a slice. */
  validationLookup?(): ValidationDataLookup;
  /**
   * Replace `accountId`'s scoped rows with the rows for that account in `next`. Affects ONLY that
   * account's scoped tables; the global `accounts` row and every other account are left untouched.
   * This is a complete replacement: an owned row omitted from `next` is deleted. If `next` came
   * from a prior slice read, use {@link transact}; separating that read from this destructive
   * replacement is unsafe.
   */
  write(accountId: string, next: CompleteAccountSlice): void;
  /**
   * Atomically read, transform and replace one complete tenant slice. Only full-read options are
   * accepted at the type boundary. `operation` must be
   * synchronous and returns both the replacement and a caller result. Throwing rolls the whole
   * unit back. Any read that will feed {@link write} must use this boundary.
   */
  transact<Result>(
    accountId: string,
    opts: Readonly<{ includeTimeOffNote: true; includeInactive: true; includePrivateNames: true }>,
    operation: (slice: CompleteAccountSlice) => {
      next: CompleteAccountSlice;
      result: SynchronousResult<Result>;
    },
  ): Result;
  /** Read one lifecycle row, concealed as absent unless it belongs to `accountId`. */
  readLifecycleRow(accountId: string, entity: LifecycleEntityKey, id: string): LifecycleRow | undefined;
  /** Replace one owned lifecycle row without rewriting its tenant siblings. */
  writeLifecycleRow(accountId: string, entity: LifecycleEntityKey, row: LifecycleRow): void;
  /** Remove sensitive notes attached to one soft-deleted resource. */
  scrubResourceNotes(accountId: string, resourceId: string): ResourceNoteScrubResult;
  /** Purge one owned lifecycle root through SQLite cascades, restamping nullable survivors. */
  purgeLifecycleRow(accountId: string, entity: LifecycleEntityKey, id: string): PurgeLifecycleResult | null;
}

/**
 * THE single shared-SQLite {@link TenantStore} — the documented swap point (see the module header).
 *
 * `readSlice` delegates to db.ts's {@link readSlice} (`WHERE accountId = ?` on all scoped tables +
 * accounts-by-id); `write` delegates to {@link replaceAccountSlice} for complete imports. Lifecycle
 * methods use owned point reads, one-row upserts, bounded dependent-note updates and database
 * cascades with explicit nullable-survivor revisions. The isolation logic stays behind this seam,
 * and no method issues a cross-tenant query.
 *
 * @param db  The open SQLite handle this store reads from / writes to.
 * @returns A {@link TenantStore} bound to `db`.
 */
export function sqliteTenantStore(db: Db): TenantStore {
  const relatedAllocations = (field: "resourceId" | "activityId", accountId: string, id: string): Allocation[] =>
    (
      db.prepare(`SELECT id FROM allocations WHERE accountId = ? AND ${field} = ?`).all(accountId, id) as Array<{
        id: string;
      }>
    ).flatMap(({ id: allocationId }) => {
      const row = getRow(db, "allocations", allocationId);
      return row ? [row as unknown as Allocation] : [];
    });
  const validationLookup: ValidationDataLookup = {
    row: (table: AppDataKey, id: string) =>
      getRow(db, table, id) as (Record<string, unknown> & { id: string }) | undefined,
    allocationsForResource: (accountId, resourceId) => relatedAllocations("resourceId", accountId, resourceId),
    allocationsForActivity: (accountId, activityId) => relatedAllocations("activityId", accountId, activityId),
    resourceHasLoadedAllocation: (accountId, resourceId) =>
      db
        .prepare(`SELECT 1 FROM allocations WHERE accountId = ? AND resourceId = ? AND hoursPerDay != 0 LIMIT 1`)
        .get(accountId, resourceId) !== undefined,
    resourceHasTimeOff: (accountId, resourceId) =>
      db.prepare(`SELECT 1 FROM timeOff WHERE accountId = ? AND resourceId = ? LIMIT 1`).get(accountId, resourceId) !==
      undefined,
  };
  return {
    readSlice: (accountId, opts) => readSlice(db, accountId, opts),
    readFullSlice: (accountId) => readFullSlice(db, accountId),
    validationLookup: () => validationLookup,
    write: (accountId, next) => replaceAccountSlice(db, accountId, next),
    transact: (accountId, opts, operation) => transactSlice(db, accountId, opts, operation),
    readLifecycleRow: (accountId, entity, id) => ownedLifecycleRow(db, accountId, entity, id),
    writeLifecycleRow: (accountId, entity, row) => {
      if (row.accountId !== accountId || !ownedLifecycleRow(db, accountId, entity, row.id)) {
        throw new Error("Lifecycle row does not belong to the requested company.");
      }
      upsertRow(db, entity, row as unknown as Record<string, unknown>);
    },
    scrubResourceNotes: (accountId, resourceId) => {
      if (!ownedLifecycleRow(db, accountId, "resources", resourceId)) {
        throw new Error("Lifecycle row does not belong to the requested company.");
      }
      const scrub = (table: "allocations" | "timeOff") => {
        const rows = db
          .prepare(
            `SELECT id, updatedAt FROM ${table}
            WHERE accountId = ? AND resourceId = ? AND note IS NOT NULL`,
          )
          .all(accountId, resourceId) as Array<{
          id: string;
          updatedAt: unknown;
        }>;
        const update = db.prepare(`UPDATE ${table} SET note = NULL, updatedAt = ? WHERE id = ?`);
        for (const row of rows) update.run(nextServerRevision(row.updatedAt), row.id);
        return rows.length > 0;
      };
      return {
        allocationNotes: scrub("allocations"),
        timeOffNotes: scrub("timeOff"),
      };
    },
    purgeLifecycleRow: (accountId, entity, id) => purgeLifecycleRow(db, accountId, entity, id),
  };
}

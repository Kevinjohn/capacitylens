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
  upsertRow,
} from "./db";
import { nextServerRevision } from "./revision";

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

// TENANT-SCOPING STORAGE SEAM. Permissioned routes use these accountId-keyed reads, validation
// lookups and lifecycle operations where the storage boundary adds tenant ownership or projection.
// Generic mutations and whole-slice import remain explicit SQLite operations in their owning paths;
// this interface is intentionally not a complete or transparently replaceable database abstraction.
//
// THE NO-CROSS-TENANT INVARIANT (mirrors the account-boundary contract): no caller may
// issue a cross-tenant query. Every method is keyed by a single accountId and returns/writes ONLY
// that account's data; readSlice's predicates and the owned lifecycle operations enforce it at the
// SQL layer. A method that could touch more than one account breaks this seam's contract.

/**
 * The account-scoped storage seam for tenant-isolated reads, validation and lifecycle operations.
 *
 * Every method is keyed by a single `accountId` and operates on only that account's data. The
 * interface records that isolation contract without pretending to abstract every database access.
 */
export interface TenantStore {
  /**
   * Read ONLY `accountId`'s serialization projection (every AppData key present; arrays may be
   * empty). The projected brand cannot be passed to a destructive replacement. An unknown id yields an empty
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
  /** Read every field and lifecycle row for validation or fingerprinting. */
  readFullSlice(accountId: string): CompleteAccountSlice;
  /** Indexed point/reverse lookups for validating one generic write without materialising a slice. */
  validationLookup?(): ValidationDataLookup;
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
 * Build the shared-SQLite {@link TenantStore} used by permissioned routes.
 *
 * `readSlice` delegates to db.ts's {@link readSlice} (`WHERE accountId = ?` on all scoped tables +
 * accounts-by-id). Lifecycle methods use owned point reads, one-row upserts, bounded dependent-note
 * updates and database cascades with explicit nullable-survivor revisions. No method issues a
 * cross-tenant query.
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

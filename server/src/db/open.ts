import { type Db } from "../db";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync } from "node:fs";
import { type DatabaseMigrationHooks, type DatabaseMigrationPlan, MIGRATION_HISTORY_SQL } from "./migrationLedger";
import { planDatabaseMigrations, DATABASE_MIGRATIONS } from "./migrations/index";
import { tx } from "../txn";
import { pragmaNumber } from "./introspection";
import { DB_SCHEMA_VERSION, DATABASE_MIGRATION_TABLE, CAPACITYLENS_APPLICATION_ID } from "./constants";
import { assertMigrationHistory, assertMigrationHistoryTable } from "./migrationHistory";
import {
  ensureControlTables,
  assertControlTablesCurrent,
  assertSingleOwnerControlPlaneCurrent,
} from "../controlTables";
import { repairEmptyAccountWorkingDays } from "./repairs";
import { assertSchemaCurrent } from "../schema";
import { assertMemberSignInTrackingSchemaCurrent } from "../accounts/memberSignInTracking";
import { assertAccountBoundaryStateCurrent } from "../accounts/state";
import { assertAuditOutboxCurrent } from "../auditOutbox";
import { assertSyncOrderingCurrent } from "../syncOrdering";
import { assertTenantRelationshipIntegrityCurrent } from "../tenantIntegrity";
import { assertBootstrapClaimCurrent } from "../bootstrapClaim";
import { assertTenantEntityIndexesCurrent } from "../tenantIndexes";
import { statementCaches } from "./statementCache";
/** Open/configure the SQLite handle without creating or migrating application tables. Production
 * startup uses this seam to inspect the migration plan and take its rollback snapshot first. */
export function openDbConnection(path: string): Db {
  let db: Db;
  try {
    db = new DatabaseSync(path, {
      enableForeignKeyConstraints: false,
      timeout: 5000,
    });
  } catch (e) {
    // Boot SHOULD crash on an unopenable DB — but frame the raw node:sqlite error with the path so
    // an operator sees "could not open <CAPACITYLENS_DB>" instead of a bare stack. Rethrow (don't swallow).
    throw new Error(`Could not open the SQLite database at "${path}": ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    });
  }
  databasePaths.set(db, path);
  // Also set the pragma explicitly: constructor timeout is the primary Node 24 path; the pragma
  // pins the behavior if the driver construction path changes later.
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

// DatabaseSync does not expose its filename. Retain it only for handles opened through this module
// so successful identity planning can harden the file without touching a database we then refuse.
const databasePaths = new WeakMap<Db, string>();

export function restrictIdentifiedDatabasePermissions(db: Db): void {
  const path = databasePaths.get(db);
  if (!path || path === ":memory:") return;
  try {
    chmodSync(path, 0o600);
    // WAL/SHM may not exist until the first write; the process umask protects later files.
  } catch (cause) {
    throw new Error(`Could not restrict database permissions at "${path}".`, {
      cause,
    });
  }
}

/** Apply every pending migration and finish configuring an already-open handle. Each version step
 * owns one BEGIN IMMEDIATE transaction and advances user_version inside that same commit. */
export function initializeOpenDb(db: Db, path: string, hooks: DatabaseMigrationHooks = {}): DatabaseMigrationPlan {
  const plan = planDatabaseMigrations(db);
  if (!plan.fresh) {
    const quickCheck = db.prepare("PRAGMA quick_check").all() as Array<{
      quick_check?: string;
    }>;
    if (quickCheck.length !== 1 || quickCheck[0]?.quick_check !== "ok") {
      throw new Error(`Database quick integrity check failed before migration (${quickCheck.length} result row(s)).`);
    }
  }

  db.exec("PRAGMA journal_mode = WAL;");
  const journalMode = String(
    (db.prepare("PRAGMA journal_mode").get() as { journal_mode?: unknown }).journal_mode ?? "",
  ).toLowerCase();
  if (path !== ":memory:" && journalMode !== "wal") {
    throw new Error(`SQLite journal mode is ${journalMode || "unknown"}; expected WAL.`);
  }
  // A successful write acknowledgement must not inherit a runtime-dependent SQLite default.
  // FULL asks SQLite to sync the WAL at every commit; the assertion makes a driver/build that
  // cannot establish that policy a startup failure instead of silently weakening durability.
  db.exec("PRAGMA synchronous = FULL;");
  const synchronous = Number((db.prepare("PRAGMA synchronous").get() as { synchronous?: number }).synchronous);
  if (synchronous !== 2) {
    throw new Error(`SQLite synchronous durability policy is ${synchronous}; expected FULL (2).`);
  }
  db.exec("PRAGMA foreign_keys = OFF;");
  // Holds the FIRST failure inside the guarded region so a failing cleanup PRAGMA in the finally
  // block can never mask it; if the body succeeded, a cleanup failure surfaces on its own.
  const initErrorRef: { error?: unknown } = {};
  let bodyFailed = false;
  try {
    try {
      for (const pending of plan.migrations) {
        const migration = DATABASE_MIGRATIONS.find((candidate) => candidate.version === pending.version);
        if (!migration) throw new Error(`Missing database migration implementation for v${pending.version}.`);
        let afterCommit: (() => void) | undefined;
        tx(
          db,
          () => {
            // Planning is deliberately read-only and happens before BEGIN IMMEDIATE so startup can take a
            // rollback snapshot first. Another same-version process may therefore finish this step while
            // this handle waits for SQLite's writer lock. Re-read only AFTER acquiring that lock and
            // validate the winner's immutable ledger before treating its commit as our clean no-op.
            const currentVersion = pragmaNumber(db, "user_version");
            if (currentVersion >= migration.version) {
              if (currentVersion > DB_SCHEMA_VERSION) {
                throw new Error(
                  `Database schema version ${currentVersion} is newer than this server supports (${DB_SCHEMA_VERSION}); refusing a downgrade.`,
                );
              }
              assertMigrationHistory(db, currentVersion);
              return;
            }
            db.exec(MIGRATION_HISTORY_SQL);
            assertMigrationHistoryTable(db);
            afterCommit = migration.up(db) ?? undefined;
            const fkViolations = db.prepare("PRAGMA foreign_key_check").all();
            if (fkViolations.length > 0) {
              throw new Error(
                `Database migration v${migration.version} (${migration.name}) left ${fkViolations.length} foreign-key violation(s).`,
              );
            }
            db.prepare(
              `INSERT INTO ${DATABASE_MIGRATION_TABLE} (version, name, checksum, appliedAt) VALUES (?, ?, ?, ?)`,
            ).run(migration.version, migration.name, migration.checksum, new Date().toISOString());
            db.exec(`PRAGMA application_id = ${CAPACITYLENS_APPLICATION_ID}`);
            db.exec(`PRAGMA user_version = ${migration.version}`);
            hooks.beforeCommit?.({
              version: migration.version,
              name: migration.name,
              checksum: migration.checksum,
            });
          },
          "immediate",
        );
        afterCommit?.();
      }

      // Control tables are an idempotent every-boot repair boundary, not only a v8 migration helper.
      // Reserve the writer before inspecting them so a concurrent process cannot race the repair.
      tx(
        db,
        () => {
          ensureControlTables(db);
          repairEmptyAccountWorkingDays(db);
        },
        "immediate",
      );

      assertSchemaCurrent(db);
      assertControlTablesCurrent(db);
      assertMemberSignInTrackingSchemaCurrent(db);
      assertSingleOwnerControlPlaneCurrent(db);
      assertAccountBoundaryStateCurrent(db);
      assertAuditOutboxCurrent(db);
      assertSyncOrderingCurrent(db);
      assertTenantRelationshipIntegrityCurrent(db);
      assertBootstrapClaimCurrent(db);
      assertTenantEntityIndexesCurrent(db);
      assertMigrationHistory(db, DB_SCHEMA_VERSION);
      if (pragmaNumber(db, "user_version") !== DB_SCHEMA_VERSION) {
        throw new Error(`Database migration did not reach expected version ${DB_SCHEMA_VERSION}.`);
      }
      if (pragmaNumber(db, "application_id") !== CAPACITYLENS_APPLICATION_ID) {
        throw new Error("Database migration did not stamp the CapacityLens application_id.");
      }
    } catch (initError) {
      bodyFailed = true;
      throw initError;
    }
  } finally {
    // This handle may be retained by migration tooling after a surfaced failure. Never leave its
    // connection-scoped integrity enforcement disabled merely because initialization did not finish.
    // A cleanup PRAGMA failure on a broken connection must never MASK the original init failure,
    // so it is recorded here and rethrown below only when the body itself had succeeded.
    try {
      db.exec("PRAGMA foreign_keys = ON;");
    } catch (pragmaError) {
      if (!bodyFailed) initErrorRef.error = pragmaError;
    }
  }

  if (initErrorRef.error !== undefined) throw initErrorRef.error;

  const fkViolations = db.prepare("PRAGMA foreign_key_check").all();
  if (fkViolations.length > 0) {
    throw new Error(`Database foreign-key integrity check failed (${fkViolations.length} violation(s)).`);
  }
  if (path !== ":memory:") {
    try {
      // Schema setup normally creates the WAL/SHM sidecars after the first chmod above. Pin every
      // file in the SQLite set before returning the live handle; process.umask(0077) protects any
      // sidecar SQLite later recreates in the server process.
      for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
        if (existsSync(file)) chmodSync(file, 0o600);
      }
    } catch (cause) {
      throw new Error(`Could not restrict SQLite file permissions at "${path}".`, { cause });
    }
  }
  // initializeOpenDb is the only schema-change boundary (migrations + ALTERs happen only here).
  // node:sqlite Statement objects freeze their column set at prepare time, so any statement cached
  // while migrations were still running (e.g. migration 8's loadState call, prepared while the
  // schema was still at v8) must be discarded here — otherwise it keeps returning its stale,
  // pre-ALTER column list forever. Dropping the handle's cache before returning guarantees every
  // statement callers see cached afterward is prepared against the final, fully-migrated schema.
  statementCaches.delete(db);
  return plan;
}

/** Convenience open used by tests and embedded callers. The production entrypoint uses
 * openDbConnection → pre-migration snapshot → initializeOpenDb instead. */
export function openDb(path: string): Db {
  const db = openDbConnection(path);
  try {
    initializeOpenDb(db, path);
    return db;
  } catch (error) {
    try {
      db.close();
    } catch (cleanupError) {
      console.error("capacitylens-server: failed to close SQLite after open failure", cleanupError);
    }
    throw error;
  }
}

import type { Db } from "../db";
import type { DatabaseMigrationPlan } from "./migrationLedger";
import { pragmaNumber, userTables, hasLegacyCapacityLensShape } from "./introspection";
import { DB_SCHEMA_VERSION, CAPACITYLENS_APPLICATION_ID } from "./constants";
import { assertMigrationHistory } from "./migrationHistory";
import { restrictIdentifiedDatabasePermissions } from "./filePermissions";
import { DATABASE_MIGRATIONS } from "./migrations/index";
/** Read-only migration planning. It rejects future/wrong-application files before any schema DDL. */
export function planDatabaseMigrations(db: Db): DatabaseMigrationPlan {
  const fromVersion = pragmaNumber(db, "user_version");
  const applicationId = pragmaNumber(db, "application_id");
  const tables = userTables(db);
  const fresh = tables.length === 0;

  if (!Number.isSafeInteger(fromVersion) || fromVersion < 0) {
    throw new Error(`Database schema version is invalid (${fromVersion}).`);
  }
  if (fromVersion > DB_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${fromVersion} is newer than this server supports (${DB_SCHEMA_VERSION}); refusing a downgrade.`,
    );
  }
  if (applicationId !== 0 && applicationId !== CAPACITYLENS_APPLICATION_ID) {
    throw new Error(
      `SQLite application_id ${applicationId} does not identify a CapacityLens database; refusing to modify this file.`,
    );
  }
  if (!fresh && applicationId === 0) {
    if (!hasLegacyCapacityLensShape(db, tables)) {
      throw new Error(
        "SQLite file has tables but no CapacityLens application_id or legacy CapacityLens shape; refusing to modify it.",
      );
    }
  }
  if (fromVersion === DB_SCHEMA_VERSION && applicationId !== CAPACITYLENS_APPLICATION_ID) {
    throw new Error(
      "Current-version database is missing the CapacityLens application_id; refusing ambiguous schema repair.",
    );
  }
  assertMigrationHistory(db, fromVersion);
  // Identity, supported version and immutable migration history are now established. Only at this
  // point does the file belong to this application and become safe to harden.
  restrictIdentifiedDatabasePermissions(db);

  return {
    fromVersion,
    toVersion: DB_SCHEMA_VERSION,
    fresh,
    migrations: DATABASE_MIGRATIONS.filter((migration) => migration.version > fromVersion).map(
      ({ version, name, checksum }) => ({ version, name, checksum }),
    ),
  };
}

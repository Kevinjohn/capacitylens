import type { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

// Preserve the public data-access entry point for existing consumers.
export { isEmpty } from "@capacitylens/shared/types/entities";
export { DB_SCHEMA_VERSION, CAPACITYLENS_APPLICATION_ID, DATABASE_MIGRATION_TABLE } from "./db/constants";
export { type DatabaseMigrationPlan, type DatabaseMigrationHooks } from "./db/migrationLedger";
export { V13_FROZEN_PRESET_COLORS, V13_DEFINITION } from "./db/migrations/definitions";
export { planDatabaseMigrations } from "./db/migrationPlan";
export { openDbConnection, initializeOpenDb, openDb } from "./db/open";
export {
  insertRow,
  type RewrittenAllocationRevision,
  clearAllocationAttributionForActivities,
  upsertRow,
  deleteRow,
  getRow,
} from "./db/rows";
export {
  loadState,
  listAccountSummaries,
  type ProjectedAccountSlice,
  type CompleteAccountSlice,
  validatedCompleteAccountSlice,
  readSlice,
  readFullSlice,
} from "./db/slices";
export {
  markInitialized,
  isInitialized,
  seedIfUninitialized,
  insertAll,
  wipe,
  replaceAccountSlice,
} from "./db/lifecycle";

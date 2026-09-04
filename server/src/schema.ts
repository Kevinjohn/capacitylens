import type { Db } from "./db";
import { assertSchemaVersion } from "./schema/assert";
import {
  V16_TABLES,
  V27_TABLES,
  V28_TABLES,
  V29_TABLES,
  V30_TABLES,
  V31_TABLES,
  V32_TABLES,
  V33_TABLES,
  V34_TABLES,
  V8_TABLES,
  V9_TABLES,
} from "./schema/historicalSpecs";
import { TABLES } from "./tables";
export { hasColumn } from "./schema/introspection";
export { migrateSchema, migrateSchemaV8, renameLegacyActivityTables } from "./schema/migrate";
// Schema migration + assertion, extracted from db.ts. openDb() runs migrateSchema (bring
// an existing file up to the current shape in place) and then assertSchemaCurrent (fail
// loudly on drift it can't repair). Both introspect the live shape via PRAGMA and are a
// no-op on any fresh / current / already-migrated DB.
/** Assert the immutable v8 baseline while migration v8 is the active step. */
export function assertSchemaV8(db: Db): void {
  assertSchemaVersion(db, V8_TABLES, false);
}

/** Assert the immutable v9 shape without requiring columns introduced by later migrations. */
export function assertSchemaV9(db: Db): void {
  assertSchemaVersion(db, V9_TABLES, false);
}

/** Assert the immutable v16 entity-table shape without requiring fields from later migrations. */
export function assertSchemaV16(db: Db): void {
  assertSchemaVersion(db, V16_TABLES, false);
}

/** Assert the released v27 shape without requiring the v28 resource half-day column. */
export function assertSchemaV27(db: Db): void {
  assertSchemaVersion(db, V27_TABLES, true);
}

/** Assert the released v28 shape without requiring the v29 resource engagement column. */
export function assertSchemaV28(db: Db): void {
  assertSchemaVersion(db, V28_TABLES, true);
}

/** Assert the released v29 shape without requiring the v30 engagement-grouping preference. */
export function assertSchemaV29(db: Db): void {
  assertSchemaVersion(db, V29_TABLES, true);
}

/** Assert the released v30 shape without requiring the v31 account working-days column. */
export function assertSchemaV30(db: Db): void {
  assertSchemaVersion(db, V30_TABLES, true);
}

/** Assert the released v31 shape without requiring the v32 allocation series column. */
export function assertSchemaV31(db: Db): void {
  assertSchemaVersion(db, V31_TABLES, true);
}

/** Assert the released v32 shape without requiring nullable company-wide time off. */
export function assertSchemaV32(db: Db): void {
  assertSchemaVersion(db, V32_TABLES, true);
}

/** Assert the released v33 nullable-time-off shape before the closure table exists. */
export function assertSchemaV33(db: Db): void {
  assertSchemaVersion(db, V33_TABLES, true);
}

/** Assert the released v34 shape before allocation project attribution exists. */
export function assertSchemaV34(db: Db): void {
  assertSchemaVersion(db, V34_TABLES, true);
}

/** Assert that the live database matches the current entity/table specification. */
export function assertSchemaCurrent(db: Db): void {
  assertSchemaVersion(db, TABLES, true);
}

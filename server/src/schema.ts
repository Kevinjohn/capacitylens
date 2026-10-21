import type { Db } from "./db";
import { assertMemberResourceKindCleanupTrigger, assertSchemaVersion } from "./schema/assert";
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
  V35_TABLES,
  V36_TABLES,
  V37_TABLES,
  V38_TABLES,
  V39_TABLES,
  V40_TABLES,
  V8_TABLES,
  V9_TABLES,
} from "./schema/historicalSpecs";
import { TABLES } from "./tables";
export { hasColumn } from "./schema/introspection";
export { migrateSchema, migrateSchemaV8, renameLegacyActivityTables } from "./schema/migrate";
// Versioned migrations establish the released shape. These assertions verify historical steps
// independently and check the complete current entity contract before startup accepts traffic.
/** Assert the immutable v8 baseline while migration v8 is the active step. */
export function assertSchemaV8(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V8_TABLES, allowCompatibleExtensions: false });
}

/** Assert the immutable v9 shape without requiring columns introduced by later migrations. */
export function assertSchemaV9(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V9_TABLES, allowCompatibleExtensions: false });
}

/** Assert the immutable v16 entity-table shape without requiring fields from later migrations. */
export function assertSchemaV16(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V16_TABLES, allowCompatibleExtensions: false });
}

/** Assert the released v27 shape without requiring the v28 resource half-day column. */
export function assertSchemaV27(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V27_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v28 shape without requiring the v29 resource engagement column. */
export function assertSchemaV28(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V28_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v29 shape without requiring the v30 engagement-grouping preference. */
export function assertSchemaV29(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V29_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v30 shape without requiring the v31 account working-days column. */
export function assertSchemaV30(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V30_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v31 shape without requiring the v32 allocation series column. */
export function assertSchemaV31(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V31_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v32 shape without requiring nullable company-wide time off. */
export function assertSchemaV32(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V32_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v33 nullable-time-off shape before the closure table exists. */
export function assertSchemaV33(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V33_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v34 shape before allocation project attribution exists. */
export function assertSchemaV34(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V34_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v35 shape before Activity lifecycle tombstones are added. */
export function assertSchemaV35(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V35_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v36 shape before allocation task fields are added. */
export function assertSchemaV36(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V36_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v37 shape before person availability columns are added. */
export function assertSchemaV37(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V37_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v38 shape before Capacity Overview access is added. */
export function assertSchemaV38(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V38_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v39 shape before the account-wide date format is added. */
export function assertSchemaV39(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V39_TABLES, allowCompatibleExtensions: true });
}

/** Assert the released v40 shape once the account-wide date format has been added. */
export function assertSchemaV40(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: V40_TABLES, allowCompatibleExtensions: true });
}

/** Assert that the live database matches the current entity/table specification. */
export function assertSchemaCurrent(db: Db): void {
  assertSchemaVersion({ db: db, tableSpecs: TABLES, allowCompatibleExtensions: true });
  assertMemberResourceKindCleanupTrigger(db);
}

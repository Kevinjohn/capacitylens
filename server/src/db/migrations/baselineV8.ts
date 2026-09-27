import { defineMigration } from "../migrationLedger";
import { SCHEMA_V8_SQL, INTERNAL_CLIENT_UNIQUE_INDEX_SQL } from "../../tables";
import { renameLegacyActivityTables, migrateSchemaV8, assertSchemaV8 } from "../../schema";
import { ensureControlTables, assertControlTablesCurrent } from "../../controlTables";
import { isInitialized, markInitialized } from "../initialization";
import { isEmpty } from "@capacitylens/shared/types/entities";
import { readState } from "../slices";
import { ensureInternalClients } from "../repairs";

/** The first ledger entry preserves the original legacy-database repair boundary. */
export const BASELINE_V8_MIGRATION = defineMigration(
  8,
  "establish-explicit-migration-baseline",
  [
    "legacy-activity-table-rename:v1",
    SCHEMA_V8_SQL,
    "legacy-schema-shape-repair:v1",
    "app-control-table-repair:v1",
    "initialization-marker-repair:v1",
    "internal-client-repair:v1",
    INTERNAL_CLIENT_UNIQUE_INDEX_SQL,
  ].join("\n-- migration component --\n"),
  (db) => {
    renameLegacyActivityTables(db);
    db.exec(SCHEMA_V8_SQL);
    migrateSchemaV8(db);
    ensureControlTables(db);
    if (!isInitialized(db) && !isEmpty(readState(db))) markInitialized(db);
    ensureInternalClients(db);
    db.exec(INTERNAL_CLIENT_UNIQUE_INDEX_SQL);
    assertSchemaV8(db);
    assertControlTablesCurrent(db);
  },
);

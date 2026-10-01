import { assertSchemaV38, assertSchemaV39 } from "../../schema";
import { assertAccountRelationshipIntegrityCurrent } from "../../accountIntegrity";
import { assertAccountEntityIndexesCurrent } from "../../accountIndexes";
import { tableHasColumns } from "../introspection";
import { defineMigration } from "../migrationLedger";
import { CAPACITY_OVERVIEW_ACCESS_V39_DEFINITION } from "./definitions";

export const CAPACITY_OVERVIEW_ACCESS_V39_MIGRATION = defineMigration(
  39,
  "add-capacity-overview-access",
  CAPACITY_OVERVIEW_ACCESS_V39_DEFINITION,
  (db) => {
    assertSchemaV38(db);
    if (!tableHasColumns(db, "accounts", ["capacityOverviewAccess"])) {
      db.exec("ALTER TABLE accounts ADD COLUMN capacityOverviewAccess TEXT;");
    }
    assertSchemaV39(db);
    assertAccountRelationshipIntegrityCurrent(db);
    assertAccountEntityIndexesCurrent(db);
  },
);

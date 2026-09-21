import { GETTING_STARTED_DISMISSALS_V45_SQL } from "../../accounts/gettingStartedDismissal";
import { defineMigration } from "../migrationLedger";

export const GETTING_STARTED_DISMISSALS_V45_MIGRATION = defineMigration(
  45,
  "add-getting-started-dismissals",
  GETTING_STARTED_DISMISSALS_V45_SQL,
  (db) => {
    db.exec(GETTING_STARTED_DISMISSALS_V45_SQL);
  },
);

export const GETTING_STARTED_DISMISSALS_V45_PIN = {
  version: GETTING_STARTED_DISMISSALS_V45_MIGRATION.version,
  name: GETTING_STARTED_DISMISSALS_V45_MIGRATION.name,
  checksum: GETTING_STARTED_DISMISSALS_V45_MIGRATION.checksum,
};

import { assertTenantEntityIndexesCurrent } from "../../tenantIndexes";
import { assertTenantRelationshipIntegrityCurrent } from "../../tenantIntegrity";
import { tableHasColumns } from "../introspection";
import { defineMigration } from "../migrationLedger";

/** The unreleased v42 migration definition and runner for person avatar URLs. */
export const RESOURCE_AVATAR_URL_V42_MIGRATION = defineMigration(
  42,
  "add-resource-avatar-url",
  ["guard:PRAGMA table_info(resources):avatarUrl-missing", "ALTER TABLE resources ADD COLUMN avatarUrl TEXT;"].join(
    "\n",
  ),
  (db) => {
    if (!tableHasColumns(db, "resources", ["avatarUrl"])) {
      db.exec("ALTER TABLE resources ADD COLUMN avatarUrl TEXT;");
    }
    assertTenantRelationshipIntegrityCurrent(db);
    assertTenantEntityIndexesCurrent(db);
  },
);

/** Public checksum identity used by version-sensitive planning contracts. */
export const RESOURCE_AVATAR_URL_V42_PIN = {
  version: RESOURCE_AVATAR_URL_V42_MIGRATION.version,
  name: RESOURCE_AVATAR_URL_V42_MIGRATION.name,
  checksum: RESOURCE_AVATAR_URL_V42_MIGRATION.checksum,
};

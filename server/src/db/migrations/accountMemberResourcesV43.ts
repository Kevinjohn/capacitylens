import { ACCOUNT_MEMBER_RESOURCES_SQL, ensureAccountMemberResources } from "../../controlTables/accountMemberResources";
import { defineMigration } from "../migrationLedger";

/** The immutable v43 migration for account-scoped member/person avatar links. */
export const ACCOUNT_MEMBER_RESOURCES_V43_MIGRATION = defineMigration(
  43,
  "add-account-member-resource-links",
  ["control-table:no-foreign-keys:v1", ACCOUNT_MEMBER_RESOURCES_SQL].join("\n-- migration component --\n"),
  ensureAccountMemberResources,
);

/** Public checksum identity used by version-sensitive planning contracts. */
export const ACCOUNT_MEMBER_RESOURCES_V43_PIN = {
  version: ACCOUNT_MEMBER_RESOURCES_V43_MIGRATION.version,
  name: ACCOUNT_MEMBER_RESOURCES_V43_MIGRATION.name,
  checksum: ACCOUNT_MEMBER_RESOURCES_V43_MIGRATION.checksum,
};

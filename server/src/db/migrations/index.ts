import { type DatabaseMigration, defineMigration } from "../migrationLedger";
import { tableHasColumns } from "../introspection";
import { DB_SCHEMA_VERSION } from "../constants";
import { SCHEMA_V8_SQL, INTERNAL_CLIENT_UNIQUE_INDEX_SQL } from "../../tables";
import { renameLegacyActivityTables, migrateSchemaV8, assertSchemaV8, assertSchemaV9 } from "../../schema";
import { assertSchemaV16, assertSchemaV27, assertSchemaV28, assertSchemaV29, assertSchemaV30 } from "../../schema";
import { assertSchemaV31, assertSchemaV32, assertSchemaV33, assertSchemaV34, assertSchemaCurrent } from "../../schema";
import { ensureControlTables, assertControlTablesCurrent, SINGLE_OWNER_INDEX } from "../../controlTables";
import { migrateSingleOwnerControlPlaneV10, assertSingleOwnerControlPlaneV10 } from "../../controlTables";
import { migrateOwnerlessControlPlaneV11, assertSingleOwnerControlPlaneCurrent } from "../../controlTables";
import { reportOwnerlessPromotionsV11, migrateOwnerResetCeremoniesV12 } from "../../controlTables";
import { migrateMemberResetCeremoniesV14, USED_INVITATION_RETENTION_V24_DEFINITION } from "../../controlTables";
import { migrateUsedInvitationHistoryV24 } from "../../controlTables";
import { isInitialized, markInitialized } from "../initialization";
import { isEmpty } from "@capacitylens/shared/types/entities";
import { loadState } from "../slices";
import { ensureInternalClients, snapLegacyAccountColors, reactivateBuiltinInternalClientsV22 } from "../repairs";
import { assertBuiltinInternalClientsActiveV22 } from "../repairs";
import { V13_DEFINITION, V22_DEFINITION, TIME_OFF_RESOURCE_NULLABLE_V33_DEFINITION } from "./definitions";
import { migrateTimeOffResourceNullableV33, COMPANY_CLOSURES_V34_DEFINITION } from "./definitions";
import { migrateCompanyClosuresV34 } from "./definitions";
import { ACCOUNT_BOUNDARY_STATE_V15_SQL, assertAccountBoundaryStateCurrent } from "../../accounts/state";
import { AUDIT_OUTBOX_SQL, assertAuditOutboxCurrent } from "../../auditOutbox";
import { SYNC_ORDERING_SQL, assertSyncOrderingCurrent } from "../../syncOrdering";
import { TENANT_RELATIONSHIP_INTEGRITY_V19_SQL, assertTenantRelationshipIntegrityV19 } from "../../tenantIntegrity";
import { assertTenantRelationshipIntegrityV34 } from "../../tenantIntegrity";
import { ALLOCATION_PROJECT_TENANT_INTEGRITY_V35_SQL } from "../../tenantIntegrity";
import { assertTenantRelationshipIntegrityCurrent } from "../../tenantIntegrity";
import { BOOTSTRAP_CLAIM_V20_DEFINITION, migrateBootstrapClaimV20 } from "../../bootstrapClaim";
import { assertBootstrapClaimCurrent } from "../../bootstrapClaim";
import { TENANT_ENTITY_INDEXES_V21_SQL, assertTenantAccountIndexesV21 } from "../../tenantIndexes";
import { FOREIGN_KEY_CHILD_INDEXES_V23_SQL, assertTenantEntityIndexesV23 } from "../../tenantIndexes";
import { assertTenantEntityIndexesV34, ALLOCATION_PROJECT_INDEX_V35_SQL } from "../../tenantIndexes";
import { assertTenantEntityIndexesCurrent } from "../../tenantIndexes";
import { FEDERATED_IDENTITY_V25_DEFINITION, migrateFederatedIdentityV25 } from "../../auth";
import { assertFederatedIdentitySchemaCurrent } from "../../auth";
import { MEMBER_SIGN_IN_TRACKING_V26_DEFINITION } from "../../accounts/memberSignInTracking";
import { migrateMemberSignInTrackingV26 } from "../../accounts/memberSignInTracking";
import { assertMemberSignInTrackingSchemaCurrent } from "../../accounts/memberSignInTracking";
export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  defineMigration(
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
      // Consolidate every legacy v0-v7 file through the already-proven, introspection-gated
      // repair path. From v8 onward, persisted changes get their own ordered migration entry.
      renameLegacyActivityTables(db);
      db.exec(SCHEMA_V8_SQL);
      migrateSchemaV8(db);
      ensureControlTables(db);
      if (!isInitialized(db) && !isEmpty(loadState(db))) markInitialized(db);
      ensureInternalClients(db);
      db.exec(INTERNAL_CLIENT_UNIQUE_INDEX_SQL);
      assertSchemaV8(db);
      assertControlTablesCurrent(db);
    },
  ),
  defineMigration(
    9,
    "add-internal-colour-mode",
    [
      "guard:PRAGMA table_info(accounts):internalColourMode-missing",
      "ALTER TABLE accounts ADD COLUMN internalColourMode TEXT;",
    ].join("\n"),
    (db) => {
      // Some pre-ledger development databases were manually version-stamped after receiving the
      // current optional-column repair. Keep the explicit migration idempotent for that shape while
      // real released v8 databases take the ALTER path.
      if (!tableHasColumns(db, "accounts", ["internalColourMode"])) {
        db.exec("ALTER TABLE accounts ADD COLUMN internalColourMode TEXT;");
      }
      assertSchemaV9(db);
    },
  ),
  defineMigration(
    10,
    "enforce-single-owner",
    [
      "repair:retain-oldest-active-owner-demote-additional-to-admin:v1",
      "DELETE FROM invites WHERE role = 'owner' AND usedAt IS NULL;",
      `CREATE UNIQUE INDEX ${SINGLE_OWNER_INDEX} ON account_members(accountId) WHERE role = 'owner' AND status = 'active';`,
    ].join("\n"),
    (db) => {
      migrateSingleOwnerControlPlaneV10(db);
      assertSingleOwnerControlPlaneV10(db);
    },
  ),
  defineMigration(
    11,
    "repair-ownerless-memberships",
    "repair:promote-highest-role-tier-active-member-when-ownerless:v2",
    (db) => {
      const promotions = migrateOwnerlessControlPlaneV11(db);
      assertSingleOwnerControlPlaneCurrent(db);
      return () => reportOwnerlessPromotionsV11(promotions);
    },
  ),
  defineMigration(
    12,
    "revoke-owner-reset-ceremonies",
    "repair:revoke-outstanding-verification-ceremonies-for-active-owners:v1",
    (db) => {
      migrateOwnerResetCeremoniesV12(db);
      assertSingleOwnerControlPlaneCurrent(db);
    },
  ),
  defineMigration(13, "snap-legacy-account-colors", V13_DEFINITION, (db) => {
    snapLegacyAccountColors(db);
  }),
  defineMigration(
    14,
    "revoke-member-reset-ceremonies",
    "repair:revoke-outstanding-verification-ceremonies-for-active-members:v1",
    (db) => {
      // v12 revoked ceremonies for active OWNERS only, so co-owners the v10-era raw-SQL repairs
      // DEMOTED to admin kept reset links minted at Owner privilege. The blanket every-active-member
      // scope is deliberate — see migrateMemberResetCeremoniesV14 (the original v11 destroyed the
      // role history a targeted revocation would need).
      migrateMemberResetCeremoniesV14(db);
      assertSingleOwnerControlPlaneCurrent(db);
    },
  ),
  defineMigration(15, "add-account-boundary-state", ACCOUNT_BOUNDARY_STATE_V15_SQL, (db) => {
    db.exec(ACCOUNT_BOUNDARY_STATE_V15_SQL);
    assertAccountBoundaryStateCurrent(db);
  }),
  defineMigration(
    16,
    "add-account-view-prefs",
    [
      "guard:PRAGMA table_info(accounts):view-prefs-missing",
      "ALTER TABLE accounts ADD COLUMN showInternalProjects TEXT;",
      "ALTER TABLE accounts ADD COLUMN showInternalActivities TEXT;",
      "ALTER TABLE accounts ADD COLUMN inlineActivityCreateEnabled TEXT;",
    ].join("\n"),
    (db) => {
      // Idempotent per-column ADD (mirrors migration 9's add-internal-colour-mode guard): a
      // pre-ledger dev database may already carry a subset from the generic optional-column repair,
      // so add only the columns that are actually missing. Absent columns read back as undefined and
      // default to true (shown/enabled) on the client.
      for (const column of ["showInternalProjects", "showInternalActivities", "inlineActivityCreateEnabled"]) {
        if (!tableHasColumns(db, "accounts", [column])) db.exec(`ALTER TABLE accounts ADD COLUMN ${column} TEXT;`);
      }
      assertSchemaV16(db);
    },
  ),
  defineMigration(17, "add-durable-audit-outbox", AUDIT_OUTBOX_SQL, (db) => {
    db.exec(AUDIT_OUTBOX_SQL);
    assertAuditOutboxCurrent(db);
  }),
  defineMigration(18, "add-browser-sync-ordering", SYNC_ORDERING_SQL, (db) => {
    db.exec(SYNC_ORDERING_SQL);
    assertSyncOrderingCurrent(db);
  }),
  defineMigration(
    19,
    "enforce-tenant-relationship-integrity",
    [TENANT_RELATIONSHIP_INTEGRITY_V19_SQL, "assert:no-cross-account-existing-relationships:v1"].join(
      "\n-- migration component --\n",
    ),
    (db) => {
      db.exec(TENANT_RELATIONSHIP_INTEGRITY_V19_SQL);
      assertTenantRelationshipIntegrityV19(db);
    },
  ),
  defineMigration(20, "version-bootstrap-claim-control", BOOTSTRAP_CLAIM_V20_DEFINITION, (db) => {
    migrateBootstrapClaimV20(db);
    assertBootstrapClaimCurrent(db);
  }),
  defineMigration(21, "index-tenant-entity-slices", TENANT_ENTITY_INDEXES_V21_SQL, (db) => {
    db.exec(TENANT_ENTITY_INDEXES_V21_SQL);
    assertTenantAccountIndexesV21(db);
  }),
  defineMigration(22, "reactivate-builtin-internal-clients", V22_DEFINITION, (db) => {
    reactivateBuiltinInternalClientsV22(db);
    assertBuiltinInternalClientsActiveV22(db);
  }),
  defineMigration(23, "index-foreign-key-children", FOREIGN_KEY_CHILD_INDEXES_V23_SQL, (db) => {
    db.exec(FOREIGN_KEY_CHILD_INDEXES_V23_SQL);
    assertTenantEntityIndexesV23(db);
  }),
  defineMigration(24, "bound-used-invitation-history", USED_INVITATION_RETENTION_V24_DEFINITION, (db) => {
    migrateUsedInvitationHistoryV24(db);
    assertControlTablesCurrent(db);
  }),
  defineMigration(25, "secure-federated-identity-linking", FEDERATED_IDENTITY_V25_DEFINITION, (db) => {
    migrateFederatedIdentityV25(db);
    // Validate while the migration transaction still owns both DDL and ledger writes. A malformed
    // pre-existing IF-NOT-EXISTS object must roll the entire version step back to v24.
    assertFederatedIdentitySchemaCurrent(db);
  }),
  defineMigration(26, "add-member-sign-in-confirmation", MEMBER_SIGN_IN_TRACKING_V26_DEFINITION, (db) => {
    migrateMemberSignInTrackingV26(db);
    assertMemberSignInTrackingSchemaCurrent(db);
  }),
  defineMigration(
    27,
    "add-resource-favourites",
    [
      "guard:PRAGMA table_info(resources):isFavourite-missing",
      "ALTER TABLE resources ADD COLUMN isFavourite TEXT;",
    ].join("\n"),
    (db) => {
      if (!tableHasColumns(db, "resources", ["isFavourite"])) {
        db.exec("ALTER TABLE resources ADD COLUMN isFavourite TEXT;");
      }
      assertSchemaV27(db);
    },
  ),
  defineMigration(
    28,
    "add-resource-half-days",
    [
      "guard:PRAGMA table_info(resources):halfDays-missing",
      "ALTER TABLE resources ADD COLUMN halfDays TEXT NOT NULL DEFAULT '[]';",
    ].join("\n"),
    (db) => {
      if (!tableHasColumns(db, "resources", ["halfDays"])) {
        db.exec("ALTER TABLE resources ADD COLUMN halfDays TEXT NOT NULL DEFAULT '[]';");
      }
      assertSchemaV28(db);
    },
  ),
  defineMigration(
    29,
    "add-resource-engagement",
    [
      "guard:PRAGMA table_info(resources):engagement-missing",
      "ALTER TABLE resources ADD COLUMN engagement TEXT NOT NULL DEFAULT 'studio';",
    ].join("\n"),
    (db) => {
      if (!tableHasColumns(db, "resources", ["engagement"])) {
        db.exec("ALTER TABLE resources ADD COLUMN engagement TEXT NOT NULL DEFAULT 'studio';");
      }
      assertSchemaV29(db);
    },
  ),
  defineMigration(
    30,
    "add-engagement-grouping-preference",
    [
      "guard:PRAGMA table_info(accounts):groupResourcesByEngagement-missing",
      "ALTER TABLE accounts ADD COLUMN groupResourcesByEngagement TEXT;",
    ].join("\n"),
    (db) => {
      if (!tableHasColumns(db, "accounts", ["groupResourcesByEngagement"])) {
        db.exec("ALTER TABLE accounts ADD COLUMN groupResourcesByEngagement TEXT;");
      }
      assertSchemaV30(db);
    },
  ),
  defineMigration(
    31,
    "add-account-working-days",
    [
      "guard:PRAGMA table_info(accounts):workingDays-missing",
      "ALTER TABLE accounts ADD COLUMN workingDays TEXT;",
      "backfill:weekStartsOn='0' => [0,1,2,3,4]; otherwise [1,2,3,4,5]",
    ].join("\n"),
    (db) => {
      if (!tableHasColumns(db, "accounts", ["workingDays"])) {
        db.exec("ALTER TABLE accounts ADD COLUMN workingDays TEXT;");
      }
      db.exec(`
        UPDATE accounts
           SET workingDays = CASE
             WHEN weekStartsOn = '0' THEN '[0,1,2,3,4]'
             ELSE '[1,2,3,4,5]'
           END
         WHERE workingDays IS NULL;
      `);
      assertSchemaV31(db);
    },
  ),
  defineMigration(
    32,
    "add-allocation-series-id",
    ["guard:PRAGMA table_info(allocations):seriesId-missing", "ALTER TABLE allocations ADD COLUMN seriesId TEXT;"].join(
      "\n",
    ),
    (db) => {
      if (!tableHasColumns(db, "allocations", ["seriesId"])) {
        db.exec("ALTER TABLE allocations ADD COLUMN seriesId TEXT;");
      }
      assertSchemaV32(db);
    },
  ),
  defineMigration(33, "allow-company-wide-time-off", TIME_OFF_RESOURCE_NULLABLE_V33_DEFINITION, (db) => {
    migrateTimeOffResourceNullableV33(db);
    assertSchemaV33(db);
    assertTenantRelationshipIntegrityV19(db);
    assertTenantEntityIndexesV23(db);
  }),
  defineMigration(34, "separate-company-closures", COMPANY_CLOSURES_V34_DEFINITION, (db) => {
    migrateCompanyClosuresV34(db);
    assertSchemaV34(db);
    assertTenantRelationshipIntegrityV34(db);
    assertTenantEntityIndexesV34(db);
  }),
  defineMigration(
    35,
    "add-allocation-project-id",
    [
      "guard:PRAGMA table_info(allocations):projectId-missing",
      "ALTER TABLE allocations ADD COLUMN projectId TEXT REFERENCES projects(id) ON DELETE SET NULL;",
      ALLOCATION_PROJECT_TENANT_INTEGRITY_V35_SQL,
      ALLOCATION_PROJECT_INDEX_V35_SQL,
    ].join("\n"),
    (db) => {
      if (!tableHasColumns(db, "allocations", ["projectId"])) {
        db.exec("ALTER TABLE allocations ADD COLUMN projectId TEXT REFERENCES projects(id) ON DELETE SET NULL;");
      }
      db.exec(ALLOCATION_PROJECT_TENANT_INTEGRITY_V35_SQL);
      db.exec(ALLOCATION_PROJECT_INDEX_V35_SQL);
      assertSchemaCurrent(db);
      assertTenantRelationshipIntegrityCurrent(db);
      assertTenantEntityIndexesCurrent(db);
    },
  ),
];

if (DATABASE_MIGRATIONS.at(-1)?.version !== DB_SCHEMA_VERSION) {
  throw new Error("DB_SCHEMA_VERSION must equal the newest explicit database migration.");
}
for (let index = 1; index < DATABASE_MIGRATIONS.length; index += 1) {
  if (DATABASE_MIGRATIONS[index].version !== DATABASE_MIGRATIONS[index - 1].version + 1) {
    throw new Error("Explicit database migration versions must be contiguous and ordered.");
  }
}

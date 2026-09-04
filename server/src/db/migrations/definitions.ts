import { type Db } from "../../db";
import { TENANT_ENTITY_INDEXES_V34_SQL } from "../../tenantIndexes";
import { CLOSURE_TENANT_INTEGRITY_V34_SQL } from "../../tenantIntegrity";
/**
 * FROZEN preset palette for the v13 `snap-legacy-account-colors` migration — a byte-for-byte copy of
 * shared `PRESET_COLORS` as it stood when v13 was authored. A checksummed migration must stay
 * REPRODUCIBLE forever, so it may NOT read the live shared palette: a future edit to
 * `PRESET_COLORS`/`snapToPresetColor` would silently change what this already-checksummed step does
 * to rows on disk while the checksum stayed the same (defineMigration's whole contract is that the
 * checksum covers everything the step does). Freezing the palette HERE — and folding its contents
 * into the v13 definition string so the checksum COVERS the exact palette — makes the migration
 * self-contained. The write-time guard (`sanitizeWrite`/`useStore`) keeps using the LIVE shared
 * mapper; the two only need to agree for colours written AFTER this migration, and both start from
 * this identical list today. If the shared palette is ever edited, THIS frozen copy must NOT follow —
 * a new colour policy is a NEW migration with its own frozen list and checksum.
 */
export const V13_FROZEN_PRESET_COLORS: readonly string[] = [
  "#f5bcbc",
  "#f7caba",
  "#f9d9b8",
  "#f9e6b8",
  "#f9f1b8",
  "#d9f2c0",
  "#c2f0d1",
  "#c0edf2",
  "#bed4f4",
  "#ccc0f2",
  "#e0c2f0",
  "#f4bedd",
  "#d8b397",
  "#eb7272",
  "#ef906e",
  "#f3ae6a",
  "#f3ca6a",
  "#f3e16a",
  "#aee37a",
  "#7edf9e",
  "#7adae3",
  "#76a5e7",
  "#947ae3",
  "#be7edf",
  "#e776b8",
  "#c38c61",
  "#e02727",
  "#e65621",
  "#ed841b",
  "#edae1b",
  "#edd11b",
  "#84d434",
  "#3ace6b",
  "#34c7d4",
  "#2d75da",
  "#5c34d4",
  "#9c3ace",
  "#da2d92",
  "#9e663c",
  "#9c1616",
  "#a13812",
  "#a5590d",
  "#a5780d",
  "#a5910d",
  "#59931f",
  "#248f47",
  "#1f8a93",
  "#1b4f98",
  "#3c1f93",
  "#6b248f",
  "#981b64",
  "#684327",
];

/** The ONE fixed colour v13 uses for a value that can't be parsed as a 6-digit hex at all (frozen
 * transcription of shared `FALLBACK_PRESET_COLOR` at authoring time — frozen for the same reason). */
export const V13_FALLBACK_PRESET_COLOR = "#5c34d4";

/** v13 migration definition string. The joined frozen-palette hex list and fallback are embedded so
 * the migration CHECKSUM covers the EXACT palette the repair snaps to: edit the frozen palette and
 * the definition (hence the checksum) changes with it, instead of the step silently drifting. */
export const V13_DEFINITION = [
  "repair:snap-every-stored-account-colour-to-its-nearest-preset:v2",
  `palette:${V13_FROZEN_PRESET_COLORS.join(",")}`,
  `fallback:${V13_FALLBACK_PRESET_COLOR}`,
].join("\n");

/** V22 predicate for "a built-in Internal client that is currently archived or soft-deleted" —
 * verbatim, so the repair's row scan and the post-repair assertion can never drift apart. */
export const V22_INACTIVE_BUILTIN_CLIENT_WHERE_SQL = `builtin = 'true' AND (archivedAt IS NOT NULL OR deletedAt IS NOT NULL)`;

export const V22_DEFINITION = [
  "repair:reactivate-built-in-internal-clients:v1",
  "scope:clients WHERE builtin = 'true' AND (archivedAt IS NOT NULL OR deletedAt IS NOT NULL)",
  "mutation:clear archivedAt/deletedAt and advance updatedAt past both its previous value and the migration clock",
].join("\n");

// The one copy of the rebuild SQL: executed by the migration below and hashed into its ledger
// checksum, so the definition can never drift from what actually runs.
const TIME_OFF_REBUILD_V33_SQL = `
    CREATE TABLE timeOff_v33 (
      id TEXT NOT NULL PRIMARY KEY,
      accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      resourceId TEXT REFERENCES resources(id) ON DELETE CASCADE,
      startDate TEXT NOT NULL, endDate TEXT NOT NULL, type TEXT NOT NULL, note TEXT,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    INSERT INTO timeOff_v33
      (id, accountId, resourceId, startDate, endDate, type, note, createdAt, updatedAt)
    SELECT id, accountId, resourceId, startDate, endDate, type, note, createdAt, updatedAt
      FROM timeOff;
    DROP TABLE timeOff;
    ALTER TABLE timeOff_v33 RENAME TO timeOff;
  `;

export const TIME_OFF_RESOURCE_NULLABLE_V33_DEFINITION = [
  "guard:PRAGMA table_info(timeOff):resourceId-nullable",
  "capture:sqlite_master:indexes-and-triggers-on-timeOff:v1",
  TIME_OFF_REBUILD_V33_SQL,
  "recreate:captured-indexes-and-triggers:v1",
].join("\n");

export function migrateTimeOffResourceNullableV33(db: Db): void {
  const resourceId = (
    db.prepare(`PRAGMA table_info("timeOff")`).all() as Array<{ name: string; notnull: number }>
  ).find((column) => column.name === "resourceId");
  if (!resourceId) throw new Error("Cannot migrate timeOff.resourceId because the column is missing.");
  if (resourceId.notnull === 0) return;

  // rowid order = original creation order. SQLite fires same-event triggers in reverse creation
  // order, and the tenant-integrity tests pin which guard raises first (account-immutable over
  // cross-account relationship), so the rebuild must recreate triggers in the order they were made.
  const schemaObjects = db
    .prepare(
      `SELECT sql FROM sqlite_master
        WHERE tbl_name = 'timeOff'
          AND type IN ('index', 'trigger')
          AND sql IS NOT NULL
        ORDER BY rowid`,
    )
    .all() as Array<{ sql: string }>;

  db.exec(TIME_OFF_REBUILD_V33_SQL);
  for (const { sql } of schemaObjects) db.exec(sql);
}

// There are no existing users at this cutover: v34 deliberately drops legacy company-wide
// (NULL-resource) time-off rows instead of converting them into first-class closures.
const TIME_OFF_REBUILD_V34_SQL = `
    CREATE TABLE timeOff_v34 (
      id TEXT NOT NULL PRIMARY KEY,
      accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      resourceId TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      startDate TEXT NOT NULL, endDate TEXT NOT NULL, type TEXT NOT NULL, note TEXT,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    INSERT INTO timeOff_v34
      (id, accountId, resourceId, startDate, endDate, type, note, createdAt, updatedAt)
    SELECT id, accountId, resourceId, startDate, endDate, type, note, createdAt, updatedAt
      FROM timeOff
     WHERE resourceId IS NOT NULL;
    DROP TABLE timeOff;
    ALTER TABLE timeOff_v34 RENAME TO timeOff;
  `;

const CLOSURES_V34_SQL = `
    CREATE TABLE IF NOT EXISTS closures (
      id TEXT NOT NULL PRIMARY KEY,
      accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      startDate TEXT NOT NULL, endDate TEXT NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
  `;

export const COMPANY_CLOSURES_V34_DEFINITION = [
  "capture:sqlite_master:indexes-and-triggers-on-timeOff:v1",
  TIME_OFF_REBUILD_V34_SQL,
  "recreate:captured-indexes-and-triggers:v1",
  CLOSURES_V34_SQL,
  TENANT_ENTITY_INDEXES_V34_SQL,
  CLOSURE_TENANT_INTEGRITY_V34_SQL,
].join("\n");

export function migrateCompanyClosuresV34(db: Db): void {
  const schemaObjects = db
    .prepare(
      `SELECT sql FROM sqlite_master
        WHERE tbl_name = 'timeOff'
          AND type IN ('index', 'trigger')
          AND sql IS NOT NULL
        ORDER BY rowid`,
    )
    .all() as Array<{ sql: string }>;
  db.exec(TIME_OFF_REBUILD_V34_SQL);
  for (const { sql } of schemaObjects) db.exec(sql);
  db.exec(CLOSURES_V34_SQL);
  db.exec(TENANT_ENTITY_INDEXES_V34_SQL);
  db.exec(CLOSURE_TENANT_INTEGRITY_V34_SQL);
}

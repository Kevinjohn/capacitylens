/** Physical SQLite schema version. Independent from the portable JSON/export schema version. */
export const DB_SCHEMA_VERSION = 35;

/** `CPLN` in ASCII. SQLite reserves application_id for applications to identify their files. */
export const CAPACITYLENS_APPLICATION_ID = 0x43504c4e;

export const DATABASE_MIGRATION_TABLE = "capacitylens_schema_migrations";

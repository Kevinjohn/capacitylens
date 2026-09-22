/** Physical SQLite schema version. Independent from the portable JSON/export schema version. */
export const DB_SCHEMA_VERSION = 45;

/** First physical schema version that owns the account↔person association table. */
export const ACCOUNT_MEMBER_RESOURCES_SCHEMA_VERSION = 43;

/** First physical schema version that owns invitation proposals and link exceptions. */
export const INVITATION_PERSON_PROPOSALS_SCHEMA_VERSION = 44;

/** `CPLN` in ASCII. SQLite reserves application_id for applications to identify their files. */
export const CAPACITYLENS_APPLICATION_ID = 0x43504c4e;

export const DATABASE_MIGRATION_TABLE = "capacitylens_schema_migrations";

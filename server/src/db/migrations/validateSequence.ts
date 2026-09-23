import type { DatabaseMigration } from "../migrationLedger";

export function validateMigrationSequence(migrations: readonly DatabaseMigration[], expectedVersion: number): void {
  if (migrations.at(-1)?.version !== expectedVersion)
    throw new Error("DB_SCHEMA_VERSION must equal the newest explicit database migration.");
  for (let index = 1; index < migrations.length; index += 1) {
    const migration = migrations[index];
    const previous = migrations[index - 1];
    if (!migration || !previous || migration.version !== previous.version + 1) {
      throw new Error("Explicit database migration versions must be contiguous and ordered.");
    }
  }
}

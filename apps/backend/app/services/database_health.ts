import db from '@adonisjs/lucid/services/db';
import { assertSchemaIntegrity } from '#services/schema_integrity';

/** Confirms the database answers and its schema matches what this release expects. */
export async function checkDatabase() {
  await db.rawQuery('select 1');
  await assertSchemaIntegrity();
}

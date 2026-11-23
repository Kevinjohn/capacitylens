import db from '@adonisjs/lucid/services/db';
import { assertSchemaIntegrity } from '#services/schema_integrity';

/** Confirms the database answers and has recorded every migration this release ships. */
export async function checkDatabase() {
  await db.rawQuery('select 1');
  await assertSchemaIntegrity();
}

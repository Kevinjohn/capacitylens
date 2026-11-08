import db from '@adonisjs/lucid/services/db';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import access from '#config/access_control';

/** Only the sole native principal can claim an entirely uninitialized installation. */
export async function requiresFirstCompanySetup(
  userId: string,
  connection: Pick<typeof db, 'from'> | TransactionClientContract = db
) {
  const users = await connection.from('users').select('id').limit(2);
  return (
    users.length === 1 &&
    String(users[0]?.id) === userId &&
    !(await connection.from('accounts').select('id').first()) &&
    !(await connection.from(access.config.membershipsTable).select('id').first())
  );
}

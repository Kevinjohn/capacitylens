import db from '@adonisjs/lucid/services/db';
import { sqlTimestamp } from '@kevinjohn/adonisjs-account-kit/transaction';

/** Direct package-storage row for setup; journey tests use the real endpoints. */
export async function insertMembership(
  accountId: string,
  userId: string,
  role: string,
  status: 'active' | 'suspended' = 'active'
) {
  const now = sqlTimestamp(db.connection());
  await db.table('company_memberships').insert({
    scope_id: accountId,
    user_id: userId,
    role,
    status,
    created_at: now,
    updated_at: now,
  });
}

export function membership(accountId: string, userId: string) {
  return db.from('company_memberships').where({ scope_id: accountId, user_id: userId }).first();
}

export function scopeMemberships(accountId: string) {
  return db.from('company_memberships').where('scope_id', accountId).orderBy('id', 'asc');
}

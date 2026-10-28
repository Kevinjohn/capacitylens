import db from '@adonisjs/lucid/services/db';
import accountKit from 'adonisjs-account-kit/services/main';
import type { Trx } from 'adonisjs-account-kit/types';
import { assertSchemaIntegrity } from '#services/schema_integrity';
import { withTransaction } from '#services/with_transaction';
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation';
import { operatorDatabasePath, withOperatorDatabase } from './operator_database.js';

const ineligible = 'Recovery requires a sole active Owner with a local password';

async function soleOwnerAccounts(userId: string, trx: Pick<Trx, 'from'>) {
  const memberships = await trx
    .from('memberships')
    .where({ user_id: userId, role: 'owner', status: 'active' })
    .select('account_id');
  const accounts: string[] = [];
  for (const membership of memberships) {
    const owners = await trx
      .from('memberships')
      .where({ account_id: membership.account_id, role: 'owner', status: 'active' })
      .count('* as n')
      .first();
    if (Number(owners?.n) === 1) accounts.push(String(membership.account_id));
  }
  if (!accounts.length) throw new Error(ineligible);
  return accounts.sort();
}

/**
 * Prints an Account Kit reset link for a sole Owner while the server is stopped. The audit entry
 * is written after issuance; if it fails no link is shown, and the unseen link simply expires.
 */
export async function recoverOwner(input: { email: string; confirmServerStopped: boolean }) {
  operatorDatabasePath(input.confirmServerStopped);
  const email = normalizeAccountEmail(input.email);
  if (!isAccountEmail(email)) throw new Error('The target is not a valid account address');
  return withOperatorDatabase(async () => {
    await assertSchemaIntegrity();
    const user = await db.from('users').where('email', email).select('id', 'password').first();
    if (!user?.password) throw new Error(ineligible);
    const userId = String(user.id);
    const accountIds = await soleOwnerAccounts(userId, db);
    const issued = await accountKit.operator.resetLink({ email, deliver: 'print' });
    if (!issued.url || String(issued.user.id) !== userId)
      throw new Error('Owner recovery failed; no recovery link was delivered');
    await withTransaction(async (trx) => {
      const now = new Date().toISOString();
      for (const accountId of accountIds)
        await trx.table('audit_entries').insert({
          id: crypto.randomUUID(),
          account_id: accountId,
          actor_id: null,
          action: 'identity.owner_recovery_issued',
          entity: 'user',
          entity_id: userId,
          details: JSON.stringify({ changedFields: ['credential'] }),
          created_at: now,
          updated_at: now,
        });
    });
    return { email, userId, accountIds, link: issued.url };
  });
}

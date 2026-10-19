import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { MembershipError } from '#services/membership/member_mutations'

const relationships = [
  ['projects', 'client_id', 'clients'],
  ['phases', 'project_id', 'projects'],
  ['resources', 'discipline_id', 'disciplines'],
  ['resources', 'project_id', 'projects'],
  ['activities', 'project_id', 'projects'],
  ['activities', 'phase_id', 'phases'],
  ['allocations', 'resource_id', 'resources'],
  ['allocations', 'activity_id', 'activities'],
  ['allocations', 'project_id', 'projects'],
  ['time_off', 'resource_id', 'resources'],
] as const

/** Refuses an old or externally corrupted FK edge before its cascade can touch another company. */
async function assertContained(accountId: string, trx: TransactionClientContract) {
  for (const [child, column, parent] of relationships) {
    const edge = await trx
      .from(`${parent} as parent`)
      .innerJoin(`${child} as child`, `child.${column}`, 'parent.id')
      .where('parent.account_id', accountId)
      .whereNot('child.account_id', accountId)
      .select('child.id')
      .first()
    if (edge)
      throw new MembershipError(
        'Company erasure refused because a related record belongs to another company.',
        409,
        'TENANT_INTEGRITY'
      )
  }
}

/** Erases one company's data and only principals with no surviving company membership. */
export async function eraseCompany(
  accountId: string,
  trx: TransactionClientContract,
  receiptCommandId: string
) {
  await assertContained(accountId, trx)
  const members = await trx.from('memberships').where('account_id', accountId).select('user_id')
  const provenanceSessions = await trx
    .from('capacitylens_sync_row_provenance')
    .where('account_id', accountId)
    .select('session_id')
  await trx.from('account_member_resources').where('account_id', accountId).delete()
  await trx.from('capacitylens_sync_row_provenance').where('account_id', accountId).delete()
  await trx.from('accounts').where('id', accountId).delete()
  if (provenanceSessions.length)
    await trx
      .from('capacitylens_sync_sessions')
      .whereIn(
        'session_id',
        provenanceSessions.map((row) => String(row.session_id))
      )
      .whereNotIn('session_id', trx.from('capacitylens_sync_row_provenance').select('session_id'))
      .delete()
  for (const member of members) {
    const userId = String(member.user_id)
    const surviving = await trx
      .from('memberships as member')
      .innerJoin('accounts as account', 'account.id', 'member.account_id')
      .where('member.user_id', userId)
      .first()
    if (surviving) continue
    // Nullable command receipts may refer to this identity after the account-scoped cascade.
    await trx
      .from('command_results')
      .where('operation', 'like', `%:actor:${userId}`)
      .whereNot('command_id', receiptCommandId)
      .delete()
    await trx.from('users').where('id', userId).delete()
  }
}

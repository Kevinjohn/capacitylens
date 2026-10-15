import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/** Reads same-company person candidates for an administrator's member directory. */
export async function readResourceCandidates(trx: TransactionClientContract, accountId: string) {
  const rows = await trx
    .from('resources')
    .where({ account_id: accountId, kind: 'person' })
    .whereNull('archived_at')
    .whereNull('deleted_at')
    .select('id', 'name', 'role')
  return rows.map((row) => ({ resourceId: String(row.id), label: String(row.name ?? row.role) }))
}

/** Adds only same-company association and exception fields to an authorized member row. */
export async function readMemberResourceFields(
  trx: TransactionClientContract,
  accountId: string,
  userId: string
) {
  const [link, exception] = await Promise.all([
    trx
      .from('account_member_resources as link')
      .leftJoin('resources as resource', function () {
        this.on('resource.id', '=', 'link.resource_id').andOn(
          'resource.account_id',
          '=',
          'link.account_id'
        )
      })
      .where({ 'link.account_id': accountId, 'link.user_id': userId })
      .select(
        'link.resource_id',
        'link.revision',
        'resource.name',
        'resource.archived_at',
        'resource.deleted_at'
      )
      .first(),
    trx
      .from('member_resource_link_exceptions')
      .where({ account_id: accountId, user_id: userId })
      .select('proposed_resource_id', 'reason')
      .first(),
  ])
  const resourceStatus = !link ? null : link.deleted_at || link.archived_at ? 'archived' : 'active'
  return {
    resourceLink: link
      ? {
          resourceId: String(link.resource_id),
          revision: String(link.revision),
          resourceName: link.name ?? null,
          resourceStatus,
        }
      : null,
    resourceLinkException: exception
      ? { proposedResourceId: exception.proposed_resource_id ?? null, reason: exception.reason }
      : null,
  }
}

import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

const revisionsByTransaction = new WeakMap<
  TransactionClientContract,
  Map<string, Promise<number>>
>()

function revisionsFor(trx: TransactionClientContract) {
  let revisions = revisionsByTransaction.get(trx)
  if (!revisions) {
    revisions = new Map()
    revisionsByTransaction.set(trx, revisions)
  }
  return revisions
}

/** Reads the current company planning revision, treating pre-migration rows as revision zero. */
export async function getPlanningRevision(
  trx: TransactionClientContract,
  accountId: string
): Promise<number> {
  const row = await trx
    .from('company_planning_revisions')
    .where('account_id', accountId)
    .select('revision')
    .first()
  const revision = row ? Number(row.revision) : 0
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error(`Invalid planning revision for company ${accountId}.`)
  return revision
}

/** Advances a company's planning revision once per supplied transaction. */
export function advancePlanningRevision(
  trx: TransactionClientContract,
  accountId: string
): Promise<number> {
  const revisions = revisionsFor(trx)
  const existing = revisions.get(accountId)
  if (existing) return existing

  const pending = (async () => {
    const current = await trx
      .from('company_planning_revisions')
      .where('account_id', accountId)
      .select('revision')
      .first()
    if (current) {
      const revision = Number(current.revision)
      if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER)
        throw new Error(`Invalid planning revision for company ${accountId}.`)
      await trx
        .from('company_planning_revisions')
        .where('account_id', accountId)
        .increment('revision', 1)
      return revision + 1
    }
    await trx.table('company_planning_revisions').insert({ account_id: accountId, revision: 1 })
    return 1
  })()
  revisions.set(accountId, pending)
  return pending
}

/** Advances companies whose active member becomes restricted by a newly effective mailbox proof. */
export async function advanceRevisionsForNewEmailProof(
  trx: TransactionClientContract,
  userId: string,
  email: string
): Promise<void> {
  const existingProof = await trx
    .from('email_proofs')
    .where({ user_id: userId, email })
    .select('user_id')
    .first()
  if (existingProof) return

  const memberships = await trx
    .from('memberships as membership')
    .innerJoin(
      'account_access_restrictions as restriction',
      'restriction.account_id',
      'membership.account_id'
    )
    .where({ 'membership.user_id': userId, 'membership.status': 'active' })
    .where('restriction.verified_email', email)
    .whereNotExists((query) =>
      query
        .from('account_access_restrictions as principal_restriction')
        .whereColumn('principal_restriction.account_id', 'membership.account_id')
        .where('principal_restriction.principal_id', userId)
    )
    .distinct('membership.account_id')
    .select('membership.account_id')
  for (const membership of memberships)
    await advancePlanningRevision(trx, String(membership.account_id))
}

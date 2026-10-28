import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { conflictingAdmission, forbiddenAdmission } from '#services/admission/errors'
import { affectedRows } from '#services/admission/affected_rows'
import { advancePlanningRevision } from '#services/planning_revision'

type Trx = TransactionClientContract

async function currentLink(trx: Trx, accountId: string, userId: string) {
  return trx
    .from('account_member_resources')
    .where({ account_id: accountId, user_id: userId })
    .first()
}

async function assertEligibleMember(trx: Trx, accountId: string, userId: string) {
  const member = await trx
    .from('memberships')
    .where({ account_id: accountId, user_id: userId })
    .first()
  if (member?.status !== 'active')
    conflictingAdmission('Only an active company member can be linked.')
  const restriction = await trx
    .from('account_access_restrictions')
    .where({ account_id: accountId, principal_id: userId })
    .first()
  if (restriction) forbiddenAdmission('This member does not have company access.')
}

async function resource(trx: Trx, accountId: string, resourceId: string) {
  return trx.from('resources').where({ account_id: accountId, id: resourceId }).first()
}

/** Checks the scheduled person is still available to link. */
async function assertAvailablePerson(trx: Trx, accountId: string, resourceId: string) {
  const row = await resource(trx, accountId, resourceId)
  if (row?.kind !== 'person' || row.archived_at || row.deleted_at)
    conflictingAdmission('The selected scheduled person is no longer available.')
}

/** Applies a CAS member/person association within the caller's product transaction. */
export async function setMemberResourceLink(
  trx: Trx,
  input: { accountId: string; userId: string; resourceId: string; expectedRevision: string | null }
) {
  const { accountId, userId, resourceId, expectedRevision } = input
  await assertEligibleMember(trx, accountId, userId)
  await assertAvailablePerson(trx, accountId, resourceId)
  const current = await currentLink(trx, accountId, userId)
  if ((current?.revision ?? null) !== expectedRevision)
    conflictingAdmission('The member resource link changed. Refresh and retry.')
  if (current && current.resource_id !== resourceId) {
    const previous = await resource(trx, accountId, String(current.resource_id))
    if (previous?.kind !== 'person' || previous.archived_at || previous.deleted_at)
      conflictingAdmission(
        'The current scheduled person is unavailable; unlink it before changing the link.'
      )
  }
  const occupied = await trx
    .from('account_member_resources')
    .where({ account_id: accountId, resource_id: resourceId })
    .first()
  if (occupied && occupied.user_id !== userId)
    conflictingAdmission('That scheduled person is already linked to another member.')
  if (current?.resource_id === resourceId)
    return { resourceId, revision: String(current.revision), changed: false }
  const now = new Date().toISOString()
  const revision = crypto.randomUUID()
  if (current) {
    await trx
      .from('account_member_resources')
      .where({ account_id: accountId, user_id: userId, revision: expectedRevision })
      .update({ resource_id: resourceId, revision, updated_at: now })
  } else {
    await trx.table('account_member_resources').insert({
      id: crypto.randomUUID(),
      account_id: accountId,
      user_id: userId,
      resource_id: resourceId,
      revision,
      created_at: now,
      updated_at: now,
    })
  }
  await advancePlanningRevision(trx, accountId)
  return { resourceId, revision, changed: true }
}

/** Clears a member/person association only at the expected revision. */
export async function clearMemberResourceLink(
  trx: Trx,
  input: { accountId: string; userId: string; expectedRevision: string }
) {
  const { accountId, userId, expectedRevision } = input
  await assertEligibleMember(trx, accountId, userId)
  const changed = await trx
    .from('account_member_resources')
    .where({ account_id: accountId, user_id: userId, revision: expectedRevision })
    .delete()
  if (affectedRows(changed) !== 1)
    conflictingAdmission('The member resource link changed. Refresh and retry.')
  await advancePlanningRevision(trx, accountId)
}

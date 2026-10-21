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

/** Checks a proposed scheduled person without reserving it. */
export async function assertEligibleProposal(trx: Trx, accountId: string, resourceId: string) {
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
  await assertEligibleProposal(trx, accountId, resourceId)
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
  if (current?.resource_id === resourceId) return { resourceId, revision: String(current.revision) }
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
  await trx
    .from('member_resource_link_exceptions')
    .where({ account_id: accountId, user_id: userId })
    .delete()
  await advancePlanningRevision(trx, accountId)
  return { resourceId, revision }
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

async function recordException(
  trx: Trx,
  accountId: string,
  userId: string,
  proposedResourceId: string | null,
  reason: string
) {
  const now = new Date().toISOString()
  await trx
    .table('member_resource_link_exceptions')
    .insert({
      id: crypto.randomUUID(),
      account_id: accountId,
      user_id: userId,
      proposed_resource_id: proposedResourceId,
      reason,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['account_id', 'user_id'])
    .merge(['proposed_resource_id', 'reason', 'updated_at'])
}

/** Settles a non-reserving invitation proposal in the admission transaction. */
export async function settleInvitationProposal(
  trx: Trx,
  invitationId: string,
  accountId: string,
  userId: string
) {
  const proposal = await trx
    .from('invitation_proposals')
    .where('invitation_id', invitationId)
    .first()
  if (!proposal) return
  const invitation = await trx.from('invitations').where('id', invitationId).first()
  if (invitation?.account_id !== accountId)
    throw new Error('Invitation proposal belongs to another company.')
  const resourceId: string | null =
    proposal.resource_id === null ? null : String(proposal.resource_id)
  if (!resourceId) return recordException(trx, accountId, userId, null, 'resource_unavailable')
  const target = await resource(trx, accountId, resourceId)
  if (!target) {
    const other = await trx.from('resources').where('id', resourceId).first()
    if (other) throw new Error('Invitation proposal references another company.')
  }
  if (target?.kind !== 'person' || target.archived_at || target.deleted_at)
    return recordException(trx, accountId, userId, resourceId, 'resource_unavailable')
  const memberLink = await currentLink(trx, accountId, userId)
  if (memberLink?.resource_id === resourceId) {
    await trx
      .from('member_resource_link_exceptions')
      .where({ account_id: accountId, user_id: userId })
      .delete()
    return
  }
  if (memberLink)
    return recordException(trx, accountId, userId, resourceId, 'member_already_linked')
  const occupied = await trx
    .from('account_member_resources')
    .where({ account_id: accountId, resource_id: resourceId })
    .first()
  if (occupied)
    return recordException(trx, accountId, userId, resourceId, 'resource_already_linked')
  await setMemberResourceLink(trx, { accountId, userId, resourceId, expectedRevision: null })
}

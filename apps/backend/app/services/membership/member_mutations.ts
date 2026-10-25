import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { MembershipStatus, Role } from '@capacitylens/shared/account/types'
import {
  canChangeMemberStatus,
  canEditAnyMemberRole,
  canManageMemberRole,
  canRemoveMember,
} from '@capacitylens/shared/account/policy'
import { newId } from '@capacitylens/shared/lib/id'
import { writeAudit } from '#services/audit'
import { resetMemberSignIn } from '#services/membership/sign_in_tracking'
import { advancePlanningRevision } from '#services/planning_revision'

export class MembershipError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message)
  }
}

const missing = () => new MembershipError('Not a member of this workspace.', 404, 'NOT_FOUND')
const forbidden = () => new MembershipError('Forbidden.', 403, 'FORBIDDEN')

async function targetMember(trx: TransactionClientContract, accountId: string, userId: string) {
  const row = await trx
    .from('memberships')
    .where({ account_id: accountId, user_id: userId })
    .first()
  if (!row) throw missing()
  return row
}

/** Whether the Account Kit has confirmed the identity's current address. */
async function hasConfirmedEmail(trx: TransactionClientContract, userId: string, email: string) {
  const row = await trx
    .from('users')
    .where({ id: userId, email })
    .whereNotNull('email_verified_at')
    .whereNull('unverified_email')
    .first()
  return Boolean(row)
}

/** Changes an active non-Owner role in one transaction. */
export async function changeMemberRole(
  trx: TransactionClientContract,
  input: { accountId: string; actorId: string; actorRole: Role; userId: string; role: Role }
) {
  const member = await targetMember(trx, input.accountId, input.userId)
  if (member.status !== 'active' || !canEditAnyMemberRole(input.actorRole, member.role as Role))
    throw forbidden()
  if (input.role === 'owner')
    throw new MembershipError(
      'Transfer ownership to assign the Owner role.',
      400,
      'OWNER_TRANSFER_REQUIRED'
    )
  if (!canManageMemberRole(input.actorRole, member.role as Role, input.role)) throw forbidden()
  if (member.role !== input.role) {
    await trx
      .from('memberships')
      .where({ account_id: input.accountId, user_id: input.userId })
      .update({ role: input.role, updated_at: new Date().toISOString() })
    // Enable Access restores the restriction's role, so it follows every change.
    await trx
      .from('account_access_restrictions')
      .where({ account_id: input.accountId, principal_id: input.userId })
      .update({ role: input.role })
    await advancePlanningRevision(trx, input.accountId)
    await writeAudit(trx, {
      accountId: input.accountId,
      actorId: input.actorId,
      action: 'member.role_changed',
      entity: 'membership',
      entityId: input.userId,
      fields: ['role'],
    })
  }
  return { userId: input.userId, role: input.role }
}

/** Changes lifecycle status, retaining explicit access restrictions across restoration. */
export async function changeMemberStatus(
  trx: TransactionClientContract,
  input: {
    accountId: string
    actorId: string
    actorRole: Role
    userId: string
    status: MembershipStatus
  }
) {
  const member = await targetMember(trx, input.accountId, input.userId)
  if (!canChangeMemberStatus(input.actorRole, member.role as Role, input.userId === input.actorId))
    throw forbidden()
  const restriction = await trx
    .from('account_access_restrictions')
    .where({ account_id: input.accountId, principal_id: input.userId })
    .first()
  const disabling = input.status === 'disabled'
  const principal = disabling
    ? await trx.from('users').where('id', input.userId).select('email').first()
    : null
  const currentEmail = principal ? String(principal.email).trim().toLowerCase() : null
  const provenEmail =
    currentEmail && (await hasConfirmedEmail(trx, input.userId, currentEmail)) ? currentEmail : null
  const capturesEmail = Boolean(restriction && !restriction.verified_email && provenEmail)
  const changed = disabling ? !restriction || capturesEmail : member.status !== input.status
  if (disabling && !restriction) {
    await trx.table('account_access_restrictions').insert({
      id: newId(),
      account_id: input.accountId,
      principal_id: input.userId,
      verified_email: provenEmail,
      role: member.role,
      created_at: new Date().toISOString(),
    })
  }
  if (disabling && capturesEmail)
    await trx
      .from('account_access_restrictions')
      .where({ account_id: input.accountId, principal_id: input.userId, verified_email: null })
      .update({ verified_email: provenEmail })
  if (changed) {
    if (!disabling)
      await trx
        .from('memberships')
        .where({ account_id: input.accountId, user_id: input.userId })
        .update({ status: input.status, updated_at: new Date().toISOString() })
    await resetMemberSignIn(input.accountId, input.userId, trx)
    await advancePlanningRevision(trx, input.accountId)
    await writeAudit(trx, {
      accountId: input.accountId,
      actorId: input.actorId,
      action: disabling ? 'member.access_disabled' : 'member.status_changed',
      entity: 'membership',
      entityId: input.userId,
      fields: [disabling ? 'accessRestriction' : 'status'],
    })
  }
  return {
    userId: input.userId,
    status: disabling ? member.status : input.status,
    accessDisabled: disabling || Boolean(restriction),
  }
}

/** Removes one company membership without deleting a principal shared by another company. */
export async function removeMember(
  trx: TransactionClientContract,
  input: { accountId: string; actorId: string; actorRole: Role; userId: string }
) {
  const member = await targetMember(trx, input.accountId, input.userId)
  // Removal locks the person out until an administrator acts, so nobody may remove themselves.
  if (input.userId === input.actorId || !canRemoveMember(input.actorRole, member.role as Role))
    throw forbidden()
  await trx
    .from('account_member_resources')
    .where({ account_id: input.accountId, user_id: input.userId })
    .delete()
  await resetMemberSignIn(input.accountId, input.userId, trx)
  // The person stays admitted and keeps their invitation evidence, so without a restriction they
  // could recreate the membership themselves. Enable access is the administrator's way back.
  const restricted = await trx
    .from('account_access_restrictions')
    .where({ account_id: input.accountId, principal_id: input.userId })
    .first()
  if (restricted)
    await trx
      .from('account_access_restrictions')
      .where({ account_id: input.accountId, principal_id: input.userId })
      .update({ role: member.role })
  else {
    const principal = await trx.from('users').where('id', input.userId).select('email').first()
    const email = principal ? String(principal.email).trim().toLowerCase() : null
    await trx.table('account_access_restrictions').insert({
      id: newId(),
      account_id: input.accountId,
      principal_id: input.userId,
      verified_email: email && (await hasConfirmedEmail(trx, input.userId, email)) ? email : null,
      role: member.role,
      created_at: new Date().toISOString(),
    })
  }
  await trx
    .from('memberships')
    .where({ account_id: input.accountId, user_id: input.userId })
    .delete()
  await advancePlanningRevision(trx, input.accountId)
  await writeAudit(trx, {
    accountId: input.accountId,
    actorId: input.actorId,
    action: 'member.removed',
    entity: 'membership',
    entityId: input.userId,
    fields: ['membership'],
  })
  return { userId: input.userId }
}

/** Removes the explicit company restriction after an administrator proves authority. */
export async function enableMemberAccess(
  trx: TransactionClientContract,
  input: { accountId: string; actorId: string; actorRole: Role; userId: string }
) {
  const restriction = await trx
    .from('account_access_restrictions')
    .where({ account_id: input.accountId, principal_id: input.userId })
    .first()
  if (!restriction) throw new MembershipError('Access restriction not found.', 404, 'NOT_FOUND')
  if (
    !canChangeMemberStatus(
      input.actorRole,
      restriction.role as Role,
      input.actorId === input.userId
    )
  )
    throw forbidden()
  await trx
    .from('account_access_restrictions')
    .where({ account_id: input.accountId, principal_id: input.userId })
    .delete()
  // A removed person returns with the role they held when removed, not their original invitation's.
  const membership = await trx
    .from('memberships')
    .where({ account_id: input.accountId, user_id: input.userId })
    .first()
  if (!membership) {
    const now = new Date().toISOString()
    await trx.table('memberships').insert({
      id: newId(),
      account_id: input.accountId,
      user_id: input.userId,
      role: restriction.role,
      status: 'active',
      created_at: now,
      updated_at: now,
    })
  }
  await resetMemberSignIn(input.accountId, input.userId, trx)
  await advancePlanningRevision(trx, input.accountId)
  await writeAudit(trx, {
    accountId: input.accountId,
    actorId: input.actorId,
    action: 'member.access_enabled',
    entity: 'membership',
    entityId: input.userId,
    fields: ['accessRestriction'],
  })
  return { userId: input.userId, accessDisabled: false }
}

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { isApprovedEmailDomain } from '@capacitylens/shared/account/approvedDomains'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import {
  conflictingAdmission,
  expiredAdmission,
  forbiddenAdmission,
  invalidAdmission,
  missingAdmission,
} from './errors.js'
import { hasCurrentEmailProof, policyAllowsAdmission, readJoiningPolicy } from './joining_policy.js'
import { assertEligibleProposal, settleInvitationProposal } from '#services/member_resources/links'
import { writeAudit } from '#services/audit'
import { authMode } from '#services/auth/mode'
import { affectedRows } from './affected_rows.js'

type Trx = TransactionClientContract
const DAY = 24 * 60 * 60 * 1000

function digest(token: string): string {
  return createHash('sha256').update('capacitylens-invite\0').update(token).digest('base64url')
}

function validRole(value: unknown): value is 'viewer' | 'editor' | 'admin' {
  return value === 'viewer' || value === 'editor' || value === 'admin'
}

/** Validates an invitation create request before claiming its secret command. */
export function parseInvitationCreate(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidAdmission()
  const body = value as Record<string, unknown>
  if (
    Object.keys(body).some(
      (field) =>
        !['accountId', 'role', 'preauthEmail', 'proposedResourceId', 'expiresAt'].includes(field)
    )
  )
    invalidAdmission()
  if (typeof body.accountId !== 'string' || !body.accountId || !validRole(body.role))
    invalidAdmission()
  const email =
    body.preauthEmail === undefined
      ? null
      : typeof body.preauthEmail === 'string'
        ? normalizeAccountEmail(body.preauthEmail)
        : null
  if (body.preauthEmail !== undefined && (!email || !isAccountEmail(email)))
    invalidAdmission('Invalid invitation email.')
  const proposedResourceId = body.proposedResourceId
  if (
    proposedResourceId !== undefined &&
    (typeof proposedResourceId !== 'string' || !proposedResourceId)
  )
    invalidAdmission()
  const expiresAt =
    body.expiresAt === undefined ? new Date(Date.now() + 7 * DAY).toISOString() : body.expiresAt
  if (
    typeof expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    Date.parse(expiresAt) <= Date.now() ||
    Date.parse(expiresAt) > Date.now() + 30 * DAY
  )
    invalidAdmission('Invalid invitation expiry.')
  return {
    accountId: body.accountId,
    role: body.role,
    email,
    proposedResourceId: proposedResourceId as string | undefined,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

/** Creates one product invitation with only a digest persisted in the supplied transaction. */
export async function createInvitation(
  trx: Trx,
  input: ReturnType<typeof parseInvitationCreate>,
  actorId: string
) {
  const policy = await readJoiningPolicy(trx, input.accountId)
  if (!input.email && authMode() !== 'off')
    invalidAdmission('Invitations require an email address.')
  if (
    input.email &&
    policy.policy === 'approved_domains' &&
    !isApprovedEmailDomain(input.email, policy.approvedDomains)
  )
    forbiddenAdmission('This company permits invitations only to approved domains.')
  if (input.proposedResourceId)
    await assertEligibleProposal(trx, input.accountId, input.proposedResourceId)
  const token = randomBytes(32).toString('base64url')
  const id = randomUUID()
  const now = new Date().toISOString()
  await trx.table('invitations').insert({
    id,
    account_id: input.accountId,
    token_hash: digest(token),
    email: input.email,
    role: input.role,
    expires_at: input.expiresAt,
    accepted_at: null,
    created_at: now,
    updated_at: now,
  })
  if (input.proposedResourceId)
    await trx.table('invitation_proposals').insert({
      id: randomUUID(),
      invitation_id: id,
      resource_id: input.proposedResourceId,
      created_at: now,
      updated_at: now,
    })
  await writeAudit(trx, {
    accountId: input.accountId,
    actorId,
    action: 'invitation.created',
    entity: 'invitation',
    entityId: id,
    fields: ['role', 'email', ...(input.proposedResourceId ? ['proposedResourceId'] : [])],
  })
  return {
    id,
    token,
    accountId: input.accountId,
    role: input.role,
    expiresAt: input.expiresAt,
    preauthEmail: input.email,
    proposedResourceId: input.proposedResourceId,
  }
}

/** Resolves a bearer inside the caller's transaction without disclosing its hash or address. */
export async function lookupInvitation(trx: Trx, token: string, allowUsed = false) {
  const invitation = await findInvitationByToken(trx, token)
  if (invitation.accepted_at && !allowUsed) conflictingAdmission()
  const expiry = Date.parse(String(invitation.expires_at))
  if (!Number.isFinite(expiry) || expiry <= Date.now()) expiredAdmission()
  if (!validRole(invitation.role)) forbiddenAdmission('Invitation role is unavailable.')
  return invitation
}

/** Binds a completed command to its bearer without applying new-admission expiry rules. */
export async function findInvitationByToken(trx: Trx, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) missingAdmission()
  const invitation = await trx.from('invitations').where('token_hash', digest(token)).first()
  if (!invitation) missingAdmission()
  return invitation
}

/** Atomically joins a user and settles any non-reserving proposal with this invitation. */
export async function acceptInvitation(
  trx: Trx,
  invitation: Record<string, any>,
  userId: string,
  email: string
) {
  if (invitation.email && invitation.email !== email)
    forbiddenAdmission('Invitation is addressed to another email.')
  const accountId = String(invitation.account_id)
  const settings = await readJoiningPolicy(trx, accountId)
  const currentProof = await hasCurrentEmailProof(trx, userId, email)
  if (
    !policyAllowsAdmission({
      settings,
      email,
      hasCurrentProof: currentProof,
      invitation: invitation.email ? 'addressed' : 'link',
    })
  )
    forbiddenAdmission('Current email proof is required for this joining policy.')
  const restriction = await trx
    .from('account_access_restrictions')
    .where('account_id', accountId)
    .andWhere((query) => query.where('principal_id', userId).orWhere('verified_email', email))
    .first()
  if (restriction) forbiddenAdmission('Company access requires administrator restoration.')
  const standing = await trx
    .from('memberships')
    .where({ account_id: accountId, user_id: userId })
    .first()
  if (standing?.status === 'disabled')
    forbiddenAdmission('Company access requires administrator restoration.')
  const now = new Date().toISOString()
  const consumed = await trx
    .from('invitations')
    .where({ id: invitation.id, accepted_at: null })
    .where('expires_at', '>', now)
    .update({ accepted_at: now, updated_at: now })
  if (affectedRows(consumed) !== 1) conflictingAdmission()
  const role = standing?.status === 'active' ? standing.role : invitation.role
  if (!standing)
    await trx.table('memberships').insert({
      id: randomUUID(),
      account_id: accountId,
      user_id: userId,
      role,
      status: 'active',
      created_at: now,
      updated_at: now,
    })
  else if (standing.status === 'archived')
    await trx
      .from('memberships')
      .where('id', standing.id)
      .update({ role, status: 'active', updated_at: now })
  if (!standing || standing.status === 'archived')
    await trx.from('account_recovery_tokens').where('user_id', userId).delete()
  await settleInvitationProposal(trx, String(invitation.id), accountId, userId)
  await writeAudit(trx, {
    accountId,
    actorId: userId,
    action: 'invitation.accepted',
    entity: 'invitation',
    entityId: String(invitation.id),
    fields: ['acceptedAt', ...(!standing ? ['membership'] : [])],
  })
  return { accountId, role }
}

import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import type {
  AccountUser,
  AuthorizationCallbacks,
  CredentialChangeContext,
  Invitation,
  Trx,
} from 'adonisjs-account-kit/types'
import { AccountAdmission } from 'adonisjs-account-kit/admission'
import type { AdmissionAuthorizeCallbacks } from 'adonisjs-account-kit/admission'
import { can } from '@capacitylens/shared/domain/access'
import { canAdministerIdentity } from '@capacitylens/shared/account/policy'
import { isAccountRole, type Role } from '@capacitylens/shared/account/types'
import { activeCompanyRole, assertCompanyAccessOpen } from '#services/auth/authorization'
import { advancePlanningRevision } from '#services/planning_revision'
import { writeAudit } from '#services/audit'
import { AdmissionError } from '#services/admission/errors'

/** Roles an invitation may carry; ownership moves only through company setup or transfer. */
export const INVITABLE_ROLES = ['viewer', 'editor', 'admin'] as const
export type InvitableRole = (typeof INVITABLE_ROLES)[number]

export function isInvitableRole(value: unknown): value is InvitableRole {
  return INVITABLE_ROLES.includes(value as InvitableRole)
}

/** The installation's single company, or null before first setup. */
export async function installationCompanyId(trx: Pick<Trx, 'from'>): Promise<string | null> {
  const rows = await trx.from('accounts').select('id').limit(2)
  // Only seeded development data holds two companies; say so rather than fail with a 500.
  if (rows.length > 1)
    throw new AdmissionError(
      'This installation has more than one company. Accounts need a single-company database.',
      409,
      'MULTIPLE_COMPANIES'
    )
  return rows[0] ? String(rows[0].id) : null
}

/** A Kit callback's transaction when it supplies one, otherwise the default connection. */
type Reader = Pick<Trx, 'from'>

/** Admission is read through the supplied transaction so a callback never opens a second one. */
export async function isAdmitted(userId: string, trx?: Trx) {
  const admission = await app.container.make(AccountAdmission)
  return admission.isAdmitted(userId, trx)
}

async function companyRole(userId: string, trx: Reader): Promise<Role | null> {
  const accountId = await installationCompanyId(trx)
  return accountId ? activeCompanyRole(userId, accountId, trx) : null
}

async function mayManageInvitations(userId: string, trx: Trx | undefined) {
  const role = await companyRole(userId, trx ?? db)
  return Boolean(role && can(role, 'manageInvites') && (await isAdmitted(userId, trx)))
}

/**
 * Invitation authority is re-read inside the Kit's insert transaction (`context.trx`), so a
 * demotion committed between the pre-check and the insert refuses the send.
 */
export const authorize: AuthorizationCallbacks = {
  invite: async (actor, role, context) =>
    isInvitableRole(role) && mayManageInvitations(String(actor.id), context?.trx),
  manageInvitation: async (actor, _invitation, context) =>
    mayManageInvitations(String(actor.id), context?.trx),
  listInvitations: async (actor, context) => mayManageInvitations(String(actor.id), context?.trx),
}

/** Owners and Admins decide admission, never for someone their role cannot administer. */
export const admissionAuthorize: AdmissionAuthorizeCallbacks = {
  decide: async (actor, subject, context) => {
    const trx = context?.trx ?? db
    const actorRole = await companyRole(String(actor.id), trx)
    if (!actorRole || !can(actorRole, 'manageInvites')) return false
    const subjectRole = await companyRole(String(subject.id), trx)
    return !subjectRole || canAdministerIdentity(actorRole, subjectRole)
  },
  // The Kit checks the decider's own admission; listing, which discloses addresses, needs the same.
  list: async (actor, context) => mayManageInvitations(String(actor.id), context?.trx),
}

/**
 * Creates the invited membership in the acceptance transaction. Before the first company exists the
 * accepted identity is the first Owner-to-be, which company setup establishes; the bootstrap role
 * grants nothing.
 */
export async function onInvitationAccepted(user: AccountUser, invitation: Invitation, trx: Trx) {
  const accountId = await installationCompanyId(trx)
  if (!accountId) return
  if (!isInvitableRole(invitation.role) || !isAccountRole(invitation.role))
    throw new Error('Invitation role is unavailable.')
  await assertCompanyAccessOpen(String(user.id), accountId, trx)
  const now = new Date().toISOString()
  await trx.table('memberships').insert({
    id: crypto.randomUUID(),
    account_id: accountId,
    user_id: String(user.id),
    role: invitation.role,
    status: 'active',
    created_at: now,
    updated_at: now,
  })
  await writeAudit(trx, {
    accountId,
    actorId: String(user.id),
    action: 'invitation.accepted',
    entity: 'membership',
    entityId: String(user.id),
    fields: ['role'],
  })
  await advancePlanningRevision(trx, accountId)
}

/** Records a credential change against every company the identity belongs to. */
export async function onCredentialsChangedTransaction(
  user: AccountUser,
  context: CredentialChangeContext,
  trx: Trx
) {
  const memberships = await trx.from('memberships').where('user_id', String(user.id))
  for (const membership of memberships)
    await writeAudit(trx, {
      accountId: String(membership.account_id),
      actorId: String(user.id),
      action: 'identity.credentials_changed',
      entity: 'user',
      entityId: String(user.id),
      fields: [context.operation],
    })
}

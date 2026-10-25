import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { installationCompanyId, isInvitableRole } from '#services/account_kit/policy'
import { AdmissionError } from '#services/admission/errors'
import { writeAudit } from '#services/audit'
import { advancePlanningRevision } from '#services/planning_revision'

/**
 * Gives an admitted identity its company membership once. Invited people already received theirs
 * on acceptance; this covers operator-granted evidence and approved registrations. The role comes
 * from recorded invitation evidence when it is assignable, otherwise Viewer. An existing
 * membership is returned unchanged, and a disabled one is never reactivated here.
 */
export async function completeMembership(userId: string, trx: TransactionClientContract) {
  const accountId = await installationCompanyId(trx)
  if (!accountId)
    throw new AdmissionError('The company has not been set up yet.', 409, 'COMPANY_SETUP_REQUIRED')
  const existing = await trx
    .from('memberships')
    .where({ account_id: accountId, user_id: userId })
    .select('role', 'status')
    .first()
  if (existing?.status === 'active')
    return { accountId, role: String(existing.role), created: false }
  if (existing)
    throw new AdmissionError(
      'Your access to this company is disabled. Ask an Owner or Admin.',
      409,
      'MEMBERSHIP_DISABLED'
    )
  // The Account Kit's admission record keeps the invited role as evidence.
  const evidence = await trx
    .from('account_admissions')
    .where('user_id', userId)
    .select('invited_role')
    .first()
  const role = isInvitableRole(evidence?.invited_role) ? evidence.invited_role : 'viewer'
  const now = new Date().toISOString()
  await trx.table('memberships').insert({
    id: crypto.randomUUID(),
    account_id: accountId,
    user_id: userId,
    role,
    status: 'active',
    created_at: now,
    updated_at: now,
  })
  await writeAudit(trx, {
    accountId,
    actorId: userId,
    action: 'admission.completed',
    entity: 'membership',
    entityId: userId,
    fields: ['role'],
  })
  await advancePlanningRevision(trx, accountId)
  return { accountId, role, created: true }
}

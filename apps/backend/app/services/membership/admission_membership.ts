import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import access from '#config/access_control';
import { installationCompanyId, isInvitableRole } from '#services/account_kit/policy';
import { AdmissionError } from '#services/admission/errors';
import { writeAudit } from '#services/audit';
import { advancePlanningRevision } from '#services/planning_revision';
import { assertCompanyAccessOpen, restrictedCompanyIds } from '#services/auth/authorization';

/**
 * Gives an admitted identity its company membership once. Invited people already received theirs
 * on acceptance; this covers operator-granted evidence and approved registrations. The role comes
 * from recorded invitation evidence when it is assignable, otherwise Viewer. An existing
 * membership is returned unchanged; a disabled or restricted one is never reactivated here.
 */
export async function completeMembership(userId: string, trx: TransactionClientContract) {
  const accountId = await installationCompanyId(trx);
  if (!accountId) {
    throw new AdmissionError('The company has not been set up yet.', 409, 'COMPANY_SETUP_REQUIRED');
  }
  const existing = await access.memberships.find(accountId, userId, trx);
  if (existing) {
    // A restriction disables access even while the stored membership is still active.
    const restricted = await restrictedCompanyIds(userId, trx);
    if (existing.status === 'active' && !restricted.has(accountId)) {
      return { accountId, role: existing.role, created: false };
    }
    throw new AdmissionError(
      'Your access to this company is disabled. Ask an Owner or Admin.',
      409,
      'MEMBERSHIP_DISABLED'
    );
  }
  await assertCompanyAccessOpen(userId, accountId, trx);
  // The Account Kit's admission record keeps the invited role as evidence.
  const evidence = await trx
    .from('account_admissions')
    .where('user_id', userId)
    .select('invited_role')
    .first();
  const role = isInvitableRole(evidence?.invited_role) ? evidence.invited_role : 'viewer';
  await access.memberships.grant({ scopeId: accountId, userId, role, trx });
  await writeAudit(trx, {
    accountId,
    actorId: userId,
    action: 'admission.completed',
    entity: 'membership',
    entityId: userId,
    fields: ['role'],
  });
  await advancePlanningRevision(trx, accountId);
  return { accountId, role, created: true };
}

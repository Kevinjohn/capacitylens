import app from '@adonisjs/core/services/app';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import { installationCompanyId, isInvitableRole } from '#services/account_kit/policy';
import { AdmissionError } from '#services/admission/errors';
import { writeAudit } from '#services/audit';
import { advancePlanningRevision } from '#services/planning_revision';
import access from '#config/access_control';

/**
 * Gives an admitted identity its company membership once. Invited people already received theirs
 * on acceptance; this covers operator-granted evidence and approved registrations. The role comes
 * from recorded invitation evidence when it is assignable, otherwise Viewer. An existing
 * membership is returned unchanged; a suspended one is never reactivated here.
 */
export async function completeMembership(userId: string, trx: TransactionClientContract) {
  const accountId = await installationCompanyId(trx);
  if (!accountId) {
    throw new AdmissionError('The company has not been set up yet.', 409, 'COMPANY_SETUP_REQUIRED');
  }
  const existing = await access.memberships.find(accountId, userId, trx);
  if (existing?.status === 'active') {
    return { accountId, role: String(existing.role), created: false };
  }
  if (existing) {
    throw new AdmissionError(
      'Your membership in this company is suspended. Ask an Owner or Admin to restore it.',
      409,
      'MEMBERSHIP_SUSPENDED'
    );
  }
  // The Account Kit's admission record keeps the invited role as evidence.
  const admission = await app.container.make(AccountAdmission);
  const evidence = await admission.record(userId, trx);
  const invited = evidence?.invitation?.role;
  const role = isInvitableRole(invited) ? invited : 'viewer';
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

/** Whether a company exists that this identity has not yet joined. */
export async function lacksMembership(userId: string, trx: TransactionClientContract) {
  return (
    Boolean(await trx.from('accounts').select('id').first()) &&
    !(await trx.from(access.config.membershipsTable).where('user_id', userId).first())
  );
}

import { inject } from '@adonisjs/core';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import { AdmissionRuleService } from '#services/account_kit/admission_rule_service';
import access from '#config/access_control';
import { AuditService } from '#services/audit_service';
import { PlanningRevisionService } from '#services/planning_revision_service';
import CompanySetupRequiredException from '#exceptions/company_setup_required_exception';
import MembershipSuspendedException from '#exceptions/membership_suspended_exception';
import { InstallationCompanyService } from '#services/installation_company_service';

/** Company membership for an identity the Account Kit has admitted. */
@inject()
export class AdmissionMembershipService {
  #admission: AccountAdmission;
  #admissionRules: AdmissionRuleService;
  #audit: AuditService;
  #planningRevisions: PlanningRevisionService;
  #installationCompany: InstallationCompanyService;

  constructor(
    admission: AccountAdmission,
    admissionRules: AdmissionRuleService,
    audit: AuditService,
    planningRevisions: PlanningRevisionService,
    installationCompany: InstallationCompanyService
  ) {
    this.#admission = admission;
    this.#admissionRules = admissionRules;
    this.#audit = audit;
    this.#planningRevisions = planningRevisions;
    this.#installationCompany = installationCompany;
  }

  /**
   * Gives an admitted identity its company membership once. Invited people already received theirs
   * on acceptance; this covers operator-granted evidence and approved sign-ups. The role comes
   * from recorded invitation evidence when it is assignable, otherwise Viewer. An existing
   * membership is returned unchanged; a suspended one is never restored here.
   */
  async completeMembership(userId: string, trx: TransactionClientContract) {
    const companyId = await this.#installationCompany.getInstallationCompanyId(trx);
    if (!companyId) {
      throw new CompanySetupRequiredException();
    }
    const existing = await access.memberships.find(companyId, userId, trx);
    if (existing?.status === 'active') {
      return { companyId, role: String(existing.role), created: false };
    }
    if (existing) {
      throw new MembershipSuspendedException();
    }
    // The Account Kit's admission record keeps the invited role as evidence.
    const evidence = await this.#admission.record(userId, trx);
    const invited = evidence?.invitation?.role;
    const role = this.#admissionRules.isInvitableRole(invited) ? invited : 'viewer';
    await access.memberships.grant({ scopeId: companyId, userId, role, trx });
    await this.#audit.writeAudit(trx, {
      companyId,
      actorId: userId,
      action: 'admission.completed',
      entity: 'membership',
      entityId: userId,
      fields: ['role'],
    });
    await this.#planningRevisions.advancePlanningRevision(trx, companyId);
    return { companyId, role, created: true };
  }

  /** Whether any company exists while this identity has no membership row in any company. */
  async isMembershipRequired(userId: string, trx: TransactionClientContract) {
    return (
      !(await this.#installationCompany.hasNoCompany(trx)) &&
      !(await trx.from(access.config.membershipsTable).where('user_id', userId).first())
    );
  }
}
